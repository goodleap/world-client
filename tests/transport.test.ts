import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, decodeEconomy, encodeEconomy } from '../src/game/economy.ts';
import { ECONOMY_CONFIG as C } from '../src/game/economy-config.ts';
function gather() {
  const e = new Economy(); e.request('chop', 'tree-0');
  const task = e.claim()!; e.arrive(task.id); e.advance(5);
  return e;
}
function collect(e: Economy) {
  const t = e.request('haul', e.state.goods[0].id).task!;
  assert.equal(e.claim()?.id, t.id); e.arrive(t.id); return t;
}
test('production stays on ground and in transit until one warehouse delivery', () => {
  const e = gather(); assert.equal(e.state.inventory.wood, 8);
  assert.equal(e.state.goods[0].amount, 16); assert.deepEqual(e.state.depleted, ['tree-0']);
  const t = collect(e); assert.equal(e.state.goods[0].state, 'transit'); assert.equal(e.state.inventory.wood, 8);
  e.arrive(t.id); e.arrive(t.id); e.advance(100);
  assert.equal(e.state.inventory.wood, 24); assert.equal(e.state.goods.length, 0);
});
test('interruption and unreachable warehouse preserve cargo at the actual drop point', () => {
  const e = gather(), t = collect(e);
  e.interrupt({ x: 4, z: 2 }); assert.equal(e.state.goods[0].state, 'ground'); assert.equal(e.state.goods[0].x, 4);
  e.claim(); e.arrive(t.id); e.defer(t.id, 'blocked', { x: 5, z: 3 });
  assert.equal(e.state.goods[0].amount, 16); assert.equal(e.state.goods[0].x, 5);
  assert.equal(e.state.inventory.wood, 8); assert.equal(e.claim(), undefined);
});
test('full storage keeps remainder and a restored haul delivers it exactly once', () => {
  const e = gather(), t = collect(e); e.state.inventory.wood = C.capacity.wood - 5;
  e.arrive(t.id); assert.equal(e.state.inventory.wood, C.capacity.wood); assert.equal(e.state.goods[0].amount, 11);
  assert.equal(e.claim(), undefined);
  const resumed = decodeEconomy(encodeEconomy(e)); resumed.state.inventory.wood -= 20; resumed.advance(C.retrySeconds);
  const task = resumed.claim()!; resumed.arrive(task.id); resumed.arrive(task.id);
  assert.equal(resumed.state.inventory.wood, C.capacity.wood - 9); assert.equal(resumed.state.goods.length, 0);
});

test('save restores in-transit ownership, positions, manager clock and a manual destination', () => {
  const e = gather(), t = collect(e);
  e.updateCargo({x:2,z:3});
  e.state.residents = { farmer: { position: {x:2,z:3} }, 'farmer-2': { position:{x:0,z:0}, manualGoal:{x:-3,z:1} } };
  e.state.steward.nextDecision = e.state.seconds + .5;
  const resumed = decodeEconomy(encodeEconomy(e));
  assert.equal(resumed.state.goods[0].state, 'transit'); assert.equal(resumed.active()?.status, 'delivering');
  assert.deepEqual(JSON.parse(JSON.stringify(resumed.state.residents)), e.state.residents);
  assert.equal(resumed.state.steward.nextDecision, e.state.steward.nextDecision);
  resumed.arrive(t.id); resumed.arrive(t.id);
  assert.equal(resumed.state.inventory.wood, 24); assert.equal(resumed.state.goods.length, 0);
});
