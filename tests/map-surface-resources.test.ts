import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { LANDSCAPE } from '../src/game/world-data.ts';
import { RESOURCE_NODES, economyObstacles } from '../src/game/economy-config.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { isBlocked } from '../src/game/movement.ts';
import { createLandformMeshes } from '../src/game/landform-meshes.ts';
import { roadEdgeDistance } from '../src/game/road-layout.ts';

test('large loose bushes and stones can be harvested, release their footprint and survive reload',()=>{
  for(const kind of ['food','stone'] as const){
    const e=new Economy();e.setLeadership(false);
    const node=RESOURCE_NODES.find(n=>n.kind===kind&&n.scale>1.3&&!e.regionLocked(n));
    assert.ok(node,`an approachable large ${kind} node exists`);
    assert.ok(LANDSCAPE.contains(node));
    assert.equal(isBlocked(node,.1,economyObstacles([])),true);
    const request=e.request(kind==='food'?'gather':'mine',node.id);
    assert.equal(request.ok,true,request.message);
    e.assign(request.task!.id,'farmer');e.arrive(request.task!.id);e.advance(15);
    assert.ok(e.state.depleted.includes(node.id));
    assert.ok(e.state.goods.some(g=>g.resource===kind&&g.amount===node.yield));
    const restored=decodeEconomy(encodeEconomy(e));
    assert.equal(isBlocked(node,.1,economyObstacles(restored.state.depleted)),false,'no decorative duplicate or permanent collider remains');
  }
  assert.ok(LANDSCAPE.decorations.length>0);
  assert.ok(LANDSCAPE.decorations.every(d=>d.scale[1]<.18),'unharvestable remnants are recognizably low ground cover');
});

test('the shared terrain interpolates rock edges and suppresses grass detail throughout road interiors',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const ground=createLandformMeshes(scene,new StandardMaterial('terrain',scene));
    const p=ground.getVerticesData('position')!,colors=ground.getVerticesData('color')!,mask=ground.getVerticesData('uv2')!;
    let road=0,transition=0,grass=0;
    for(let i=0;i<p.length/3;i++){
      const edge=roadEdgeDistance({x:p[i*3],z:p[i*3+2]}),weight=colors[i*4+3];
      assert.ok(weight>=0&&weight<=1&&Number.isFinite(weight));
      if(edge<-.2){assert.equal(mask[i*2],0);road++;}
      if(weight>.05&&weight<.95)transition++;
      if(mask[i*2]>.95)grass++;
    }
    assert.ok(road>500&&transition>500&&grass>1000);
    assert.equal(ground.hasVertexAlpha,false,'blend weights do not make terrain transparent');
    assert.equal(scene.getMeshByName('landform-exposed-rock'),null,'no disjoint triangle material edge remains');
  }finally{scene.dispose();engine.dispose();}
});
