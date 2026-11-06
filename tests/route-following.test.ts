import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeMotion, type CrowdBody } from '../src/game/native-motion.ts';
import { createRouteState } from '../src/game/route-following.ts';
import { testNavigation } from './native-test-runtime.ts';
import { segmentIsClear } from '../src/game/wander.ts';
import type { Obstacle, Point } from '../src/game/movement.ts';
const bounds={minX:-12,maxX:12,minZ:-10,maxZ:10};
const d=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z);
function actor(id:string,position:Point,route:Point[],radius=.4,speed=4.8){return {id,position,route,radius,speed,state:createRouteState()};}
function run(actors:ReturnType<typeof actor>[],solids:()=>readonly Obstacle[],ticks=300){
  const motion=createNativeMotion(testNavigation,bounds,solids);const stalled=new Map<string,number>();
  try{for(let tick=0;tick<ticks&&actors.some(a=>a.route.length);tick++){
    motion.prepare(actors.map(a=>({...a,solids:solids(),moveIdle:(p:Point)=>{a.position=p;}})) satisfies CrowdBody[],.05);
    for(const a of actors){if(!a.route.length)continue;
      const next=motion.runtime.step(a.id,a.position,a.route,a.state,.05,a.speed,a.radius,bounds,solids(),[]);
      assert(segmentIsClear(a.position,next.position,a.radius,bounds,solids()),a.id+' crosses an obstacle');
      assert(next.distance<=a.speed*.05+.025,a.id+' jumps');
      if(next.distance<.001&&a.route.length)stalled.set(a.id,(stalled.get(a.id)??0)+1);
      a.position=next.position;
    }
  }return {stalled,diagnostics:motion.snapshot()};}finally{motion.dispose();}
}

test('all four roles move continuously through native corners and reach the destination',()=>{
  const solids:Obstacle[]=[{kind:'box',x:0,z:0,halfWidth:1.2,halfDepth:2}];
  for(const [role,radius,speed]of [['farmer',.29,5],['infantry',.4,4.6],['archer',.4,4.8],['cavalry',.6,6.96]] as const){
    const start={x:-6,z:0},goal={x:6,z:0},route=testNavigation.path(start,[goal],radius,bounds,solids);assert(route);
    const a=actor(role,start,route,radius,speed),r=run([a],()=>solids);
    assert.equal(a.route.length,0,JSON.stringify({a,r}));assert(d(a.position,goal)<.03);assert((r.stalled.get(role)??0)<=1,JSON.stringify(r));
  }
});

test('a column runs continuously without repeated idle or queue resets',()=>{
  for(const radius of [.29,.4,.6]){
    const actors=Array.from({length:5},(_,i)=>actor(String(i),{x:0,z:6-i*(2*radius+.4)},[{x:0,z:8-i*(2*radius+.4)}],radius,3));
    const {stalled}=run(actors,()=>[]);assert(actors.every(a=>!a.route.length),JSON.stringify({radius,actors,stalled:[...stalled]}));assert.equal(stalled.size,0);
  }
});

test('opposing commands and an idle resident share one native Crowd without losing either goal',()=>{
  const a=actor('a',{x:-6,z:-.12},[{x:6,z:0}]),b=actor('b',{x:6,z:.12},[{x:-6,z:0}]),idle=actor('idle',{x:0,z:0},[]);
  const result=run([a,b,idle],()=>[],500);
  assert.equal(a.route.length,0,JSON.stringify({a,b,idle,result}));assert.equal(b.route.length,0);
  assert(d(a.position,{x:6,z:0})<.03);assert(d(b.position,{x:-6,z:0})<.03);
});

test('paused steps preserve position and navigation state',()=>{
  const motion=createNativeMotion(testNavigation,bounds,()=>[]),state=createRouteState(),route=[{x:4,z:0}],position={x:-4,z:0};
  try{const before=structuredClone(state),result=motion.runtime.step('a',position,route,state,0,5,.4,bounds,[],[]);
    assert.deepEqual(result.position,position);assert.deepEqual(state,before);assert.equal(route.length,1);
  }finally{motion.dispose();}
});

test('a building placed across an accepted route triggers one native replan and preserves its destination',()=>{
  let solids:readonly Obstacle[]=[];
  const a=actor('builder',{x:-7,z:0},[{x:7,z:0}]),motion=createNativeMotion(testNavigation,bounds,()=>solids);
  try{for(let tick=0;tick<300&&a.route.length;tick++){
    if(tick===8)solids=[{kind:'box',x:0,z:0,halfWidth:1,halfDepth:2}];
    motion.prepare([{...a,solids}],.05);
    const next=motion.runtime.step(a.id,a.position,a.route,a.state,.05,a.speed,a.radius,bounds,solids,[]);
    assert(!next.unreachable);assert(segmentIsClear(a.position,next.position,a.radius,bounds,solids));a.position=next.position;
  }assert.equal(a.route.length,0);assert(d(a.position,{x:7,z:0})<.03);assert.equal(a.state.replans,1);
  }finally{motion.dispose();}
});
