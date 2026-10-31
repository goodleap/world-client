import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, initialEconomy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { ECONOMY_CONFIG as C } from '../src/game/economy-config.ts';

function finish(economy: Economy) {
  const task = economy.claim(); assert.ok(task); economy.arrive(task.id); economy.advance(C.workSeconds[task.kind]);
  const goods = economy.state.goods.at(-1);
  if (goods && economy.state.inventory[goods.resource] + goods.amount <= C.capacity[goods.resource]) {
    const haul = economy.request('haul', goods.id).task!; economy.assign(haul.id); economy.arrive(haul.id); economy.arrive(haul.id);
  }
  return task;
}

test('till, sow, grow and harvest form a repeatable cycle with exactly one output per job', () => {
  const e = new Economy();
  assert.equal(e.request('sow', 'plot-3', 'carrot').ok, false);
  assert.ok(e.request('till', 'plot-3').ok); finish(e); assert.ok(e.plot('plot-3')!.tilled);
  assert.ok(e.request('sow', 'plot-3', 'wheat').ok); finish(e);
  assert.equal(e.plot('plot-3')!.crop, 'wheat'); assert.equal(e.plot('plot-3')!.growth, 0);
  assert.equal(e.request('harvest', 'plot-3').ok, false);
  e.advance(C.crops.wheat.growthSeconds);
  const requested = e.request('harvest', 'plot-3'); assert.ok(requested.ok);
  assert.equal(e.request('harvest', 'plot-3').ok, false);
  finish(e); assert.equal(e.state.inventory.food, C.crops.wheat.yield);
  assert.equal(e.plot('plot-3')!.crop, undefined); assert.ok(e.plot('plot-3')!.tilled);
  e.arrive(requested.task!.id); e.advance(100); assert.equal(e.state.inventory.food, C.crops.wheat.yield);
  assert.ok(e.request('sow', 'plot-3', 'carrot').ok);
});

test('FIFO skips unfunded construction, gathers materials, reserves once and spends only on completion', () => {
  const e = new Economy();
  e.request('build', 'site-0'); e.request('chop', 'tree-0'); e.request('mine', 'rock-0');
  assert.equal(finish(e).kind, 'chop'); assert.equal(e.state.inventory.wood, 24);
  assert.equal(finish(e).kind, 'mine'); assert.equal(e.state.inventory.stone, 16);
  const build = e.claim()!; assert.equal(build.kind, 'build');
  assert.deepEqual(e.reserved(), C.houseCost); assert.equal(e.state.inventory.wood, 24);
  e.arrive(build.id); e.advance(C.workSeconds.build - .5);
  assert.equal(e.state.inventory.wood, 24); assert.equal(e.state.buildings.length, 0);
  e.advance(.5); assert.deepEqual(e.state.inventory, { wood: 12, stone: 8, food: 0 });
  assert.deepEqual(e.state.buildings, ['site-0']); assert.deepEqual(e.reserved(), { wood: 0, stone: 0, food: 0 });
  e.advance(100); assert.equal(e.state.inventory.wood, 12);
  assert.equal(e.request('build', 'site-0').ok, false);
});

test('concurrent requests cannot double reserve, and cancellation releases resources without spending', () => {
  const state = initialEconomy(); state.inventory = { wood: 12, stone: 8, food: 0 };
  const e = new Economy(state), first = e.request('build', 'site-0').task!, second = e.request('build', 'site-1').task!;
  assert.equal(first.reserved, true); assert.equal(second.reserved, false);
  assert.deepEqual(e.available(), { wood: 0, stone: 0, food: 0 });
  e.claim(); e.arrive(first.id); e.advance(2); assert.ok(e.cancel(first.id));
  assert.deepEqual(e.state.inventory, { wood: 12, stone: 8, food: 0 });
  assert.equal(e.claim()!.id, second.id); assert.ok(second.reserved);
  assert.equal(e.cancel(first.id), false);
});

test('blocked paths defer a job and allow the next executable job; invalid targets cannot grant output', () => {
  const e = new Economy(); e.request('chop', 'tree-0'); e.request('harvest', 'plot-0');
  const task = e.claim()!; e.defer(task.id, '暂时无法到达');
  assert.equal(e.claim()!.kind, 'harvest'); e.cancel(e.active()!.id);
  assert.equal(e.claim(), undefined); e.advance(C.retrySeconds); assert.equal(e.claim()!.id, task.id);
  e.arrive(task.id); e.state.depleted.push(task.target); e.advance(5);
  assert.equal(task.status, 'invalid'); assert.equal(e.state.inventory.wood, 8);
  assert.equal(e.request('mine', 'tree-1').ok, false);
});

