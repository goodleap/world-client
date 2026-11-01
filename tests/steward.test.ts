import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, pending } from '../src/game/economy.ts';
import { createSteward, inStewardRange, expectedSupply, stewardStatus } from '../src/game/steward.ts';
import { ECONOMY_CONFIG as C, RESOURCE_NODES } from '../src/game/economy-config.ts';
import { HOME, GRID_SIZE, gridPoint } from '../src/game/world-data.ts';
function dispatch(e: Economy, id = 'farmer') {
  if (e.active(id)) return e.active(id);
  const queued = e.claim(id); if (queued) return queued;
  createSteward(e).requestWork(); return e.claim(id);
}
test('steward stays within home radius and one vacancy produces at most one order', () => {
  assert.ok(inStewardRange({ x: HOME.x + 30 * GRID_SIZE, z: HOME.z }));
  assert.equal(inStewardRange({ x: HOME.x + 31 * GRID_SIZE, z: HOME.z }), false);
  const e = new Economy();
  dispatch(e); assert.equal(e.state.tasks.filter(pending).length, 1);
  dispatch(e); assert.equal(e.state.tasks.filter(pending).length, 1);
  dispatch(e, 'farmer-2');
  assert.equal(e.state.tasks.filter(pending).length, 2);
  assert.equal(new Set(e.state.tasks.map(t => t.target)).size, 2);
});
test('two farmers claim distinct jobs and a manual interruption releases only one', () => {
  const e = new Economy();
  const a = dispatch(e)!, b = dispatch(e, 'farmer-2')!;
  assert.notEqual(a.id, b.id); e.arrive(a.id); e.arrive(b.id); e.advance(.5);
  e.interrupt({ x: 0, z: 0 }, 'farmer');
  assert.equal(a.status, 'waiting'); assert.equal(a.progress, .5);
  assert.equal(e.active('farmer-2')?.id, b.id);
  assert.equal(e.claim('farmer')?.id, a.id);
});
test('autonomous work keeps delivering and replanting past the former comfort stock', () => {
  const e = new Economy();
  const run = (seconds: number) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += .5) {
      for (const id of ['farmer', 'farmer-2']) {
        const task = dispatch(e, id);
        if (task?.status === 'travelling' || task?.status === 'delivering') e.arrive(task.id);
      }
      e.advance(.5);
    }
  };
  run(240);
  assert.ok(e.state.inventory.food > 160);
  assert.ok(e.state.plots.some(p => (p.harvests ?? 0) >= 2));
  assert.equal(e.state.plots.length, 12); assert.ok(e.state.plots.every(p => p.tilled));
  assert.ok(expectedSupply(e, 'food') > 160);
  assert(!stewardStatus(e).includes('供应充足'));
  const before = e.state.plots.reduce((n, p) => n + (p.harvests ?? 0), 0);
  e.state.inventory.food = 0; run(90);
  assert.ok(e.state.plots.reduce((n, p) => n + (p.harvests ?? 0), 0) > before);
});
test('old stock thresholds do not stop each resource while its storage has room', () => {
  for (const resource of ['food', 'wood', 'stone'] as const) {
    const e = new Economy(); e.state.inventory = { ...C.capacity, [resource]: { food: 160, wood: 96, stone: 72 }[resource] };
    const job = dispatch(e)!;
    assert.ok(resource === 'food' ? ['harvest', 'sow'].includes(job.kind) : job.kind === (resource === 'wood' ? 'chop' : 'mine'));
    assert.equal(e.state.tasks.filter(pending).length, 1);
  }
});
test('a full resource store leaves other production running; consuming stock resumes that resource', () => {
  const e = new Economy(); e.state.inventory = { ...C.capacity };
  assert.equal(dispatch(e), undefined); assert.match(stewardStatus(e), /仓库已满/);
  e.state.inventory.wood -= 20; e.advance(.5);
  assert.equal(dispatch(e)?.kind, 'chop');
});
test('queued automatic production waits for its full store and preserves the task', () => {
  const e = new Economy();
  const food = e.request('sow', 'plot-2', 'wheat', 'steward').task!;
  const tree = RESOURCE_NODES.find(n => n.kind === 'wood' && inStewardRange(n))!;
  const wood = e.request('chop', tree.id, undefined, 'steward').task!;
  e.state.inventory.food = C.capacity.food;
  assert.equal(e.claim('farmer')?.id, wood.id);
  assert.equal(food.status, 'waiting'); assert.match(food.reason, /粮食仓位已满/);
  e.state.inventory.food--; assert.equal(e.claim('farmer-2')?.id, food.id);
});
test('incoming food fills the remaining space before more is planted, preserving excess goods', () => {
  const e = new Economy(); e.state.inventory = { ...C.capacity, food: C.capacity.food - 2 };
  e.state.plots.forEach(p => { p.crop = undefined; p.growth = 0; });
  const plot = e.state.plots[0]; plot.crop = 'carrot'; plot.growth = C.crops.carrot.growthSeconds;
  const harvest = dispatch(e)!; assert.equal(harvest.kind, 'harvest');
  e.arrive(harvest.id); e.advance(C.workSeconds.harvest);
  const haul = e.active()!; assert.equal(haul.kind, 'haul'); e.arrive(haul.id); e.arrive(haul.id);
  assert.equal(e.state.inventory.food, C.capacity.food);
  assert.equal(e.state.goods.reduce((sum, g) => sum + g.amount, 0), 6);
  assert.equal(dispatch(e), undefined);
});
test('opening a newly placed farming area precedes distant material trips', () => {
  const e = new Economy(); e.request('chop', 'tree-0', undefined, 'steward');
  const till = e.placeBuilding('farm', gridPoint(51.5, 55.5)).task!; till.origin = 'steward';
  assert.equal(e.claim()?.id, till.id);
});
