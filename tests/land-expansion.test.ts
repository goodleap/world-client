import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, decodeEconomy, encodeEconomy, pending } from '../src/game/economy.ts';
import { buildingDoor } from '../src/game/construction.ts';
import { ECONOMY_CONFIG as C, FARM_PLOTS } from '../src/game/economy-config.ts';
import { gridPoint, WAREHOUSE_DOOR } from '../src/game/world-data.ts';
import { createSteward } from '../src/game/steward.ts';

test('all opening plots are tilled and four adjacent extensions reserve independent grid cells', () => {
  const e = new Economy();
  assert.equal(e.state.plots.length, FARM_PLOTS.length);
  assert(e.state.plots.every(plot => plot.tilled));
  const inventory = { ...e.state.inventory };
  for (let column = 51.5; column < 55; column++) {
    const point = gridPoint(column, 55.5), result = e.placeBuilding('farm', point);
    assert(result.ok, result.message);
    assert.equal(result.task!.kind, 'till');
    assert.deepEqual(e.plot(result.task!.target), { id: result.task!.target, ...point, tilled: false, growth: 0 });
    assert.equal(e.placeBuilding('farm', point).ok, false);
    assert.equal(e.placeBuilding('house', point).ok, false);
  }
  assert.deepEqual(e.state.inventory, inventory, 'tilling uses work without a material charge');
  const restored = decodeEconomy(encodeEconomy(e));
  assert.equal(restored.state.plots.length, 16);
  assert.equal(restored.state.tasks.filter(pending).length, 4);
});

test('farm placement allows roads and cancellation restores the cell without reusing its identity', () => {
  const e = new Economy(), point = gridPoint(51.5, 55.5);
  const road=e.placeBuilding('farm',gridPoint(50.5,50.5));assert(road.ok);e.cancel(road.task!.id);
  const first = e.placeBuilding('farm', point).task!;
  e.claim(); e.arrive(first.id); e.advance(1);
  assert(e.cancel(first.id)); assert.equal(e.plot(first.target), undefined);
  const restored = decodeEconomy(encodeEconomy(e));
  const second = restored.placeBuilding('farm', point).task!;
  assert.notEqual(second.target, first.target);
  assert.equal(second.progress, 0);
  const old = JSON.parse(encodeEconomy(e)); old.version = 3;
  assert.throws(() => decodeEconomy(JSON.stringify(old)), /版本/);
});

test('dynamic farmland restores partial tilling and joins automatic sowing without a six-field ceiling', () => {
  const e = new Economy(), task = e.placeBuilding('farm', gridPoint(51.5, 55.5)).task!;
  e.claim(); e.arrive(task.id); e.advance(1.25);
  const resumed = decodeEconomy(encodeEconomy(e));
  assert.equal(resumed.taskFor(task.target)?.progress, 1.25);
  resumed.arrive(resumed.claim()!.id); resumed.advance(C.workSeconds.till - 1.25);
  assert(resumed.plot(task.target)?.tilled);
  for (const plot of resumed.state.plots) if (plot.id !== task.target) { plot.crop = 'wheat'; plot.growth = 0; }
  createSteward(resumed).requestWork(resumed.plot(task.target)!);
  assert.equal(resumed.taskFor(task.target)?.kind, 'sow');
  assert.equal(resumed.state.tasks.filter(t => pending(t) && t.kind === 'sow').length, 1);
  assert.equal(resumed.state.plots.length, 13, 'the leader uses player-created land instead of opening land independently');
});

