import test from 'node:test';
import assert from 'node:assert/strict';
import { combineObstacles, immutableObstacles, createGeometrySender, createGeometryReceiver } from '../src/game/navigation-geometry.ts';
import { economyObstacles, RESOURCE_NODES } from '../src/game/economy-config.ts';
import { dangerObstacles } from '../src/game/danger-zones.ts';
import { polygonArea } from '../src/game/polygon.ts';
import type { Obstacle } from '../src/game/movement.ts';
import type { BuildingSite } from '../src/game/construction.ts';

test('immutable polygon snapshots include holes and never retain mutable source coordinates',()=>{
  const outer=polygonArea([{x:0,z:0},{x:10,z:0},{x:10,z:10}]);
  const hole=polygonArea([{x:2,z:2},{x:4,z:2},{x:4,z:4}]);
  const source:Obstacle[]=[{kind:'polygon',...outer,holes:[hole]}];
  const fixed=immutableObstacles(source),expected=structuredClone(source),sender=createGeometrySender();
  outer.points[0].x=99;hole.points[0].x=77;outer.bounds.minX=-100;
  assert.deepEqual(fixed,expected);
  assert.throws(()=>{fixed[0].x=1;},TypeError);
  const first=sender.snapshot(fixed);assert.equal(sender.snapshot(fixed),first);
  assert.equal(sender.snapshot(source).obstacles[0].kind,'polygon');
  const changed=sender.snapshot(source);hole.points[0].x=78;
  assert.notEqual(sender.snapshot(source).id,changed.id,'unpublished mutable polygons are checked by value');
});

test('geometry transfer is bounded and resends evicted versions, including empty geometry',()=>{
  const sender=createGeometrySender(),receive=createGeometryReceiver();
  const versions=Array.from({length:10},(_,i)=>sender.snapshot(immutableObstacles(i ? [{kind:'circle',x:i,z:0,radius:1}] : [])));
  for(const version of versions){
    const first=sender.encode(version);assert(first.obstacles);
    assert.deepEqual(receive(structuredClone(first)),version.obstacles);
    const second=sender.encode(version);assert.equal(second.obstacles,undefined);
    assert.deepEqual(receive(second),version.obstacles);
  }
  const retry=sender.encode(versions[0]);assert(retry.obstacles);
  assert.deepEqual(receive(retry),[]);
  assert.throws(()=>receive({id:1000}),/Missing navigation geometry/);
  sender.clear();assert(sender.encode(versions[0]).obstacles);
});

test('world layout versions change for depletion, footprint edits and campfire construction, not task/HP edits',()=>{
  const site:BuildingSite={id:'site-review',kind:'campfire',x:3,z:5,width:2,depth:2,height:1.5};
  const original=economyObstacles([], [site], []);
  assert.equal(economyObstacles([], [{...site}], []),original);
  const built=economyObstacles([], [site], [site.id]);assert.notEqual(built,original);
  assert.equal(built.at(-1)!.kind,'circle');assert.equal(original.at(-1)!.kind,'box');
  assert.notEqual(economyObstacles([], [{...site,x:4}], []),original);
  const depleted=economyObstacles([RESOURCE_NODES[0].id],[site],[]);
  assert.equal(depleted.length,original.length-1);
  assert.equal(economyObstacles([], [site], []),original,'unrelated updates retain the same immutable version');
});

test('danger and field overlays reuse identical geometry and invalidate changed areas',()=>{
  const base=economyObstacles([]),zones=[{id:'area:0:0',x:0,z:0,radius:2}];
  const first=dangerObstacles(zones),combined=combineObstacles(base,first);
  assert.equal(combineObstacles(base,dangerObstacles(zones,first)),combined);
  zones[0].radius=3;
  const updated=combineObstacles(base,dangerObstacles(zones,first));
  assert.notEqual(updated,combined);assert.deepEqual(combined.at(-1),{kind:'circle',x:0,z:0,radius:2});
  assert.deepEqual(updated.at(-1),{kind:'circle',x:0,z:0,radius:3});
  assert.equal(combineObstacles(base,[]),base);
});
