import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, initialEconomy, debugRequested, DEBUG_RESOURCES, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { ECONOMY_CONFIG } from '../src/game/economy-config.ts';
import { gridPoint } from '../src/game/world-data.ts';

test('debug is an exact query key, independent of its value', () => {
  for (const url of ['?debug', '?debug=1', '?debug=false', '?foo=1&debug=']) assert(debugRequested(url));
  for (const url of ['', '?foo=debug', '?Debug=1', '?nodebug']) assert(!debugRequested(url));
});

test('debug inventory and capacity persist without refilling spent resources on load', () => {
  const normal = new Economy(initialEconomy(1));
  assert.deepEqual(normal.state.inventory, ECONOMY_CONFIG.initialInventory);
  assert.deepEqual(normal.capacity(), ECONOMY_CONFIG.capacity);
  const e = new Economy(initialEconomy(1, true));
  assert(Object.values(e.state.inventory).every(n => n === DEBUG_RESOURCES));
  assert(Object.values(e.capacity()).every(n => n >= DEBUG_RESOURCES));
  const task = e.placeBuilding('house', gridPoint(44, 56)).task!;
  e.assign(task.id); e.arrive(task.id); e.advance(ECONOMY_CONFIG.workSeconds.build);
  const saved = decodeEconomy(encodeEconomy(e));
  assert.equal(saved.state.inventory.wood, DEBUG_RESOURCES - 12);
  assert.equal(saved.state.debug, true);
  assert.deepEqual(saved.capacity(), e.capacity());
  assert.deepEqual(decodeEconomy(encodeEconomy(saved)).state.inventory, saved.state.inventory);
  const corrupt = JSON.parse(encodeEconomy(saved)); corrupt.debug = false;
  assert.throws(() => decodeEconomy(JSON.stringify(corrupt)), /库存|仓/);
});
