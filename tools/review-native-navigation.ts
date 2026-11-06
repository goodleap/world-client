import { createNativeNavigation } from '../src/game/native-navigation.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { WORLD_BOUNDS } from '../src/game/world-data.ts';
import { immutableObstacles } from '../src/game/navigation-geometry.ts';
import { Crowd } from '@recast-navigation/core';
import assert from 'node:assert/strict';

// Bounded native-only evaluation before changing the game's authoritative loop.
const nav=await createNativeNavigation();
try{
 const solids=economyObstacles([]),start={x:-6,z:2};
 const paths=[];for(const goal of [{x:12,z:2},{x:25,z:-20},{x:-30,z:18}]){
   const begin=performance.now(),path=await nav.path(start,[goal],.4,WORLD_BOUNDS,solids);paths.push({goal,points:path?.length??0,ms:performance.now()-begin});
 }
 console.log(JSON.stringify({map:{obstacles:solids.length,bounds:WORLD_BOUNDS,paths,...nav.snapshot()}}));
 const plugin=await nav.profile(.6,{minX:-30,maxX:30,minZ:-30,maxZ:30},immutableObstacles([{kind:'box',x:0,z:0,halfWidth:1,halfDepth:6}]));
 const crowd=new Crowd(plugin.navMesh!,{maxAgents:200,maxAgentRadius:.72});
 try{
  const agents=Array.from({length:175},(_,i)=>{const p={x:-23+(i%7)*1.6,y:.2,z:-20+Math.floor(i/7)*1.6};
   const radius=[.29,.4,.6][i%3],a=crowd.addAgent(p,{radius,height:2,maxSpeed:3,maxAcceleration:30,collisionQueryRange:5,pathOptimizationRange:12,separationWeight:2});
   assert(a);assert(a.requestMoveTarget({x:12+(i%7)*1.6,y:.2,z:-20+Math.floor(i/7)*1.6}));return {a,p};
  });
  const times:number[]=[];
  for(let i=0;i<240;i++){const t=performance.now();crowd.update(.05);times.push(performance.now()-t);}
  const travelled=agents.map(({a,p})=>Math.hypot(a.position().x-p.x,a.position().z-p.z));assert(travelled.every(Number.isFinite));assert(travelled.filter(d=>d>5).length>150);
  times.sort((a,b)=>a-b);console.log(JSON.stringify({crowd:{agents:agents.length,steps:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),progressed:travelled.filter(d=>d>5).length}}));
 }finally{crowd.destroy();}
}finally{nav.dispose();}
