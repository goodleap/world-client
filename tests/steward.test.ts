import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, pending } from '../src/game/economy.ts';
import { createSteward, inStewardRange } from '../src/game/steward.ts';
import { HOME, GRID_SIZE } from '../src/game/world-data.ts';
test('steward stays within home radius and repeated decisions never duplicate a target', () => {
  assert.ok(inStewardRange({x:HOME.x + 30 * GRID_SIZE, z:HOME.z}));
  assert.equal(inStewardRange({x:HOME.x + 31 * GRID_SIZE, z:HOME.z}), false);
  const e = new Economy(), manager = createSteward(e); manager.update();
  e.advance(1); manager.update();
  const tasks = e.state.tasks.filter(pending);
  assert.ok(tasks.length > 0); assert.equal(tasks.length, new Set(tasks.map(t=>t.target)).size);
});
test('two farmers claim distinct jobs and a manual interruption releases only one', () => {
  const e = new Economy(); createSteward(e).update();
  const a = e.claim('farmer')!, b = e.claim('farmer-2')!;
  assert.notEqual(a.id, b.id); e.arrive(a.id); e.arrive(b.id); e.advance(.5);
  e.interrupt({x:0,z:0}, 'farmer');
  assert.equal(a.status, 'waiting'); assert.equal(a.progress, .5);
  assert.equal(e.active('farmer-2')?.id, b.id);
  assert.equal(e.claim('farmer')?.id, a.id);
});
