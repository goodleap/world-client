import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, pending } from '../src/game/economy.ts';
import { createSteward, inStewardRange, expectedSupply, STEWARD_CONFIG } from '../src/game/steward.ts';
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

test('autonomous production delivers, replants, and waits when committed supply is sufficient', () => {
  const e = new Economy(), manager = createSteward(e);
  for (let seconds = 0; seconds < 240; seconds += .5) {
    manager.update();
    for (const id of ['farmer', 'farmer-2']) {
      const task = e.active(id) ?? e.claim(id);
      if (task?.status === 'travelling' || task?.status === 'delivering') e.arrive(task.id);
    }
    e.advance(.5);
  }
  assert.ok(e.state.inventory.food >= STEWARD_CONFIG.target.food - 12);
  assert.ok(e.state.plots.some(p => (p.harvests ?? 0) >= 2));
  assert.ok(e.state.plots.filter(p => p.tilled).length <= STEWARD_CONFIG.maxFields);
  assert.ok(expectedSupply(e, 'food') >= STEWARD_CONFIG.target.food);
  assert.equal(e.state.tasks.filter(t => pending(t) && t.kind === 'sow').length, 0);
  const before = e.state.plots.reduce((n,p)=>n+(p.harvests ?? 0),0);
  e.state.inventory.food = 0;
  for (let i=0;i<180;i++) { manager.update(); for(const id of ['farmer','farmer-2']) {const t=e.active(id)??e.claim(id); if(t?.status==='travelling'||t?.status==='delivering')e.arrive(t.id);} e.advance(.5); }
  assert.ok(e.state.plots.reduce((n,p)=>n+(p.harvests ?? 0),0) > before);
});

test('opening the first farming area takes precedence over distant material trips', () => {
  const e = new Economy();
  e.request('chop', 'tree-0', undefined, 'steward');
  const till = e.request('till', 'plot-4', undefined, 'steward').task!;
  assert.equal(e.claim()?.id, till.id);
});
