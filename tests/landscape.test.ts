import assert from 'node:assert/strict';
import test from 'node:test';
import { createLandscapeLayout, createCurvedRoadPaths, TREE_COLLISION_RADIUS } from '../src/game/landscape-layout.ts';
import { polygonArea, polygonDistance, insidePolygon, segmentDistanceSquared } from '../src/game/polygon.ts';
import { isBlocked, sweepIsBlocked } from '../src/game/movement.ts';
import type { Obstacle } from '../src/game/movement.ts';
import { gridPoint, GRID_SIZE, BUILDINGS } from '../src/game/world-data.ts';
import { findPath } from '../src/game/pathfinding.ts';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createLandscapeRock, createLandscapeRockMaterial } from '../src/game/landscape-rock.ts';

test('concave water admits its bay but blocks crossings, narrow shores and fully submerged destinations', () => {
  const lake: Obstacle = { kind: 'polygon', ...polygonArea([[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]].map(([x, z]) => ({ x, z }))) };
  assert.equal(isBlocked({ x: 4, z: 4 }, .3, [lake]), false, 'the bay is walkable');
  assert.equal(isBlocked({ x: 1, z: 4 }, 0, [lake]), true);
  assert.equal(isBlocked({ x: 2.2, z: 4 }, .3, [lake]), true, 'disk radius respects the shore');
  assert.equal(sweepIsBlocked({ x: -2, z: 3 }, { x: 7, z: 3 }, .3, [lake]), true, 'endpoints alone are insufficient');
  assert.equal(sweepIsBlocked({ x: 3, z: 4 }, { x: 4, z: 3 }, .3, [lake]), false);
  const path = findPath({ x: -2, z: 3 }, { x: 4, z: 4 }, .3, { minX: -4, maxX: 9, minZ: -4, maxZ: 9 }, [lake]);
  assert.ok(path?.length);
  let from = { x: -2, z: 3 };
  for (const to of path) { assert.equal(sweepIsBlocked(from, to, .3, [lake]), false); from = to; }
});

test('landscape seeds are reproducible, mixed resources have clearance and starting buildings remain accessible', () => {
  const layout = createLandscapeLayout(gridPoint, GRID_SIZE);
  assert.equal(JSON.stringify(createLandscapeLayout(gridPoint, GRID_SIZE)), JSON.stringify(layout));
  assert.notDeepEqual(createLandscapeLayout(gridPoint, GRID_SIZE, 20261103).trees, layout.trees);
  assert.ok(layout.trees.length >= 30 && layout.rocks.length >= 20 && layout.iron.length >= 8 && layout.forage.length >= 8);
  const nodes = [...layout.trees.map(n => ({ ...n, radius: n.scale * TREE_COLLISION_RADIUS })), ...layout.rocks.map(n => ({ ...n, radius: n.scale * .85 }))];
  const roads = createCurvedRoadPaths(layout.roadControls, GRID_SIZE);
  for (const [i, node] of nodes.entries()) {
    assert.ok(polygonDistance(node, layout.lake) > node.scale + .65);
    for (const other of nodes.slice(i + 1)) assert.ok(Math.hypot(node.x - other.x, node.z - other.z) > node.radius + other.radius + .6, 'leave at least a worker-width approach');
    for (const b of BUILDINGS) assert.ok(Math.abs(node.x - b.x) > b.width / 2 + .6 || Math.abs(node.z - b.z) > b.depth / 2 + 1.5);
    for (const path of roads) for (let j = 1; j < path.length; j++) assert.ok(segmentDistanceSquared(node, path[j - 1], path[j]) > (node.scale * .5 + .7) ** 2);
  }
  assert.ok(layout.regions.some(r => r.id === 'quarry' && layout.iron.some(n => insidePolygon(n, r.area))), 'iron has a distinct mine region');
  for (const point of [gridPoint(50, 50), gridPoint(51.5, 55.5), gridPoint(55.5, 57)]) assert.ok(polygonDistance(point, layout.lake) > 5);
});

test('bridges cut traversable decks from the same visible stream without opening the banks', () => {
  const map=createLandscapeLayout(gridPoint,GRID_SIZE);
  const solids:Obstacle[]=map.waterSolids.map(a=>({kind:'polygon',...a}));
  assert.equal(map.waterAreas.length,4);assert.equal(map.bridges.length,2);
  for(const bridge of map.bridges){
    assert.ok(map.waterAreas.some(a=>insidePolygon(bridge,a)));
    const c=Math.cos(bridge.angle),s=Math.sin(bridge.angle);
    const start={x:bridge.x-c*bridge.length/2,z:bridge.z+s*bridge.length/2};
    const end={x:bridge.x+c*bridge.length/2,z:bridge.z-s*bridge.length/2};
    for(const radius of [.4,.6])assert.equal(sweepIsBlocked(start,end,radius,solids),false);
    assert.equal(isBlocked({x:bridge.x+s*(bridge.width/2+.7),z:bridge.z+c*(bridge.width/2+.7)},.1,solids),true);
  }
});

test('the rock silhouette fits its circular collider at any rotation without a high geometry cost', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const parts = createLandscapeRock(scene, createLandscapeRockMaterial(scene));
    assert.ok(parts.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0) < 2000);
    for (const mesh of parts) {
      const vertices = mesh.getVerticesData('position')!;
      assert.ok(vertices.every(Number.isFinite));
      for (let i = 0; i < vertices.length; i += 3) {
        assert.ok(Math.hypot(vertices[i], vertices[i + 2]) < .85, 'every rotated vertex stays inside the movement collider');
        assert.ok(vertices[i + 1] >= 0);
      }
    }
  } finally { scene.dispose(); engine.dispose(); }
});
