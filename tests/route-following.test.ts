import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteState, stepRoute } from '../src/game/route-following.ts';
import type { Neighbour } from '../src/game/route-following.ts';
import type { Point } from '../src/game/movement.ts';

const bounds = { minX: -5, maxX: 5, minZ: -4, maxZ: 4 };
const neighbour = (id: string, position: Point, moving = false): Neighbour => ({ id, position, radius: .4, moving, purposeful: false, waiting: false });

test('a command detours around an idle resident and reaches its original destination without overlap', () => {
  const route = [{ x: 3, z: 0 }], state = createRouteState(), other = neighbour('farmer', { x: 0, z: 0 });
  let position = { x: -3, z: 0 }, widest = 0;
  for (let i = 0; i < 240 && route.length; i++) {
    const next = stepRoute('base', position, route, state, .05, 3, .35, bounds, [], [other]);
    assert.ok(Math.hypot(next.position.x - position.x, next.position.z - position.z) <= .15 + 1e-8);
    position = next.position; widest = Math.max(widest, Math.abs(position.z));
    assert.ok(Math.hypot(position.x, position.z) >= .75 - 1e-8);
  }
  assert.equal(route.length, 0); assert.ok(widest > .75); assert.ok(state.replans > 0);
  assert.ok(Math.hypot(position.x - 3, position.z) < .03);
});

test('crossing traffic causes a stable wait, then movement resumes after it passes', () => {
  const route = [{ x: 3, z: 0 }], state = createRouteState();
  let position = { x: -1.3, z: 0 }, stoppedFrames = 0, resumed = false;
  for (let i = 0; i < 100; i++) {
    const other = neighbour('crossing', { x: -.15, z: -.3 + i * .05 * 1.5 }, true);
    const next = stepRoute('base', position, route, state, .05, 3, .35, bounds, [], [other]);
    if (!next.velocity.x && !next.velocity.z && route.length) stoppedFrames++;
    else if (stoppedFrames) resumed = true;
    assert.ok(Math.hypot(next.position.x - other.position.x, next.position.z - other.position.z) >= .75 - 1e-8);
    position = next.position;
  }
  assert.ok(stoppedFrames >= 7, 'wait lasts at least .35 s, not alternating run/idle frames');
  assert.ok(resumed); assert.equal(route.length, 0);
});

test('two opposing commands pass without dropping either command or interpenetrating', () => {
  const actors = [
    { id: 'a', position: { x: -3, z: 0 }, route: [{ x: 3, z: 0 }], state: createRouteState(), moving: true },
    { id: 'b', position: { x: 3, z: 0 }, route: [{ x: -3, z: 0 }], state: createRouteState(), moving: true },
  ];
  for (let i = 0; i < 400 && actors.some(a => a.route.length); i++) for (const actor of actors) {
    const other = actors.find(a => a !== actor)!;
    const next = stepRoute(actor.id, actor.position, actor.route, actor.state, .05, 3, .4, bounds, [], [{
      ...neighbour(other.id, other.position, other.moving), purposeful: !!other.route.length, waiting: other.state.waiting,
    }]);
    actor.position = next.position; actor.moving = Math.hypot(next.velocity.x, next.velocity.z) > .08;
    assert.ok(Math.hypot(actor.position.x - other.position.x, actor.position.z - other.position.z) >= .8 - 1e-8);
  }
  assert.ok(actors.every(a => !a.route.length), JSON.stringify(actors));
});

test('an occupied destination waits without losing work; paused ticks preserve the wait and route', () => {
  const state = createRouteState(), route = [{ x: 0, z: 0 }], original = { x: -1, z: 0 };
  const occupant = neighbour('other', { x: 0, z: 0 });
  let position = original;
  for (let i = 0; i < 100; i++) position = stepRoute('farmer', position, route, state, .05, 3, .3, bounds, [], [occupant]).position;
  assert.deepEqual(position, original); assert.equal(route.length, 1);
  const frozen = structuredClone(state);
  stepRoute('farmer', position, route, state, 0, 3, .3, bounds, [], []);
  assert.deepEqual(state, frozen);
  for (let i = 0; i < 40; i++) position = stepRoute('farmer', position, route, state, .05, 3, .3, bounds, [], []).position;
  assert.equal(route.length, 0); assert.ok(Math.hypot(position.x, position.z) < .03);
});

