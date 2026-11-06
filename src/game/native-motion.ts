import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { NativeNavigation } from './native-navigation.ts';
import type { NavigationRuntime, MotionStep } from './navigation-runtime.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { segmentIsClear } from './wander.ts';

export interface CrowdBody {
  id:string;position:Point;radius:number;speed:number;route:readonly Point[];
  solids:readonly Obstacle[];moveIdle?(point:Point):void;
}
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);
/** Official V2 Crowd owns neighbourhood lookup, velocity sampling and collision
 * separation. The adapter supplies already planned role-specific routes and
 * consumes one shared crowd update per simulation step, never per actor. */
export function createNativeMotion(nav:NativeNavigation,bounds:Bounds,solids:()=>readonly Obstacle[]){
  const crowd=nav.createCrowd(bounds,solids()),agents=new Map<string,{index:number;node:TransformNode}>();
  const results=new Map<string,Point>();let tickMs=0,steps=0,rejected=0;
  function prepare(bodies:readonly CrowdBody[],dt:number){
    const started=performance.now();nav.profile(0,bounds,solids());results.clear();
    const ids=new Set(bodies.map(b=>b.id));
    for(const [id,a]of agents)if(!ids.has(id)){crowd.removeAgent(a.index);a.node.dispose();agents.delete(id);}
    for(const b of bodies){
      let entry=agents.get(b.id);
      if(!entry){const node=new TransformNode(`crowd:${b.id}`,nav.scene);
        const index=crowd.addAgent({x:b.position.x,y:.2,z:b.position.z},{radius:b.radius,height:2,maxSpeed:b.speed,maxAcceleration:80,
          collisionQueryRange:Math.max(3,b.radius*12),pathOptimizationRange:12,separationWeight:2,updateFlags:7,obstacleAvoidanceType:0,queryFilterType:0,userData:null},node);
        if(index<0){node.dispose();throw new Error('Native crowd capacity exceeded');}
        entry={index,node};agents.set(b.id,entry);
      }
      const agent=crowd.recastCrowd.getAgent(entry.index)!;
      if(distance(agent.position(),b.position)>.002)agent.teleport({x:b.position.x,y:.2,z:b.position.z});
      agent.updateParameters({radius:b.radius,maxSpeed:b.speed});
      const target=b.route.find(p=>distance(p,b.position)>.015),d=target?distance(target,b.position):0;
      const speed=Math.min(b.speed,d/dt);
      agent.requestMoveVelocity(target&&d>0?{x:(target.x-b.position.x)*speed/d,y:0,z:(target.z-b.position.z)*speed/d}:{x:0,y:0,z:0});
    }
    crowd.update(dt);
    for(const b of bodies){
      const p=crowd.getAgentPosition(agents.get(b.id)!.index),next={x:p.x,z:p.z};
      if(!segmentIsClear(b.position,next,b.radius,bounds,b.solids)){rejected++;continue;}
      results.set(b.id,next);
      if(!b.route.length&&distance(b.position,next)>.00001)b.moveIdle?.(next);
    }
    tickMs=performance.now()-started;steps++;
  }
  const runtime:NavigationRuntime={plan:q=>nav.plan(q),
    step(id,position,route,state,seconds,speed,radius,area,obstacles):MotionStep{
      const dt=Math.max(0,Math.min(seconds,.05));let next=results.get(id)??position;
      if(!dt||speed<=0||!route.length)next=position;
      // A newly issued command may precede the next shared Crowd update.
      // Retain its route instead of resetting intent or starting another solver.
      while(route.length&&distance(position,route[0])<.015)route.shift();
      if(route.length&&distance(next,route[0])<.02&&segmentIsClear(next,route[0],radius,area,obstacles)){
        next={...route.shift()!};
      }
      const moved=distance(position,next);state.waiting=!!route.length&&moved<.001;
      state.waited=state.waiting?state.waited+dt:0;state.retryIn=0;
      return {position:next,velocity:dt?{x:(next.x-position.x)/dt,z:(next.z-position.z)/dt}:{x:0,z:0},distance:moved,
        path:[{...position},{...next}],unreachable:false,facing:moved>.00001?Math.atan2(next.x-position.x,next.z-position.z):undefined};
    },
  };
  return {runtime,prepare,snapshot:()=>({backend:'Babylon Navigation Plugin V2 Crowd',agents:agents.size,steps,lastMs:tickMs,rejected}),
    // The V2 plugin owns and disposes its Crowd. Release our transform bindings
    // here; calling Crowd.dispose as well would free the same WASM memory twice.
    dispose(){for(const a of agents.values()){crowd.removeAgent(a.index);a.node.dispose();}agents.clear();results.clear();}};
}
