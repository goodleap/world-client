import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, initialEconomy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { DEFAULT_GAME_SETUP } from '../src/game/game-setup.ts';
import { advanceStory, storyAction, STORY_FOOD } from '../src/game/story.ts';
import { homeResidents, POPULATION_LIMIT } from '../src/game/recruitment.ts';
import { newResident } from '../src/game/resident-data.ts';
import { initialVital } from '../src/game/vitals.ts';
import { welcomeFixture, tradeFixture } from './story-fixture.ts';

test('story goals use actual harvest and available stock; out-of-order actions cannot progress', () => {
  const e = new Economy(initialEconomy(1, false, DEFAULT_GAME_SETUP));
  assert.equal(storyAction(e, 'invite').ok, false);
  e.state.inventory.food = 100; advanceStory(e);
  assert.equal(e.state.story!.stage, 'harvest');
  e.state.plots[0].harvests = 1; e.state.inventory.food = 0;
  e.dropReward({ x: 0, z: 0 }, { food: 100 }); advanceStory(e);
  assert.equal(e.state.story!.stage, 'harvest', 'ground food is not stored food');
  e.state.inventory.food = STORY_FOOD; advanceStory(e);
  assert.equal(e.state.story!.stage, 'road');
  advanceStory(e); assert.equal(e.state.story!.stage, 'road');
  assert.equal(storyAction(e, 'supplies').ok, false);
  assert.equal(storyAction(new Economy(), 'invite').ok, false);
});

test('invitations respect reservations, spend once, and arrivals resume on game time with a lit fire', () => {
  const e = welcomeFixture(), fire = e.state.campfires[0];
  e.state.inventory.food = STORY_FOOD;
  assert.equal(e.request('supply', fire.id, undefined, 'manual', { resource: 'food', amount: 4 }).ok, true);
  assert.equal(storyAction(e, 'invite').ok, false, 'reserved grain cannot be promised to the caravan');
  e.cancel(e.taskFor(fire.id)!.id);
  fire.enabled = false; assert.equal(storyAction(e, 'invite').ok, false);
  fire.enabled = true; assert.equal(storyAction(e, 'invite').ok, true);
  assert.equal(e.state.inventory.food, 0);
  assert.equal(storyAction(e, 'invite').ok, false);
  const restored = decodeEconomy(encodeEconomy(e));
  advanceStory(restored); assert.equal(restored.state.story!.stage, 'travelling');
  restored.state.seconds = restored.state.story!.arrivalAt!;
  restored.state.campfires[0].enabled = false; advanceStory(restored);
  assert.equal(restored.state.story!.stage, 'travelling');
  restored.state.campfires[0].enabled = true; advanceStory(restored);
  assert.equal(restored.state.story!.stage, 'trade');
});

test('chapter choices grant one guest and one real reward, including after saving and reloading', () => {
  for (const action of ['tools', 'supplies'] as const) {
    const e = tradeFixture(), before = { ...e.state.inventory };
    assert.equal(storyAction(e, action).ok, true);
    assert.equal(e.state.story!.stage, 'complete');
    assert.equal(homeResidents(e.state).filter(r => r.name === '木匠·阿榆').length, 1);
    assert.deepEqual(e.state.inventory, before, 'goods still need to be hauled');
    assert.equal(e.state.upgrades.tools, action === 'tools' ? 1 : 0);
    assert.deepEqual(e.state.goods.map(g => [g.resource, g.amount]), action === 'tools' ? [['wood', 12], ['iron', 8]] : [['stone', 16], ['food', 24]]);
    const restored = decodeEconomy(encodeEconomy(e));
    const saved = encodeEconomy(restored);
    assert.equal(homeResidents(restored.state).filter(r => r.name === '木匠·阿榆').length, 1);
    assert.equal(storyAction(restored, action).ok, false);
    advanceStory(restored); assert.equal(encodeEconomy(restored), saved);
    assert.ok(restored.state.raids.nextAt >= restored.state.seconds + 60);
  }
});

test('full population or a blocked door keeps the reward unclaimed, and malformed story saves are rejected', () => {
  const e = tradeFixture();
  assert.equal(storyAction(e, 'tools', [{ kind: 'circle', x: e.state.recruitment.rally.x, z: e.state.recruitment.rally.z, radius: 30 }]).ok, false);
  assert.equal(e.state.story!.stage, 'trade');
  while (homeResidents(e.state).filter(r => r.role !== 'dog').length < POPULATION_LIMIT) {
    const id = `recruit-farmer-${e.state.recruitment.nextId++}`;
    e.state.recruitment.roster.push(newResident('farmer', id, { x: 0, z: 0 })); e.state.vitals[id] = initialVital(id);
  }
  assert.equal(storyAction(e, 'supplies').ok, false);
  assert.equal(e.state.goods.length, 0);
  for (const story of [{ ...e.state.story, stage: 'unknown' }, { ...e.state.story, arrivalAt: -1 }, { ...e.state.story, reward: 'tools' }]) {
    assert.throws(() => decodeEconomy(JSON.stringify({ ...e.state, story })));
  }
});
