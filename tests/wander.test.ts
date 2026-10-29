import assert from 'node:assert/strict';
import test from 'node:test';
import { isBlocked } from '../src/game/movement.ts';
import type { Obstacle } from '../src/game/movement.ts';
import { RESIDENTS, RESIDENT_OBSTACLES, wanderSettings } from '../src/game/resident-data.ts';
import { createWanderState, inBounds, seededRandom, segmentIsClear, stepWander } from '../src/game/wander.ts';
import type { WanderSettings } from '../src/game/wander.ts';

const settings: WanderSettings = {
  home: { x: 0, z: 0 }, areaRadius: 3, bodyRadius: 0.3, speed: 1.2,
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
};

test('all residents spawn on traversable land without overlapping each other', () => {
  assert.equal(RESIDENTS.length, 7);
  for (let i = 0; i < RESIDENTS.length; i++) {
    const actor = RESIDENTS[i];
    const state = createWanderState(actor.spawn, wanderSettings(actor), RESIDENT_OBSTACLES, seededRandom(i));
    assert.equal(isBlocked(state.position, actor.bodyRadius, RESIDENT_OBSTACLES), false);
    for (const other of RESIDENTS.slice(i + 1)) {
      assert.ok(Math.hypot(actor.spawn.x - other.spawn.x, actor.spawn.z - other.spawn.z) > actor.bodyRadius + other.bodyRadius);
    }
  }
});

test('targets with clear endpoints are rejected if a wall crosses their route', () => {
  const wall: Obstacle = { kind: 'box', x: 0, z: 0, halfWidth: 0.04, halfDepth: 2 };
  assert.equal(segmentIsClear({ x: -2, z: 0 }, { x: 2, z: 0 }, 0.3, settings.bounds, [wall]), false);
  assert.equal(segmentIsClear({ x: -2, z: 3 }, { x: 2, z: 3 }, 0.3, settings.bounds, [wall]), true);
  assert.equal(segmentIsClear({ x: 0, z: 0 }, { x: 4.9, z: 0 }, 0.3, settings.bounds, []), false);
});

test('seeded residents wander for two simulated minutes without crossing solids or teleporting', () => {
  for (let index = 0; index < RESIDENTS.length; index++) {
    const definition = RESIDENTS[index], config = wanderSettings(definition);
    const random = seededRandom(624 + (index + 1) * 1337);
    const state = createWanderState(definition.spawn, config, RESIDENT_OBSTACLES, random);
    let idleFrames = 0;
    for (let frame = 0; frame < 3600; frame++) {
      const before = { ...state.position };
      const velocity = stepWander(state, config, 1 / 30, RESIDENT_OBSTACLES, random);
      if (velocity.x === 0 && velocity.z === 0) idleFrames++;
      assert.ok(inBounds(state.position, config.bodyRadius, config.bounds), definition.role);
      assert.equal(isBlocked(state.position, config.bodyRadius, RESIDENT_OBSTACLES), false, definition.role);
      assert.ok(Math.hypot(state.position.x - before.x, state.position.z - before.z) <= config.speed / 30 + 1e-8);
      assert.ok(Math.hypot(state.position.x - config.home.x, state.position.z - config.home.z) <= config.areaRadius + 0.01);
    }
    assert.ok(state.distanceTravelled > 15, `${definition.role} must actually walk`);
    assert.ok(state.destinationsReached >= 3, `${definition.role} must reach destinations`);
    assert.ok(idleFrames > 50, `${definition.role} should pause between trips`);
  }
});

test('a blocked resident waits and retries without teleporting or an unbounded search', () => {
  const cage: Obstacle[] = [
    { kind: 'box', x: -0.8, z: 0, halfWidth: 0.1, halfDepth: 1 },
    { kind: 'box', x: 0.8, z: 0, halfWidth: 0.1, halfDepth: 1 },
    { kind: 'box', x: 0, z: -0.8, halfWidth: 1, halfDepth: 0.1 },
    { kind: 'box', x: 0, z: 0.8, halfWidth: 1, halfDepth: 0.1 },
  ];
  const random = seededRandom(9);
  const state = createWanderState({ x: 0, z: 0 }, settings, cage, random);
  for (let frame = 0; frame < 300; frame++) stepWander(state, settings, 1 / 30, cage, random);
  assert.deepEqual(state.position, { x: 0, z: 0 });
  assert.equal(state.target, undefined);
  assert.ok(state.pause >= 0);
});

test('a newly arrived obstacle interrupts walking and causes the target to be reconsidered', () => {
  const state = createWanderState({ x: 0, z: 0 }, settings, [], seededRandom(3));
  state.pause = 0; state.target = { x: 3, z: 0 };
  const wall: Obstacle = { kind: 'box', x: 1, z: 0, halfWidth: 0.1, halfDepth: 4 };
  for (let frame = 0; frame < 150; frame++) {
    stepWander(state, settings, 1 / 30, [wall], () => 0.25);
    assert.ok(state.position.x <= 0.6 + 1e-9);
    assert.equal(isBlocked(state.position, settings.bodyRadius, [wall]), false);
  }
  assert.equal(state.target, undefined);
});

test('pausing freezes destinations and position, and an invalid spawn is rejected', () => {
  const random = seededRandom(17);
  const state = createWanderState({ x: 0, z: 0 }, settings, [], random);
  const initial = structuredClone(state);
  for (let i = 0; i < 30; i++) stepWander(state, settings, 0, [], random);
  assert.deepEqual(state, initial);
  assert.throws(() => createWanderState({ x: 6, z: 0 }, settings, [], random), /walkable/);
  assert.throws(() => createWanderState({ x: 0, z: 0 }, settings, [{ kind: 'circle', x: 0, z: 0, radius: 1 }], random), /walkable/);
});
