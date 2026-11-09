import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/game/simulation.ts';
import { decodeEconomy } from '../src/game/economy.ts';
import { tradeFixture } from './story-fixture.ts';

test('a guest admitted while paused is registered before simulation resumes and survives reload', async () => {
  const economy = tradeFixture(), sim = await createSimulation(economy.state);
  let saved = '', id = '';
  try {
    assert((await sim.command({ type: 'story', action: 'tools' })).ok);
    id = economy.state.story!.craftsmanId!;
    assert(sim.residents.needsStatus(id).position);
    // Exercise real raids/needs/crowd consumers on the first ticks after the choice.
    for (let i = 0; i < 40; i++) sim.step(.05);
    assert.equal(economy.state.recruitment.roster.length, 1);
    saved = sim.save();
  } finally { sim.dispose(); }
  const loaded = decodeEconomy(saved), resumed = await createSimulation(loaded.state);
  try {
    resumed.step(.05);
    assert.equal(loaded.state.story!.craftsmanId, id);
    assert.equal(loaded.state.upgrades.tools, 1);
    assert(!(await resumed.command({ type: 'story', action: 'supplies' })).ok);
    assert.equal(loaded.state.recruitment.roster.length, 1);
    assert.equal(decodeEconomy(resumed.save()).state.story!.stage, 'complete');
  } finally { resumed.dispose(); }
});
