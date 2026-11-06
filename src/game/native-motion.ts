import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { NativeNavigation } from './native-navigation.ts';
import type { NavigationRuntime, MotionStep } from './navigation-runtime.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { segmentIsClear } from './wander.ts';

export interface CrowdBody {
  id:string;position:Point;radius:number;speed:number;route:readonly Point[];destination?:Point;
  solids:readonly Obstacle[];moveIdle?(point:Point):void;
}
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);
/** Official V2 Crowd owns neighbourhood lookup, velocity sampling and collision
 * separation. The adapter supplies already planned role-specific routes and
 * consumes one shared crowd update per simulation step, never per actor. */
export function createNativeMotion(nav:NativeNavigation,bounds:Bounds,solids:()=>readonly Obstacle[],plan:NavigationRuntime['plan']=q=>nav.plan(q)){
  const crowd=nav.createCrowd(bounds,solids()),agents=new Map<string,{index:number;node:TransformNode;goal?:Point;destination?:Point;constrained?:boolean;solids?:readonly Obstacle[];speed?:number}>();
  const results=new Map<string,{position:Point;target?:Point}>();let tickMs=0,steps=0,rejected=0,requests=0;
  function prepare(bodies:readonly CrowdBody[],dt:number){
    const started=performance.now();nav.profile(0,bounds,solids());results.clear();
    const ids=new Set(bodies.map(b=>b.id));
    for(const [id,a]of agents)if(!ids.has(id)){crowd.removeAgent(a.index);a.node.dispose();agents.delete(id);}
    const targets=new Map<string,Point>();
    for(const b of bodies){
      let entry=agents.get(b.id);
      if(!entry){const node=new TransformNode(`crowd:${b.id}`,nav.scene);
        const index=crowd.addAgent({x:b.position.x,y:.2,z:b.position.z},{radius:b.radius,height:2,maxSpeed:b.speed,maxAcceleration:300,
          collisionQueryRange:Math.max(3,b.radius*12),pathOptimizationRange:12,separationWeight:1,updateFlags:3,obstacleAvoidanceType:0,queryFilterType:0,userData:null},node);
        if(index<0){node.dispose();throw new Error('Native crowd capacity exceeded');}
        entry={index,node};agents.set(b.id,entry);
      }
      const agent=crowd.recastCrowd.getAgent(entry.index)!;
      if(distance(agent.position(),b.position)>.002){agent.teleport({x:b.position.x,y:.2,z:b.position.z});agent.resetMoveTarget();entry.goal=undefined;}
      if(entry.speed!==b.speed){agent.updateParameters({radius:b.radius,maxSpeed:b.speed});entry.speed=b.speed;}
      let index=b.route.findIndex(p=>distance(p,b.position)>.015);
      // Crowd may take us around or past a shared intermediate point. Feed it
      // the next reachable leg instead of asking every body to touch that
      // exact point. Reuse the game's radius/terrain validation; Detour still
      // owns all neighbour avoidance and velocity selection.
      while(index>=0&&index+1<b.route.length&&segmentIsClear(b.position,b.route[index+1],b.radius,bounds,b.solids))index++;
      const target=b.route[index],destination=b.route.length?(b.destination??b.route.at(-1)):undefined;
      if(target)targets.set(b.id,target);
      if(entry.solids!==b.solids||!!entry.destination!==!!destination||destination&&entry.destination&&distance(destination,entry.destination)>.3)entry.constrained=false;
      entry.solids=b.solids;entry.destination=destination&&{...destination};
      // V2 owns the path corridor, turning and speed. Only role-specific
      // exclusions/clearance absent from the shared mesh need a legal subgoal.
      const goal=entry.constrained?target:destination;
      if(goal){
        if(!entry.goal||distance(entry.goal,goal)>.005){crowd.agentGoto(entry.index,{x:goal.x,y:.2,z:goal.z});entry.goal={...goal};requests++;}
      }else if(entry.goal){agent.resetMoveTarget();entry.goal=undefined;}

    }
    crowd.update(dt);
    for(const b of bodies){
      const entry=agents.get(b.id)!,p=crowd.getAgentPosition(entry.index),next={x:p.x,z:p.z};
      if(!entry.constrained&&b.route.length){
        const corners=crowd.getCorners(entry.index);
        if(corners.some((p,i)=>!segmentIsClear(i?corners[i-1]:b.position,p,b.radius,bounds,b.solids))){entry.constrained=true;entry.goal=undefined;}
      }
      if(!segmentIsClear(b.position,next,b.radius,bounds,b.solids)){rejected++;continue;}
      results.set(b.id,{position:next,target:targets.get(b.id)});
      if(!b.route.length&&distance(b.position,next)>.00001)b.moveIdle?.(next);
    }
    tickMs=performance.now()-started;steps++;
  }
  const runtime:NavigationRuntime={batched:true,plan,
    step(id,position,route,state,seconds,speed,radius,area,obstacles):MotionStep{
      const dt=Math.max(0,Math.min(seconds,.05));
      if(!dt)return {position,velocity:{x:0,z:0},distance:0,path:[{...position}],unreachable:false,facing:undefined};
      const result=results.get(id);
      let next=result?.position??position;
      if(!dt||speed<=0||!route.length)next=position;
      // Only consume the route used by this Crowd step. Combat or a fresh
      // command can have replaced it since prepare; keep that new intent.
      const index=result?.target?route.indexOf(result.target):-1;
      if(index>0)route.splice(0,index);
      // A newly issued command may precede the next shared Crowd update.
      // Retain its route instead of resetting intent or starting another solver.
      while(route.length&&distance(position,route[0])<.015)route.shift();
      if(route.length&&distance(next,route[0])<.02&&segmentIsClear(next,route[0],radius,area,obstacles)){
        next={...route.shift()!};
      }
      const moved=distance(position,next);state.waiting=!!route.length&&moved<.001;
      state.waited=state.waiting?state.waited+dt:0;state.retryIn=0;state.replanIn=Math.max(0,state.replanIn-dt);
      // A placed building can invalidate a previously accepted path. Ask the
      // same native planner again; crowd-only delays never trigger searches.
      if(state.waited>=.4&&!state.replanIn&&route.length&&!segmentIsClear(position,route[0],radius,area,obstacles)){
        state.replanIn=.5;state.searches++;
        const path=plan({start:position,goals:[route.at(-1)!],radius,bounds:area,obstacles});
        if(path){route.splice(0,route.length,...path);state.replans++;state.waited=0;}
        else if(path===undefined)return {position:next,velocity:{x:0,z:0},distance:0,path:[{...position},{...next}],unreachable:true,facing:undefined};
      }
      return {position:next,velocity:dt?{x:(next.x-position.x)/dt,z:(next.z-position.z)/dt}:{x:0,z:0},distance:moved,
        path:[{...position},{...next}],unreachable:false,facing:moved>.00001?Math.atan2(next.x-position.x,next.z-position.z):undefined};
    },
  };
  return {runtime,prepare,snapshot:()=>({backend:'Babylon Navigation Plugin V2 Crowd',agents:agents.size,steps,lastMs:tickMs,rejected,requests,constrained:[...agents.values()].filter(a=>a.constrained).length}),
    // This adapter creates the public V2 Crowd directly, so the registry is its
    // single owner; both explicit release and plugin teardown are idempotent.
    dispose(){nav.releaseCrowd(crowd);for(const a of agents.values())a.node.dispose();agents.clear();results.clear();}};
}
