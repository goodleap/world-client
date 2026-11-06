import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeNavigation } from '../src/game/native-navigation.ts';
import { immutableObstacles } from '../src/game/navigation-geometry.ts';
import { sweepIsBlocked } from '../src/game/movement.ts';

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
