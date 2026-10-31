import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, pending } from '../src/game/economy.ts';
import { createSteward, inStewardRange, expectedSupply, stewardStatus, STEWARD_CONFIG } from '../src/game/steward.ts';
import { ECONOMY_CONFIG as C, RESOURCE_NODES } from '../src/game/economy-config.ts';
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

test('autonomous production keeps delivering and replanting past the former comfort stock', () => {
  const e = new Economy(), manager = createSteward(e);
  for (let seconds = 0; seconds < 240; seconds += .5) {
    manager.update();
    for (const id of ['farmer', 'farmer-2']) {
      const task = e.active(id) ?? e.claim(id);
      if (task?.status === 'travelling' || task?.status === 'delivering') e.arrive(task.id);
    }
    e.advance(.5);
  }
  assert.ok(e.state.inventory.food > 160);
  assert.ok(e.state.plots.some(p => (p.harvests ?? 0) >= 2));
  assert.ok(e.state.plots.filter(p => p.tilled).length <= STEWARD_CONFIG.maxFields);
  assert.ok(expectedSupply(e, 'food') > 160);
  assert.ok(e.state.plots.some(p => p.crop) || e.state.tasks.some(t => pending(t) && t.kind === 'sow'));
  assert(!stewardStatus(e).includes('供应充足'));
  const before = e.state.plots.reduce((n,p)=>n+(p.harvests ?? 0),0);
  e.state.inventory.food = 0;
  for (let i=0;i<180;i++) { manager.update(); for(const id of ['farmer','farmer-2']) {const t=e.active(id)??e.claim(id); if(t?.status==='travelling'||t?.status==='delivering')e.arrive(t.id);} e.advance(.5); }
  assert.ok(e.state.plots.reduce((n,p)=>n+(p.harvests ?? 0),0) > before);
});

test('old supply thresholds do not stop farming, logging or mining while storage has room', () => {
  const e = new Economy(); e.state.inventory = { food: 160, wood: 96, stone: 72 };
  createSteward(e).update();
  const jobs = e.state.tasks.filter(pending);
  assert(jobs.some(t => t.kind === 'sow'));
  assert(jobs.some(t => t.kind === 'chop'));
  assert(jobs.some(t => t.kind === 'mine'));
  assert(!stewardStatus(e).includes('供应充足'));
});

test('a full resource store leaves other production running; consuming stock resumes that resource', () => {
  const e = new Economy(), manager = createSteward(e);
  e.state.inventory = { ...C.capacity };
  manager.update();
  assert.equal(e.state.tasks.filter(pending).length, 0);
  assert.match(stewardStatus(e), /仓库已满/);
  e.state.inventory.wood -= 20; e.advance(.5); manager.update();
  assert(e.state.tasks.some(t => pending(t) && t.kind === 'chop'));
  assert(e.state.tasks.every(t => t.kind === 'chop'));
  assert.equal(e.claim()?.kind, 'chop');
});

test('queued automatic production waits only for its full store and preserves the task for later', () => {
  const e = new Economy();
  const food = e.request('sow', 'plot-2', 'wheat', 'steward').task!;
  const tree = RESOURCE_NODES.find(n => n.kind === 'wood' && inStewardRange(n))!;
  const wood = e.request('chop', tree.id, undefined, 'steward').task!;
  e.state.inventory.food = C.capacity.food;
  assert.equal(e.claim('farmer')?.id, wood.id);
  assert.equal(food.status, 'waiting'); assert.match(food.reason, /粮食仓位已满/);
  e.state.inventory.food--;
  assert.equal(e.claim('farmer-2')?.id, food.id);
  assert.equal(food.reason, '');
});

test('incoming food fills the remaining space before more is planted, with excess goods preserved', () => {
  const e = new Economy(), manager = createSteward(e);
  e.state.inventory = { ...C.capacity, food: C.capacity.food - 2 };
  e.state.plots.forEach(p => { p.crop = undefined; p.growth = 0; });
  const plot = e.state.plots[0]; plot.crop = 'carrot'; plot.growth = C.crops.carrot.growthSeconds;
  manager.update();
  assert.equal(e.state.tasks.filter(pending).length, 1);
  const harvest = e.claim()!; assert.equal(harvest.kind, 'harvest'); e.arrive(harvest.id); e.advance(C.workSeconds.harvest);
  manager.update();
  const haul = e.claim()!; assert.equal(haul.kind, 'haul'); e.arrive(haul.id); e.arrive(haul.id);
  assert.equal(e.state.inventory.food, C.capacity.food);
  assert.equal(e.state.goods.reduce((sum, g) => sum + g.amount, 0), 6);
  assert.equal(e.state.tasks.filter(t => pending(t) && t.kind === 'sow').length, 0);
});

test('opening the first farming area takes precedence over distant material trips', () => {
  const e = new Economy();
  e.request('chop', 'tree-0', undefined, 'steward');
  const till = e.request('till', 'plot-4', undefined, 'steward').task!;
  assert.equal(e.claim()?.id, till.id);
});
