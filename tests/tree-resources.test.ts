import assert from 'node:assert/strict';
import test from 'node:test';
import { LANDSCAPE, TREES, GRID_SIZE, WORLD_BOUNDS } from '../src/game/world-data.ts';
import { RESOURCE_NODES, economyObstacles } from '../src/game/economy-config.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { insidePolygon } from '../src/game/polygon.ts';
import { isBlocked } from '../src/game/movement.ts';
import { findPath } from '../src/game/pathfinding.ts';
import { buildingAt, placementReason } from '../src/game/construction.ts';
import { treeColor, treeName } from '../src/game/tree-profile.ts';

test('all three tree sizes expose reachable individual wood resources', () => {
  const wood=RESOURCE_NODES.filter(n=>n.kind==='wood'),solids=economyObstacles([]);
  assert.equal(wood.length,TREES.length);
  assert.deepEqual([...new Set(TREES.map(t=>t.size))].sort(),['large','medium','small']);
  assert.deepEqual([...new Set(TREES.map(t=>treeName(t.species)))].sort(),['松树','树木']);
  assert.deepEqual([...new Set(TREES.map(t=>treeColor(t.species,t.tone)))].sort(),['gold','leaf','lime','orange','pine','pink']);
  assert.ok(wood.filter(n=>LANDSCAPE.geography.forests.some(f=>insidePolygon(n,f.area))).length>100);
  for(const tree of TREES){
    assert.ok(LANDSCAPE.contains(tree),'ordinary trees cannot be planted inside permanent cliffs');
  }
  for(const node of wood){
    assert.ok(node.canopyRadius>=GRID_SIZE/2&&node.canopyRadius<=GRID_SIZE);
    assert.ok(node.radius<node.canopyRadius/2,'workers can stand below the crown to chop the trunk');
  }
  for(const forest of LANDSCAPE.geography.forests){
    const tree=wood.find(n=>insidePolygon(n,forest.area));if(!tree)continue;
    const approaches=Array.from({length:16},(_,i)=>({x:tree.x+Math.cos(i*Math.PI/8)*(tree.radius+.7),z:tree.z+Math.sin(i*Math.PI/8)*(tree.radius+.7)}));
    assert.ok(approaches.some(p=>!isBlocked(p,.4,solids)&&findPath({x:-4,z:-4},p,.4,WORLD_BOUNDS,solids)),forest.id);
  }
});

test('felling a woodland tree releases its collision and building footprint and survives reload', () => {
  const e=new Economy();e.setLeadership(false);
  const tree=RESOURCE_NODES.find(n=>n.kind==='wood'&&LANDSCAPE.geography.forests.some(f=>insidePolygon(n,f.area))
    &&!e.regionLocked(n)&&!placementReason(buildingAt('farm',n),{...e.state,depleted:[n.id]}))!;
  assert.ok(tree,'find a woodland tree with a clear adjacent building cell');
  const site=buildingAt('farm',tree);
  assert.match(placementReason(site,e.state),/资源/);
  assert.equal(isBlocked(tree,.1,economyObstacles([])),true);
  const result=e.request('chop',tree.id);assert.equal(result.ok,true,result.message);
  e.assign(result.task!.id,'farmer');e.arrive(result.task!.id);e.advance(5);
  assert.ok(e.state.depleted.includes(tree.id));
  assert.ok(e.state.goods.some(g=>g.resource==='wood'&&g.amount===tree.yield));
  assert.equal(isBlocked(tree,.1,economyObstacles(e.state.depleted)),false,'no invisible forest barrier remains');
  // Construction must still wait for the produced logs to be carried away.
  assert.equal(placementReason(site,{...e.state,goods:[]}), '');
  const restored=decodeEconomy(encodeEconomy(e));
  assert.ok(restored.state.depleted.includes(tree.id));
  assert.equal(isBlocked(tree,.1,economyObstacles(restored.state.depleted)),false);
});

test('a large tree cannot regrow through construction at the edge of its crown', () => {
  const e=new Economy();e.setLeadership(false);
  const candidate=RESOURCE_NODES.filter(n=>n.kind==='wood').filter(n=>n.canopyRadius===GRID_SIZE)
    .map(tree=>({tree,site:buildingAt('farm',{x:tree.x+tree.canopyRadius+GRID_SIZE/2-.05,z:tree.z})}))
    .find(({tree,site})=>Math.abs(site.x-tree.x)-site.width/2>tree.radius+1&&Math.abs(site.x-tree.x)-site.width/2<tree.canopyRadius);
  assert.ok(candidate,'a snapped cell intersects only the outer crown');
  const {tree,site}=candidate;
  e.state.depleted.push(tree.id);e.state.regrowth[tree.id]=0;
  e.state.sites.push(site);
  e.advance(1);
  assert.ok(e.state.depleted.includes(tree.id),'construction overlaps the canopy, although it clears the trunk');
  e.state.sites=[];e.advance(11);
  assert.ok(!e.state.depleted.includes(tree.id));
});
