import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { findPath } from '../src/game/pathfinding.ts';
import { segmentIsClear } from '../src/game/wander.ts';
import type { Obstacle } from '../src/game/movement.ts';

test('finds a route around a wall, rejects blocked or unreachable destinations', () => {
  const bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  const wall: Obstacle[] = [{ kind: 'box', x: 0, z: 0, halfWidth: 0.4, halfDepth: 1.8 }];
  const start = { x: -3, z: 0 }, goal = { x: 3, z: 0 };
  const route = findPath(start, goal, 0.3, bounds, wall);
  assert.ok(route && route.length > 1);
  let previous = start;
  for (const point of route) { assert.equal(segmentIsClear(previous, point, 0.3, bounds, wall), true); previous = point; }
  assert.deepEqual(previous, goal);
  assert.equal(findPath(start, { x: 0, z: 0 }, 0.3, bounds, wall), undefined);
  assert.equal(findPath(start, goal, 0.3, bounds, [{ kind: 'box', x: 0, z: 0, halfWidth: 0.4, halfDepth: 5 }]), undefined);
});
