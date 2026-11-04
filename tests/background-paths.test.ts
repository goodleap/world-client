import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundPaths, usePathPlanner, type PathQuery, type PathReply } from '../src/game/path-planner.ts';
import { planWorkApproach } from '../src/game/work-navigation.ts';
import { findPathToGoals } from '../src/game/pathfinding.ts';
import { createRouteState, stepRoute } from '../src/game/route-following.ts';
import type { Obstacle } from '../src/game/movement.ts';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Combat } from '../src/game/combat.ts';
import { Economy } from '../src/game/economy.ts';

const bounds={minX:-5,maxX:5,minZ:-5,maxZ:5},start={x:-1.5,z:0},goal={x:1.2,z:.25};
const walls:Obstacle[]=[{kind:'box',x:0,z:0,halfWidth:.3,halfDepth:5}];
function setup(){
  let time=0;
  const requests:{serial:number;query:PathQuery}[]=[];
  const worker={onmessage:null as ((e:MessageEvent<PathReply>)=>void)|null,onerror:null as ((e:ErrorEvent)=>void)|null,
    postMessage:(request:typeof requests[number])=>requests.push(request),terminate:()=>{}};
  const planner=createBackgroundPaths(worker,()=>time),release=usePathPlanner(planner.plan);
  const reply=()=>{const q=requests.at(-1)!;worker.onmessage!({data:{serial:q.serial,path:findPathToGoals(q.query.start,q.query.goals,q.query.radius,q.query.bounds,q.query.obstacles),ms:1}} as MessageEvent<PathReply>);};
  return {requests,planner,reply,advance:(ms:number)=>time+=ms,dispose:()=>{release();planner.dispose();}};
}
test('work approaches share one search; replies wait for the active loop and cached routes are copied',()=>{
  const f=setup(),alternative={x:-3.2,z:3.25},points=[goal,alternative];
  try{
    assert.equal(planWorkApproach(start,points,.29,bounds,walls,[]),null);
    assert.equal(planWorkApproach(start,points,.29,bounds,walls,[]),null);assert.equal(f.requests.length,1);
    assert.equal(f.requests[0].query.goals.length,2);
    f.reply();assert.equal(planWorkApproach(start,points,.29,bounds,walls,[]),null,'paused callbacks cannot advance the world');
    f.planner.flush();const path=planWorkApproach(start,points,.29,bounds,walls,[])!;
    assert.deepEqual(path.at(-1),alternative);path.length=0;
    assert.deepEqual(planWorkApproach(start,points,.29,bounds,walls,[])!.at(-1),alternative);
    assert.equal(f.requests.length,1);
    assert.deepEqual(planWorkApproach({...start,z:.05},points,.29,bounds,walls,[])!.at(-1),alternative,'live starts can join a solved corridor');
  }finally{f.dispose();}
});
test('failed paths are briefly reused, while changed geometry and targets cannot receive stale answers',()=>{
  const f=setup();
  try{
    const query:PathQuery={start,goals:[goal],radius:.29,bounds,obstacles:walls};
    assert.equal(f.planner.plan(query),null);f.reply();f.planner.flush();
    assert.equal(f.planner.plan(query),undefined);assert.equal(f.requests.length,1);
    const changed={...query,obstacles:[]};assert.equal(f.planner.plan(changed),null);
    f.reply();f.planner.flush();assert(f.planner.plan(changed));
    assert.equal(f.planner.plan({...query,goals:[{x:3,z:2}]}),null);
    f.reply();f.planner.flush();f.advance(2001);
    assert.equal(f.planner.plan(query),null,'completed failures expire');
  }finally{f.dispose();}
});
test('a route blocked by new solids waits for background planning before declaring it unreachable',()=>{
  const f=setup(),state=createRouteState(),position={x:-.6,z:0},route=[{x:2,z:0}];
  try{
    const step=()=>stepRoute('farmer',position,route,state,.05,5,.29,bounds,walls,[]);
    assert.equal(step().unreachable,false);assert.equal(route.length,1);assert(state.waiting);
    f.reply();f.planner.flush();
    assert.equal(step().unreachable,true);
  }finally{f.dispose();}
});
test('engine vector coordinates cross the worker boundary and exact orders remain accepted while planning',()=>{
  const f=setup();
  try{
    f.planner.plan({start:new Vector3(start.x,0,start.z),goals:[new Vector3(goal.x,0,goal.z)],radius:.29,bounds,obstacles:walls});
    assert.deepEqual(f.requests[0].query.start,start);assert.deepEqual(f.requests[0].query.goals,[goal]);
    f.reply();f.planner.flush();
    const e=new Economy(),c=new Combat(e.state.combat,e,()=>walls),u=c.unit('archer')!;u.position={...start};
    assert(c.canMoveTo(u.id,goal),'a pending tower/rest approach is not an unreachable destination');
    assert.equal(c.move([u.id],goal,false,false,false,true),1);
    c.update(.05);assert.deepEqual(u.goal,goal);assert.equal(u.route.length,0);
    f.reply();f.planner.flush();c.update(.05);
    assert(u.route.length>0);assert(u.speed>0);
  }finally{f.dispose();}
});
