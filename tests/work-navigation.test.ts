import test from 'node:test';
import assert from 'node:assert/strict';
import { planMoveDestination, planWorkApproach } from '../src/game/work-navigation.ts';
const bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
const points = [{ x: 0, z: 0 }, { x: .8, z: 0 }, { x: -.8, z: 0 }];
test('workers reserve different approach points and bypass standing occupants', () => {
  const first = planWorkApproach({ x: 0, z: -3 }, points, .29, bounds, [], []);
  assert.deepEqual(first?.at(-1), points[0]);
  const second = planWorkApproach({ x: 1, z: -3 }, points, .29, bounds, [], [{ position: { x: 0, z: -2 }, radius: .29, destination: first!.at(-1) }]);
  assert.deepEqual(second?.at(-1), points[1]);
  const retargeted = planWorkApproach({ x: 1, z: -1 }, points, .29, bounds, [], [{ position: points[1], radius: .29 }]);
  assert.deepEqual(retargeted?.at(-1), points[0]);
  assert.equal(planWorkApproach({ x: 0, z: -3 }, points, .29, bounds, [], points.map(position => ({ position, radius: .29 }))), undefined);
});

test('neighbouring manual commands reserve separate reachable arrival positions', () => {
  const point = { x: 0, z: 3 }, first = planMoveDestination({ x: -.3, z: -3 }, point, .29, bounds, [], []);
  assert.deepEqual(first?.at(-1), point);
  for (const offset of [0, .01, .3]) {
    const second = planMoveDestination({ x: .3, z: -3 }, { x: offset, z: 3 }, .29, bounds, [], [
      { position: { x: -.3, z: -3 }, radius: .29, destination: first!.at(-1) },
    ]);
    assert(second);
    const goal = second.at(-1)!;
    assert(Math.hypot(goal.x - point.x, goal.z - point.z) >= .66);
    assert(Math.hypot(goal.x - offset, goal.z - 3) < .7, 'keep the command near the clicked ground');
  }
  assert.equal(planMoveDestination({ x: 0, z: 0 }, { x: 6, z: 0 }, .29, bounds, [], []), undefined);
  assert.equal(planMoveDestination({ x: 0, z: 0 }, point, .29, bounds,
    [{ kind: 'circle', ...point, radius: 1 }], []), undefined, 'invalid terrain must not silently redirect the click');
});
