import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, initialEconomy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { DEFAULT_GAME_SETUP } from '../src/game/game-setup.ts';
import { advanceStory, storyAction, storyGiver, storyView, STORY_FOOD } from '../src/game/story.ts';
import { homeResidents, POPULATION_LIMIT } from '../src/game/recruitment.ts';
import { newResident } from '../src/game/resident-data.ts';
import { initialVital } from '../src/game/vitals.ts';
import { act, questRequest, welcomeFixture, travellingFixture, tradeFixture } from './story-fixture.ts';

const fresh = () => new Economy(initialEconomy(1, false, DEFAULT_GAME_SETUP));
test('an NPC offers a quest; meeting conditions alone cannot accept or hand it in', () => {
  const e = fresh(); e.state.plots[0].harvests = 1; advanceStory(e);
  assert.equal(e.state.story!.status, 'available');
  assert.equal(storyAction(e, questRequest(e, 'report')).ok, false);
  assert.equal(storyAction(e, { ...questRequest(e, 'accept'), npc: 'dog' }).ok, false);
  e.state.inventory.food = 0; act(e, 'accept');
  assert.equal(e.state.story!.status, 'active');
  e.dropReward({ x: 0, z: 0 }, { food: 100 }); advanceStory(e);
  assert.equal(e.state.story!.status, 'active', 'ground food is not stored food');
  e.state.inventory.food = STORY_FOOD; advanceStory(e);
  assert.equal(e.state.story!.status, 'ready'); assert.equal(e.state.story!.stage, 'harvest');
  assert.equal(storyView(e)!.marker, '?');
});

test('reporting and claiming are separate saved transactions, and old callbacks cannot claim the next quest', () => {
  const e = fresh(); e.state.plots[0].harvests = 1; act(e, 'accept');
  const request = questRequest(e, 'claim');
  assert.equal(storyAction(e, request).ok, false); assert.equal(e.state.goods.length, 0);
  act(e, 'report'); assert.equal(e.state.story!.status, 'reward'); assert.equal(e.state.goods.length, 0);
  const restored = decodeEconomy(encodeEconomy(e));
  assert.equal(storyView(restored)!.marker, '礼');
  assert(storyAction(restored, request, { x: 3, z: 4 }).ok);
  assert.equal(restored.state.story!.stage, 'road'); assert.equal(restored.state.story!.status, 'available');
  assert.deepEqual(restored.state.goods.map(g => [g.resource, g.amount]), [['wood', 6], ['stone', 4]]);
  assert(restored.state.goods.every(g => Math.hypot(g.x - 3, g.z - 4) < 3));
  const saved = encodeEconomy(restored);
  assert.equal(storyAction(restored, request).ok, false); advanceStory(restored);
  assert.equal(encodeEconomy(restored), saved);
});

test('hand-in rechecks unreserved food, spends once, and guest arrival preserves the unpaid reward', () => {
  const e = welcomeFixture(), fire = e.state.campfires[0]; e.state.inventory.food = STORY_FOOD;
  assert(e.request('supply', fire.id, undefined, 'manual', { resource: 'food', amount: 4 }).ok);
  assert.equal(storyAction(e, questRequest(e, 'invite')).ok, false);
  e.cancel(e.taskFor(fire.id)!.id); advanceStory(e);
  const invite = questRequest(e, 'invite'); assert(storyAction(e, invite).ok); assert.equal(e.state.inventory.food, 0);
  assert.equal(storyAction(e, invite).ok, false);
  const restored = decodeEconomy(encodeEconomy(e)); advanceStory(restored);
  assert.equal(restored.state.story!.stage, 'travelling');
  restored.state.seconds = restored.state.story!.arrivalAt!; restored.state.campfires[0].enabled = false; advanceStory(restored);
  assert.equal(restored.state.recruitment.roster.length, 0);
  restored.state.campfires[0].enabled = true; advanceStory(restored);
  assert.equal(restored.state.story!.stage, 'trade'); assert.equal(restored.state.story!.status, 'ready');
  assert.equal(storyGiver(restored)!.name, '木匠·阿榆'); assert.equal(restored.state.upgrades.tools, 0);
  assert.equal(restored.state.recruitment.roster.length, 1);
  advanceStory(restored); assert.equal(restored.state.recruitment.roster.length, 1);
  assert.equal(decodeEconomy(encodeEconomy(restored)).state.story!.status, 'ready');
});