test('nearby residents can swap occupied destinations without a permanent mutual wait', () => {
  const actors = [
    { id: 'a', position: { x: -.6, z: 0 }, route: [{ x: .6, z: 0 }], state: createRouteState(), moving: true },
    { id: 'b', position: { x: .6, z: 0 }, route: [{ x: -.6, z: 0 }], state: createRouteState(), moving: true },
  ];
  for (let i = 0; i < 240 && actors.some(a => a.route.length); i++) for (const actor of actors) {
    const other = actors.find(a => a !== actor)!;
    const next = stepRoute(actor.id, actor.position, actor.route, actor.state, .05, 3, .4, bounds, [], [{
      ...neighbour(other.id, other.position, other.moving), purposeful: !!other.route.length, waiting: other.state.waiting,
    }]);
    actor.position = next.position; actor.moving = Math.hypot(next.velocity.x, next.velocity.z) > .08;
    assert.ok(Math.hypot(actor.position.x - other.position.x, actor.position.z - other.position.z) >= .8 - 1e-8);
  }
  assert.ok(actors.every(a => !a.route.length), JSON.stringify(actors));
});

test('physical and floating-point overlaps recover gradually without losing the command', () => {
  for (const initial of [.7, .8 - 5e-7]) {
  const route = [{ x: 3, z: 0 }], state = createRouteState(), other = neighbour('idle', { x: 0, z: 0 });
  let position = { x: -initial, z: 0 }, previousSeparation = initial;
  for (let i = 0; i < 240 && route.length; i++) {
    const next = stepRoute('moving', position, route, state, .05, 3, .4, bounds, [], [other]);
    const separation = Math.hypot(next.position.x, next.position.z);
    if (previousSeparation < .8) assert.ok(separation >= previousSeparation - 1e-8);
    else assert.ok(separation >= .8 - 1e-8);
    assert.ok(Math.hypot(next.position.x - position.x, next.position.z - position.z) <= .15 + 1e-8);
    position = next.position; previousSeparation = separation;
  }
  assert.equal(route.length, 0); assert.ok(Math.hypot(position.x - 3, position.z) < .03);
  }
});

test('an idle resident on an intermediate waypoint does not pin the command to that obsolete waypoint', () => {
  const route = [{ x: 0, z: 0 }, { x: 3, z: 0 }], state = createRouteState();
  let position = { x: -3, z: 0 };
  for (let i = 0; i < 240 && route.length; i++) position = stepRoute('moving', position, route, state, .05, 3, .4, bounds, [], [neighbour('idle', { x: 0, z: 0 })]).position;
  assert.equal(route.length, 0); assert.ok(Math.hypot(position.x - 3, position.z) < .03);
  assert.equal(state.searches, 0, 'ordinary bypasses need no grid search');
});

test('head-on traffic shares a narrow passage by yielding sideways, including slow-frame substeps', () => {
  const narrow = { ...bounds, minZ: -.9, maxZ: .9 };
  const actors = [
    { id: 'a', position: { x: -3, z: 0 }, route: [{ x: 3, z: 0 }], state: createRouteState(), moving: true },
    { id: 'b', position: { x: 3, z: 0 }, route: [{ x: -3, z: 0 }], state: createRouteState(), moving: true },
  ];
  for (let frame = 0; frame < 80 && actors.some(a => a.route.length); frame++) for (const actor of actors) for (let substep = 0; substep < 10 && actor.route.length; substep++) {
    const other = actors.find(a => a !== actor)!;
    const next = stepRoute(actor.id, actor.position, actor.route, actor.state, .05, 6, .4, narrow, [], [{
      ...neighbour(other.id, other.position, other.moving), purposeful: !!other.route.length, waiting: other.state.waiting,
    }]);
    actor.position = next.position; actor.moving = Math.hypot(next.velocity.x, next.velocity.z) > .08;
    assert.ok(Math.abs(actor.position.z) <= .5 + 1e-8);
    assert.ok(Math.hypot(actor.position.x - other.position.x, actor.position.z - other.position.z) >= .8 - 1e-8);
  }
  assert.ok(actors.every(a => !a.route.length), JSON.stringify(actors));
  assert.ok(actors.every(a => a.state.searches < 10), 'local search budget remains bounded');
});

test('a fully occupied passage retains the goal and throttles failed local searches', () => {
  const narrow = { ...bounds, minZ: -.7, maxZ: .7 }, state = createRouteState(), route = [{ x: 3, z: 0 }];
  const occupant = { ...neighbour('idle', { x: 0, z: 0 }), radius: .65 };
  let position = { x: -1.1, z: 0 };
  for (let i = 0; i < 200; i++) position = stepRoute('moving', position, route, state, .05, 3, .3, narrow, [], [occupant]).position;
  assert.equal(route.length, 1); assert.ok(state.searches <= 16, String(state.searches));
  for (let i = 0; i < 80 && route.length; i++) position = stepRoute('moving', position, route, state, .05, 3, .3, narrow, [], []).position;
  assert.equal(route.length, 0);
});