test('growth and working time follow active seconds independently of the frame rate', () => {
  const simulate = (frames: number) => {
    const e = new Economy(); e.request('till', 'plot-3'); const task = e.claim()!; e.arrive(task.id);
    for (let i = 0; i < frames; i++) e.advance(3.1 / frames);
    return e;
  };
  const slow = simulate(31), fast = simulate(186);
  assert.equal(slow.state.tasks[0].status, 'done'); assert.equal(fast.state.tasks[0].status, 'done');
  assert.ok(Math.abs(slow.plot('plot-1')!.growth - fast.plot('plot-1')!.growth) < 1e-10);
  const before = encodeEconomy(slow); for (const dt of [0, -1, NaN, Infinity]) slow.advance(dt);
  assert.equal(encodeEconomy(slow), before);
});

test('save/load retains partial work and crop growth without offline catch-up or duplicate settlement', () => {
  const e = new Economy(); e.request('harvest', 'plot-0'); const task = e.claim()!; e.arrive(task.id); e.advance(1.25);
  const restored = decodeEconomy(encodeEconomy(e));
  assert.equal(restored.state.seconds, 0); assert.equal(restored.plot('plot-1')!.growth, 1.25);
  assert.equal(restored.state.tasks[0].status, 'waiting'); assert.equal(restored.state.tasks[0].progress, 1.25);
  const resumed = restored.claim()!; restored.arrive(resumed.id); restored.advance(1.75);
  assert.equal(restored.state.inventory.food, 0);
  const haul = restored.request('haul', restored.state.goods[0].id).task!; restored.claim(); restored.arrive(haul.id); restored.arrive(haul.id);
  assert.equal(restored.state.inventory.food, 8);
  const again = decodeEconomy(encodeEconomy(restored)); again.advance(10); assert.equal(again.state.inventory.food, 8);
});

test('save validation rejects corrupt resources, wrong target kinds and premature pending outputs', () => {
  const e = new Economy(); e.request('chop', 'tree-0');
  for (const corrupt of [
    (s: ReturnType<typeof initialEconomy>) => { s.inventory.wood = -1; },
    (s: ReturnType<typeof initialEconomy>) => { s.tasks[0].kind = 'build'; },
    (s: ReturnType<typeof initialEconomy>) => { s.tasks[0].status = 'storage'; s.tasks[0].progress = 0; },
    (s: ReturnType<typeof initialEconomy>) => { s.tasks.push({ ...s.tasks[0], id: 2 }); },
  ]) { const saved = JSON.parse(encodeEconomy(e)); corrupt(saved); assert.throws(() => decodeEconomy(JSON.stringify(saved))); }
});

test('resource and construction footprints leave every resident spawn traversable', async () => {
  const { RESIDENTS } = await import('../src/game/resident-data.ts');
  const { economyObstacles } = await import('../src/game/economy-config.ts');
  const { isBlocked } = await import('../src/game/movement.ts');
  for (const resident of RESIDENTS) assert.equal(isBlocked(resident.spawn, resident.bodyRadius, economyObstacles([])), false, resident.id);
});

test('resource volumes do not intersect the new building footprints', async () => {
  const { BUILD_SITES, RESOURCE_NODES } = await import('../src/game/economy-config.ts');
  const { isBlocked } = await import('../src/game/movement.ts');
  for (const node of RESOURCE_NODES) for (const site of BUILD_SITES) {
    assert.equal(isBlocked(node, node.radius, [{ kind: 'box', x: site.x, z: site.z, halfWidth: site.width / 2 + .12, halfDepth: site.depth / 2 + .12 }]), false, `${node.id}/${site.id}`);
  }
});

test('two farming cycles retain tilled soil, free the farmer while growing, and deliver before food is usable', () => {
  const e = new Economy(); e.request('till', 'plot-4'); finish(e);
  for (const crop of ['carrot', 'wheat'] as const) {
    e.request('sow', 'plot-4', crop); finish(e);
    assert.equal(e.active(), undefined);
    assert.equal(e.request('till', 'plot-4').ok, false);
    const before = e.state.inventory.food;
    e.advance(C.crops[crop].growthSeconds); e.request('harvest', 'plot-4');
    const t = e.claim()!; e.arrive(t.id); e.advance(3);
    assert.equal(e.state.inventory.food, before);
    assert.equal(e.plot('plot-4')!.tilled, true);
    assert.equal(e.plot('plot-4')!.crop, undefined);
    const goods = e.state.goods.at(-1)!; assert.equal(goods.crop, crop);
    e.request('haul', goods.id); const haul = e.claim()!; e.arrive(haul.id); e.arrive(haul.id);
    assert.equal(e.state.inventory.food, before + C.crops[crop].yield);
  }
  assert.equal(e.plot('plot-4')!.harvests, 2);
});
