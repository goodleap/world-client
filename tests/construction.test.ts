import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { buildingAt, placementReason } from '../src/game/construction.ts';
import { GRID_SIZE, HOME, WAREHOUSE_DOOR, POND, gridPoint } from '../src/game/world-data.ts';
import { FARM_PLOTS, RESOURCE_NODES } from '../src/game/economy-config.ts';

test('free placement snaps footprint edges, queues unfunded work, rejects overlap and releases cancelled land', () => {
  const e = new Economy(), point = gridPoint(44, 56);
  assert.equal(e.state.sites.length, 0);
  const result = e.placeBuilding('house', { x: point.x + .2, z: point.z - .3 });
  assert.ok(result.ok); assert.match(result.message, /缺少/);
  const site = e.state.sites[0];
  assert.ok(Math.abs(site.x - point.x) < 1e-9 && Math.abs(site.z - point.z) < 1e-9);
  assert.ok(Math.abs((site.x - site.width / 2) / GRID_SIZE - Math.round((site.x - site.width / 2) / GRID_SIZE)) < 1e-9);
  assert.equal(e.placeBuilding('house', point).ok, false);
  e.cancel(result.task!.id);
  const resumed = decodeEconomy(encodeEconomy(e));
  assert.equal(resumed.state.sites.length, 0);
  assert.ok(resumed.placeBuilding('house', point).ok);
  assert.notEqual(resumed.state.sites[0].id, site.id);
});

test('placement reserves farm, water, resources, residents, loose goods and entrances', () => {
  const e = new Economy();
  for (const point of [HOME, POND, FARM_PLOTS[0], RESOURCE_NODES[0], WAREHOUSE_DOOR, { x: 1000, z: 0 }]) {
    assert.equal(e.placeBuilding('house', point).ok, false, JSON.stringify(point));
  }
  const point = gridPoint(44, 56), site = buildingAt('house', point);
  assert.match(placementReason(site, e.state, [{ ...point, kind: 'circle', radius: .3 }]), /人物/);
  e.state.goods.push({ ...point, id: 'goods-1', resource: 'wood', amount: 8, state: 'ground' });
  assert.match(placementReason(site, e.state), /资源/);
});

test('dynamic building coordinates and partial work survive save/load; obsolete versions are rejected', () => {
  const e = new Economy(); e.state.inventory = { wood: 30, stone: 20, food: 0 };
  const result = e.placeBuilding('house', gridPoint(58, 58)); assert.ok(result.ok, result.message);
  const task = e.claim()!; e.arrive(task.id); e.advance(2);
  const resumed = decodeEconomy(encodeEconomy(e));
  assert.deepEqual(resumed.state.sites, e.state.sites); assert.equal(resumed.state.tasks[0].progress, 2);
  resumed.arrive(resumed.claim()!.id); resumed.advance(6);
  const built = decodeEconomy(encodeEconomy(resumed));
  assert.deepEqual(built.state.buildings, [result.task!.target]); assert.equal(built.state.inventory.wood, 18);
  const old = JSON.parse(encodeEconomy(e)); old.version = 2; delete old.sites; delete old.nextSiteId;
  assert.throws(() => decodeEconomy(JSON.stringify(old)), /版本/);
  const corrupt = JSON.parse(encodeEconomy(e)); corrupt.sites[0].x += .25;
  assert.throws(() => decodeEconomy(JSON.stringify(corrupt)), /网格/);
});