test('only completed warehouses add shared capacity and delivery doors; reservations spend once', () => {
  const e = new Economy(); e.state.inventory = { wood: 60, stone: 40, food: 0, iron: 0 };
  const result = e.placeBuilding('warehouse', gridPoint(55.5, 57));
  assert(result.ok, result.message); const task = result.task!, site = e.state.sites[0];
  assert.deepEqual(e.reserved(), C.warehouseCost);
  assert.deepEqual(e.capacity(), C.capacity);
  assert.deepEqual(e.warehouseDoors(), [WAREHOUSE_DOOR]);
  e.claim(); e.arrive(task.id); e.advance(2);
  const resumed = decodeEconomy(encodeEconomy(e));
  assert.deepEqual(resumed.reserved(), C.warehouseCost);
  resumed.arrive(resumed.claim()!.id); resumed.advance(C.workSeconds.build - 2);
  assert.deepEqual(resumed.capacity(), { wood: 4000, stone: 4000, food: 8000, iron: 1600 });
  assert.deepEqual(resumed.warehouseDoors(), [WAREHOUSE_DOOR, buildingDoor(site)]);
  assert.deepEqual(resumed.state.inventory, { wood: 36, stone: 24, food: 0, iron: 0 });
  resumed.advance(100); assert.equal(resumed.state.inventory.wood, 36);
  resumed.state.inventory.wood = C.capacity.wood + 1;
  assert.equal(decodeEconomy(encodeEconomy(resumed)).state.inventory.wood, 2001);
  resumed.state.inventory.wood = resumed.capacity().wood + 1;
  assert.throws(() => decodeEconomy(encodeEconomy(resumed)), /容量/);
});

test('cancelling warehouse construction releases materials and never adds capacity', () => {
  const e = new Economy(); e.state.inventory = { ...C.warehouseCost };
  const task = e.placeBuilding('warehouse', gridPoint(55.5, 57)).task!;
  assert(e.cancel(task.id));
  assert.deepEqual(e.state.inventory, C.warehouseCost);
  assert.deepEqual(e.reserved(), { wood: 0, stone: 0, food: 0, iron: 0 });
  assert.deepEqual(e.capacity(), C.capacity);
  assert.equal(decodeEconomy(encodeEconomy(e)).state.sites.length, 0);
});

test('funded warehouse materials remain reserved while the steward schedules crop work', () => {
  const e = new Economy(); e.state.inventory = { ...C.warehouseCost };
  const warehouse = e.placeBuilding('warehouse', gridPoint(55.5, 57)).task!;
  assert.equal(warehouse.reserved, true); assert.equal(e.available().wood, 0);
  createSteward(e).requestWork();
  assert.equal(e.state.tasks.filter(t => t.origin === 'steward').length, 1);
  assert.deepEqual(e.reserved(), C.warehouseCost);
  assert.equal(e.claim('farmer')!.id, warehouse.id);
  e.cancel(warehouse.id);
  assert.equal(e.available().wood, C.warehouseCost.wood);
  createSteward(e).requestWork();
  assert.equal(e.claim('farmer-2')?.kind, 'harvest', 'ordinary crop priority resumes after construction is cancelled');
});

test('a full expanded warehouse leaves overflow at the actual delivery door', () => {
  const e = new Economy(); e.state.inventory = { ...C.warehouseCost };
  const task = e.placeBuilding('warehouse', gridPoint(55.5, 57)).task!;
  e.claim(); e.arrive(task.id); e.advance(C.workSeconds.build);
  e.state.inventory.wood = e.capacity().wood - 2;
  const door = e.warehouseDoors()[1];
  e.state.goods.push({ id: 'goods-2', ...gridPoint(51.5, 55.5), resource: 'wood', amount: 8, state: 'ground' });
  const haul = e.request('haul', 'goods-2').task!; e.claim(); e.arrive(haul.id);
  e.updateCargo(door); e.arrive(haul.id);
  assert.equal(e.state.inventory.wood, 4000);
  assert.deepEqual(e.state.goods[0], { id: 'goods-2', ...door, resource: 'wood', amount: 6, state: 'ground', carrier: undefined });
  const resumed = decodeEconomy(encodeEconomy(e)); resumed.state.inventory.wood -= 6; resumed.advance(C.retrySeconds);
  const retry = resumed.claim()!; resumed.arrive(retry.id); resumed.updateCargo(door); resumed.arrive(retry.id); resumed.arrive(retry.id);
  assert.equal(resumed.state.inventory.wood, 4000); assert.equal(resumed.state.goods.length, 0);
});