test('guest admission waits for capacity and a clear entrance, then occurs exactly once', () => {
  const e = travellingFixture(); e.state.seconds = e.state.story!.arrivalAt!;
  advanceStory(e, [{ kind: 'circle', ...e.state.recruitment.rally, radius: 30 }]);
  assert.equal(e.state.story!.craftsmanId, null);
  while (homeResidents(e.state).filter(r => r.role !== 'dog').length < POPULATION_LIMIT) {
    const id = `recruit-farmer-${e.state.recruitment.nextId++}`;
    e.state.recruitment.roster.push(newResident('farmer', id, { x: 0, z: 0 })); e.state.vitals[id] = initialVital(id);
  }
  advanceStory(e); assert.equal(e.state.story!.stage, 'travelling');
  const removed = e.state.recruitment.roster.pop()!; delete e.state.vitals[removed.id];
  advanceStory(e); const id = e.state.story!.craftsmanId; assert(id);
  advanceStory(e); assert.equal(e.state.story!.craftsmanId, id);
});

test('the arrived NPC requires a report before either reward; claiming survives reload without duplication', () => {
  for (const action of ['tools', 'supplies'] as const) {
    const e = tradeFixture(), before = e.state.goods.map(g => g.id);
    assert.equal(storyAction(e, questRequest(e, action)).ok, false);
    assert.equal(storyAction(e, { ...questRequest(e, 'report'), npc: 'farmer-leader' }).ok, false);
    act(e, 'report'); const restored = decodeEconomy(encodeEconomy(e));
    const request = questRequest(restored, action); assert(storyAction(restored, request).ok);
    assert.equal(restored.state.story!.status, 'claimed'); assert.equal(restored.state.story!.stage, 'complete');
    assert.equal(homeResidents(restored.state).filter(r => r.name === '木匠·阿榆').length, 1);
    assert.equal(restored.state.upgrades.tools, action === 'tools' ? 1 : 0);
    assert.deepEqual(restored.state.goods.filter(g => !before.includes(g.id)).map(g => [g.resource, g.amount]),
      action === 'tools' ? [['wood', 12], ['iron', 8]] : [['stone', 16], ['food', 24]]);
    const loaded = decodeEconomy(encodeEconomy(restored)), saved = encodeEconomy(loaded);
    assert.equal(storyAction(loaded, request).ok, false); advanceStory(loaded); assert.equal(encodeEconomy(loaded), saved);
    assert(storyView(loaded)!.journal.every(row => row.status === '已完成 · 已领奖'));
  }
});

test('a fallen giver is replaced by a living resident without reviving or losing the pending reward', () => {
  const e = fresh(); e.state.plots[0].harvests = 1; act(e, 'accept'); act(e, 'report');
  const previous = storyGiver(e)!.id; e.state.vitals[previous].hp = 0;
  assert.notEqual(storyGiver(e)!.id, previous);
  assert.equal(storyAction(e, { ...questRequest(e, 'claim'), npc: previous }).ok, false);
  act(e, 'claim'); assert.equal(e.state.vitals[previous].hp, 0);
  const trade = tradeFixture(), guest = trade.state.story!.craftsmanId!;
  trade.state.vitals[guest].hp = 0;
  assert.notEqual(storyGiver(trade)!.id, guest);
  assert.match(storyView(trade)!.dialogue, /替他交接/);
  act(trade, 'report'); act(trade, 'supplies');
  assert.equal(trade.state.vitals[guest].hp, 0);
  assert.equal(trade.state.recruitment.roster.length, 1);
});

test('malformed lifecycle states, premature guest IDs and unearned rewards are rejected', () => {
  const e = fresh();
  for (const story of [{ ...e.state.story, status: 'unknown' }, { ...e.state.story, status: 'claimed' },
    { ...e.state.story, stage: 'travelling' }, { ...e.state.story, reward: 'tools' }, { ...e.state.story, craftsmanId: 'recruit-farmer-1' }]) {
    assert.throws(() => decodeEconomy(JSON.stringify({ ...e.state, story })));
  }
  const arrived = tradeFixture();
  assert.throws(() => decodeEconomy(JSON.stringify({ ...arrived.state, story: { ...arrived.state.story, status: 'available' } })));
  assert.throws(() => decodeEconomy(JSON.stringify({ ...e.state, version: 32 })));
});
