import assert from 'node:assert/strict';
import test from 'node:test';
import { isBlocked, moveCharacter, normalizeInput } from '../src/game/movement.ts';
import { createLandGrid, OBSTACLES, PLAYER_RADIUS, SPAWN, WORLD_BOUNDS } from '../src/game/world-data.ts';
import type { Obstacle } from '../src/game/movement.ts';

const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

test('diagonal movement has the same speed as axial movement, while analog input keeps its magnitude', () => {
  const diagonal = normalizeInput(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-10);
  assert.deepEqual(normalizeInput(0.2, -0.3), { x: 0.2, z: -0.3 });
  const axial = moveCharacter({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.1, 4, bounds, []);
  const combined = moveCharacter({ x: 0, z: 0 }, { x: 1, z: 1 }, 0.1, 4, bounds, []);
  assert.ok(Math.abs(Math.hypot(combined.x, combined.z) - axial.x) < 1e-10);
});

test('accepts vector-style accessor properties without mutating the engine object', () => {
  class EngineVector { get x() { return 1; } get z() { return 2; } }
  const vector = new EngineVector();
  const result = moveCharacter(vector, { x: 0, z: 1 }, 0.1, 3, bounds, []);
  assert.equal(result.x, 1); assert.ok(Math.abs(result.z - 2.3) < 1e-10);
  assert.equal(vector.z, 2);
});

test('a thin wall cannot be tunneled through, including after a long frame', () => {
  const wall: Obstacle = { kind: 'box', x: 1, z: 0, halfWidth: 0.03, halfDepth: 3 };
  const result = moveCharacter({ x: 0, z: 0 }, { x: 1, z: 0 }, 10, 20, bounds, [wall]);
  assert.ok(result.x <= 0.67);
  assert.equal(isBlocked(result, 0.3, [wall]), false);
});

test('the player slides along a wall instead of sticking when moving diagonally', () => {
  const wall: Obstacle = { kind: 'box', x: 1, z: 0, halfWidth: 0.2, halfDepth: 3 };
  const result = moveCharacter({ x: 0.49, z: 0 }, { x: 1, z: 1 }, 0.1, 4, bounds, [wall]);
  assert.ok(result.x < 0.5); assert.ok(result.z > 0.2);
});

test('circle obstacles and rounded box corners use the character radius', () => {
  assert.equal(isBlocked({ x: 1.2, z: 0 }, 0.3, [{ kind: 'circle', x: 0, z: 0, radius: 1 }]), true);
  assert.equal(isBlocked({ x: 1.2, z: 1.2 }, 0.3, [{ kind: 'box', x: 0, z: 0, halfWidth: 1, halfDepth: 1 }]), true);
  assert.equal(isBlocked({ x: 1.3, z: 1.3 }, 0.3, [{ kind: 'box', x: 0, z: 0, halfWidth: 1, halfDepth: 1 }]), false);
});

test('map bounds include the character radius on all four edges', () => {
  for (const side of [-1, 1]) {
    const result = moveCharacter({ x: 9.6 * side, z: 9.6 * side }, { x: side, z: side }, 0.1, 4, bounds, []);
    assert.ok(Math.abs(result.x) <= 9.7); assert.ok(Math.abs(result.z) <= 9.7);
  }
});

test('zero input and nonpositive elapsed time never move the character', () => {
  const from = { x: 2, z: -3 };
  assert.deepEqual(moveCharacter(from, { x: 0, z: 0 }, 1, 4, bounds, []), from);
  assert.deepEqual(moveCharacter(from, { x: 1, z: 1 }, -1, 4, bounds, []), from);
});

test('demo spawn is walkable and the land grid records all terrain categories', () => {
  assert.equal(isBlocked(SPAWN, PLAYER_RADIUS, OBSTACLES), false);
  const grid = createLandGrid();
  assert.equal(grid.length, (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ));
  assert.deepEqual(new Set(grid.map((cell) => cell.type)), new Set(['grass', 'path', 'garden', 'water', 'building']));
});
