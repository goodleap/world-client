import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/game/simulation.ts';
import { decodeEconomy } from '../src/game/economy.ts';
import { travellingFixture, questRequest } from './story-fixture.ts';

test('the arriving quest NPC is registered before hand-in, and an unpaid reward survives pause and reload', async () => {
  const economy = travellingFixture();
  economy.state.seconds = economy.state.story!.arrivalAt! - .05;
  const sim = await createSimulation(economy.state);
  let saved = '', id = '';
  try {
    for (let i = 0; i < 20 && !economy.state.story!.craftsmanId; i++) sim.step(.05);
    id = economy.state.story!.craftsmanId!;
    assert(id); assert.equal(economy.state.upgrades.tools, 0);
    assert(sim.residents.needsStatus(id).position);
    // The actual crowd/needs consumers must know the new actor on the next tick.
    for (let i = 0; i < 40; i++) sim.step(.05);
    assert((await sim.command({ type: 'story', ...questRequest(economy, 'report') })).ok);
    assert.equal(economy.state.story!.status, 'reward');
    assert.equal(economy.state.recruitment.roster.length, 1);
    saved = sim.save();
  } finally { sim.dispose(); }
  const loaded = decodeEconomy(saved), resumed = await createSimulation(loaded.state);
  try {
    resumed.step(.05);
    assert.equal(loaded.state.story!.craftsmanId, id);
    assert((await resumed.command({ type: 'story', ...questRequest(loaded, 'tools') })).ok);
    assert.equal(loaded.state.upgrades.tools, 1);
    assert(!(await resumed.command({ type: 'story', ...questRequest(loaded, 'supplies') })).ok);
    assert.equal(loaded.state.recruitment.roster.length, 1);
    assert.equal(decodeEconomy(resumed.save()).state.story!.stage, 'complete');
  } finally { resumed.dispose(); }
});
