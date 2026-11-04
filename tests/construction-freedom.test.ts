import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { buildingAt, buildingDoor, placementReason, placementWarning } from '../src/game/construction.ts';
import { LANDSCAPE, WAREHOUSE_DOOR, WORLD_BOUNDS, gridPoint } from '../src/game/world-data.ts';
import { economyObstacles, ECONOMY_CONFIG } from '../src/game/economy-config.ts';
import { findPath } from '../src/game/pathfinding.ts';
import { planWorkApproach } from '../src/game/work-navigation.ts';
import { createEconomyController } from '../src/game/economy-controller.ts';
import type { Obstacle } from '../src/game/movement.ts';

function funded() {
  const e = new Economy(); e.setLeadership(false);
  e.state.inventory = { wood: 200, stone: 200, food: 0, iron: 0 };
  return e;
}

test('corridors and former gathering-only regions accept buildings with the real footprint', () => {
  for (const p of [{ x: -28, z: 8 }, ...['orchard', 'stone-hollow'].map(id => LANDSCAPE.regions.find(r => r.id === id)!)]) {
    const e = funded(), result = e.placeBuilding(p.x === -28 ? 'house' : 'farm', p);
    assert.ok(result.ok, result.message);
    assert.equal(result.task?.origin, 'manual');
    const restored = decodeEconomy(encodeEconomy(e));
    assert.ok(restored.taskFor(result.task!.target));
  }
});

test('blocking an existing entrance or warehouse route warns without rejecting or losing reservations', () => {
  const e = funded(), site = buildingAt('tower', { x: 4.2, z: 1.2 });
  assert.equal(placementReason(site, e.state), '');
  assert.match(placementWarning(site, e.state), /出入.*仍可/);
  const result = e.placeBuilding('tower', site); assert.ok(result.ok, result.message);
  assert.match(result.warning!, /通路.*仍可/); assert.equal(result.task?.reserved, true);
  assert.equal(findPath(WAREHOUSE_DOOR, buildingDoor(site), .35, WORLD_BOUNDS, economyObstacles(e.state.depleted, e.state.sites, [])), undefined);
  const restored = decodeEconomy(encodeEconomy(e));
  assert.equal(restored.state.sites.length, 1); assert.equal(restored.taskFor(result.task!.target)?.reserved, true);
  restored.cancel(result.task!.id); assert.equal(restored.state.sites.length, 0);
  assert.equal(restored.available().wood, 200);
});

test('unreachable construction waits without progress and resumes via a real route when cleared', () => {
  const e = funded(), placed = e.placeBuilding('house', gridPoint(44, 56)), task = placed.task!;
  assert.ok(placed.ok, placed.message);
  const site = e.state.sites[0], door = buildingDoor(site), start = { x: 0, z: -3 };
  const blockers: Obstacle[] = [{ kind: 'box', ...door, halfWidth: 1, halfDepth: 1 }];
  type Residents = Parameters<typeof createEconomyController>[2];
  let work: ReturnType<Residents['farmerWorkState']>;
  const readWork = () => work;
  const controller = createEconomyController(e, { sync: () => false, workPoints: () => ({ points: [door], target: site }) }, {
    farmerIds: () => ['farmer'], farmerPosition: () => start, canWork: () => true, hasMoveCommand: () => false,
    command: () => false, farmerWorkState: () => work, releaseFarmerWork: () => { work = undefined; },
    beginFarmerWork: id => { work = { id, status: 'working' }; },
    planFarmerWork: points => planWorkApproach(start, points, .35, WORLD_BOUNDS,
      [...economyObstacles(e.state.depleted, e.state.sites, []), ...blockers], []),
    startFarmerWork: (id, path) => { work = { id, status: 'travelling', path }; },
  }, false);
  controller.update(.05); assert.equal(task.status, 'waiting'); assert.match(task.reason, /无法到达/);
  assert.equal(task.progress, 0); assert.equal(task.reserved, true); assert.equal(readWork(), undefined);
  blockers.length = 0;
  controller.update(ECONOMY_CONFIG.retrySeconds + .1); const started = readWork();
  assert.equal(started?.status, 'travelling');
  assert.deepEqual(started?.path?.at(-1), door); assert.equal(task.progress, 0);
  started!.status = 'arrived'; controller.update(.05); controller.update(ECONOMY_CONFIG.workSeconds.build);
  assert.equal(task.status, 'done'); assert(e.state.buildings.includes(site.id));
  assert.equal(e.state.inventory.wood, 188); assert.equal(e.state.inventory.stone, 192);
});
