import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, initialEconomy, startingInventory, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { DEFAULT_GAME_SETUP, decodeGameSetup, homeName } from '../src/game/game-setup.ts';
import { readSavedGame } from '../src/game/economy-storage.ts';
import { Combat } from '../src/game/combat.ts';
import { Raids } from '../src/game/raids.ts';
import { RESIDENTS } from '../src/game/resident-data.ts';

test('difficulty changes real supplies and first-raid protection, and setup survives a round trip', () => {
  const setups = (['relaxed', 'standard', 'challenging'] as const).map(difficulty => ({ ...DEFAULT_GAME_SETUP, difficulty, homeName: '湖畔小村' }));
  const states = setups.map(setup => initialEconomy(41, false, setup));
  assert.deepEqual(states.map(s => s.inventory.food), [36, 24, 18]);
  assert.deepEqual(states.map(s => s.raids.nextAt), [120, 60, 36]);
  for (const [i, state] of states.entries()) {
    const restored = decodeEconomy(encodeEconomy(new Economy(state)));
    assert.deepEqual(restored.state.setup, setups[i]);
    assert.equal(restored.state.story?.stage, 'harvest');
    assert.deepEqual(restored.state.inventory, state.inventory);
    assert.equal(restored.state.raids.nextAt, state.raids.nextAt);
  }
  assert.equal(initialEconomy(41, false, { ...DEFAULT_GAME_SETUP, mode: 'free' }).story, null);
  assert.deepEqual(startingInventory(setups[2], true), { wood: 100000, stone: 100000, food: 100000, iron: 100000 });
});

test('invalid modes, difficulty and chapter metadata preserve the save as unreadable', () => {
  const valid = initialEconomy(41, false, DEFAULT_GAME_SETUP);
  for (const setup of [{ ...valid.setup, mode: 'unknown' }, { ...valid.setup, difficulty: 'impossible' }, { ...valid.setup, homeName: 'x'.repeat(25) }]) {
    assert.throws(() => decodeGameSetup(setup));
    assert.equal(readSavedGame(() => JSON.stringify({ ...valid, setup })).status, 'invalid');
  }
  assert.equal(readSavedGame(() => JSON.stringify({ ...valid, version: 31 })).status, 'invalid');
  assert.equal(homeName('   '), '溪谷家园');
  assert.equal(homeName('  我的小村  '), '我的小村');
  assert.equal(homeName('🌲'.repeat(25)), '🌲'.repeat(24));
});

test('difficulty affects real raid groups and recovery intervals, while the first chapter stays protected', () => {
  const make = (difficulty: 'relaxed' | 'standard' | 'challenging', mode: 'story' | 'free' = 'free') => {
    const e = new Economy(initialEconomy(184, false, { ...DEFAULT_GAME_SETUP, difficulty, mode }));
    const combat = new Combat(e.state.combat, e, () => []);
    const people = { status: (id: string) => ({ position: RESIDENTS.find(r => r.id === id)!.spawn, moving: false }), command: () => false, release: () => {}, resting: () => {}, neighbours: () => [] };
    return { e, raids: new Raids(e, combat, people, () => [], () => false) };
  };
  const groups: number[] = [], intervals: number[] = [];
  for (const difficulty of ['relaxed', 'standard', 'challenging'] as const) {
    const { e, raids } = make(difficulty);
    e.state.seconds = 500; raids.update(.05);
    groups.push(e.state.raids.pendingCount);
    e.state.raids.phase = 'raid'; e.state.raids.pendingOrigin = undefined; e.state.raids.pendingCount = 0;
    e.state.raids.wolves = []; e.state.raids.soldiers = []; raids.update(.05);
    intervals.push(e.state.raids.nextAt - e.state.seconds);
  }
  assert.deepEqual(groups, [1, 2, 3]);
  assert.ok(intervals[0] > intervals[1] && intervals[1] > intervals[2]);
  const { e, raids } = make('challenging', 'story');
  e.state.seconds = 500; raids.update(.05);
  assert.equal(e.state.raids.pendingCount, 0); assert.equal(e.state.raids.wave, 0);
});
