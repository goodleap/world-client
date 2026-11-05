import test from 'node:test';
import assert from 'node:assert/strict';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { LANDSCAPE, GRID_SIZE } from '../src/game/world-data.ts';
import { terrainHeight,surfaceHeight,terrainRayDistance } from '../src/game/terrain-height.ts';
import { buildingAt, placementReason } from '../src/game/construction.ts';
import { Economy } from '../src/game/economy.ts';
import { ENEMIES, RESIDENTS, wanderSettings } from '../src/game/resident-data.ts';
import { createWanderState } from '../src/game/wander.ts';
import type { Obstacle } from '../src/game/movement.ts';

test('home stays flat and picking rays meet elevated ground and bridge decks',()=>{
  for(const [x,z] of [[0,0],[-10,-10],[12,9]])assert.equal(terrainHeight(x,z),0);
  assert.ok(terrainHeight(-2*GRID_SIZE,27*GRID_SIZE)>6,'the crown is above both terrace levels');
  assert.ok(terrainHeight(-31*GRID_SIZE,12*GRID_SIZE)<-1,'the western ravine is below the home plain');
  const points=[{x:-2*GRID_SIZE,z:27*GRID_SIZE},{x:6*GRID_SIZE,z:24*GRID_SIZE},...LANDSCAPE.bridges];
  for(const p of points){
    const target=new Vector3(p.x,surfaceHeight(p.x,p.z),p.z);
    const origin=target.add(new Vector3(4,30,-28)),ray=new Ray(origin,target.subtract(origin).normalize());
    const t=terrainRayDistance(ray);assert.notEqual(t,null);
    assert.ok(Vector3.Distance(origin.add(ray.direction.scale(t!)),target)<.001);
  }
  for(const b of LANDSCAPE.bridges){
    const x=b.x+Math.cos(b.angle)*b.length/2,z=b.z-Math.sin(b.angle)*b.length/2;
    assert.ok(Math.abs(surfaceHeight(x,z)-terrainHeight(x,z))<1e-8,'deck approaches meet the ground without a vertical step');
  }
});

test('bridge foundations and steep slopes are physical restrictions; flat highland remains buildable',()=>{
  const e=new Economy();
  for(const b of LANDSCAPE.bridges)assert.match(placementReason(buildingAt('house',b),e.state),/桥面/);
  const plateau=LANDSCAPE.regions.find(r=>r.id==='highland')!;
  assert.equal(placementReason(buildingAt('house',plateau),e.state),'');
  assert.match(placementReason(buildingAt('house',{x:plateau.x+16,z:plateau.z}),e.state),/坡度/);
});

test('restoring a developed map uses saved positions even when original spawns are occupied',()=>{
  for(const definition of [RESIDENTS[0],ENEMIES[0]]){
    const settings=wanderSettings(definition),solid:Obstacle={kind:'circle',...definition.spawn,radius:2};
    assert.throws(()=>createWanderState(definition.spawn,settings,[solid],()=>.5),/walkable/);
    const saved={x:definition.spawn.x+5,z:definition.spawn.z};
    assert.deepEqual(createWanderState(definition.spawn,settings,[solid],()=>.5,saved).position,saved);
    // Defeated actors can remain below a later building; they must not respawn
    // or prevent loading. Their normal defeated-state presentation hides them.
    assert.deepEqual(createWanderState(definition.spawn,settings,[solid],()=>.5,definition.spawn).position,definition.spawn);
  }
});
