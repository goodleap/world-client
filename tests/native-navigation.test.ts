import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeNavigation } from '../src/game/native-navigation.ts';
import { immutableObstacles } from '../src/game/navigation-geometry.ts';
import { sweepIsBlocked } from '../src/game/movement.ts';

test('scattered obstacles carve every touched tile across native update batches',async()=>{
  const nav=await createNativeNavigation(),bounds={minX:-52,maxX:52,minZ:-52,maxZ:52};
  const solids=immutableObstacles(Array.from({length:144},(_,i)=>({kind:'circle' as const,x:-44+i%12*8,z:-44+Math.floor(i/12)*8,radius:.65})));
  try{
    // More than 64 distinct tiles are touched. Batching only by the obstacle
    // request count used to leave rows 3, 7 and 11 partially uncarved.
    for(let row=0;row<12;row++){
      const start={x:-49,z:-44+row*8},goal={x:49,z:start.z};
      const path=nav.path(start,[goal],.4,bounds,solids);assert(path?.length,`row ${row}`);
      assert(path.every((p,i)=>!sweepIsBlocked(i?path[i-1]:start,p,.4,solids)));
    }
    const clear=nav.path({x:-49,z:-44},[{x:49,z:-44}],.4,bounds,immutableObstacles([]));
    assert(clear?.every(p=>Math.abs(p.z+44)<.001),'removing the batch opens the straight route');
    assert.equal(nav.snapshot().obstacleRemoves,solids.length);
  }finally{nav.dispose();}
});

test('Navigation Plugin V2 routes around a live building and opens the corridor after demolition',async()=>{
  const nav=await createNativeNavigation(),bounds={minX:-12,maxX:12,minZ:-12,maxZ:12};
  try{
    const solids=immutableObstacles([{kind:'box',x:0,z:0,halfWidth:1,halfDepth:3}]);
    const from={x:-6,z:0},goal={x:6,z:0};
    for(const radius of [.29,.4,.6]){
      const path=await nav.path(from,[goal],radius,bounds,solids);
      assert(path?.length,`native route for radius ${radius}`);
      assert(path.some(p=>Math.abs(p.z)>3));
      assert(path.every((p,i)=>!sweepIsBlocked(i?path[i-1]:from,p,radius,solids)));
    }
    const path=await nav.path(from,[goal],.4,bounds,immutableObstacles([]));assert(path?.length);assert(path.every(p=>Math.abs(p.z)<.2));
    assert.equal(nav.snapshot().builds,3);assert(nav.snapshot().obstacleRemoves>0);
  }finally{nav.dispose();}
});

test('large exclusion areas and long buildings block every tile and release native resources once',async()=>{
  const nav=await createNativeNavigation(),bounds={minX:-30,maxX:30,minZ:-30,maxZ:30};
  try{
    for(const obstacle of [{kind:'circle' as const,x:0,z:0,radius:11.8},{kind:'box' as const,x:0,z:0,halfWidth:1,halfDepth:9}]){
      const solids=immutableObstacles([obstacle]),from={x:-20,z:0};
      const path=nav.path(from,[{x:20,z:0}],.72,bounds,solids);assert(path?.length);
      assert(path.every((p,i)=>!sweepIsBlocked(i?path[i-1]:from,p,.72,solids)));
    }
    const crowd=nav.createCrowd(bounds,[]);nav.releaseCrowd(crowd);nav.releaseCrowd(crowd);
  }finally{nav.dispose();}
});
