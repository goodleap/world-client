import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, initialEconomy, decodeEconomy, encodeEconomy } from '../src/game/economy.ts';
import { createEconomyController } from '../src/game/economy-controller.ts';

function setup(economy = new Economy()) {
  type Residents = Parameters<typeof createEconomyController>[2];
  let work: ReturnType<Residents['farmerWorkState']>;
  const moves = new Map<string, { x: number; z: number }>();
  let reachable = true;
  const residents: Residents = {
    canWork: id => id === 'farmer', hasMoveCommand: id => moves.has(id),
    command(point, id = 'farmer') {
      if (!reachable) return false;
      moves.set(id, point); if (id === 'farmer') work = undefined;
      return true;
    },
    farmerWorkState: () => work,
    releaseFarmerWork() { work = undefined; },
    beginFarmerWork(id) { work = { id, status: 'working' }; },
    planFarmerWork: points => reachable ? [...points] : undefined,
    startFarmerWork(id) { moves.delete('farmer'); work = { id, status: 'travelling' }; },
  };
  const controller = createEconomyController(economy, {
    sync: () => false, workPoints: () => ({ points: [{ x: 3, z: 0 }], target: { x: 3, z: 1 } }),
  }, residents);
  return { economy, controller, moves, residents, blocked(value: boolean) { reachable = !value; },
    arrive() { if (work) work.status = 'arrived'; controller.update(.001); } };
}

test('manual movement owns the farmer until arrival and resumes partial work without spending reserved materials twice', () => {
  const state = initialEconomy(); state.inventory = { wood: 24, stone: 16, food: 0 };
  const h = setup(new Economy(state)), { economy: e, controller: c } = h;
  const build = e.request('build', 'site-0').task!;
  c.update(.01); h.arrive(); c.update(2);
  const progress = build.progress, growth = e.plot('plot-1')!.growth;
  assert.equal(build.status, 'working');
  assert.ok(c.command('farmer', { kind: 'move', point: { x: 0, z: -3 } }).ok);
  assert.equal(build.status, 'waiting');
  assert.equal(build.reserved, true);
  c.update(1); c.update(1);
  assert.equal(build.progress, progress); assert.equal(e.active(), undefined);
  assert.equal(e.plot('plot-1')!.growth, growth + 2);
  assert.ok(c.command('farmer', { kind: 'move', point: { x: -1, z: -4 } }).ok);
  assert.deepEqual(h.moves.get('farmer'), { x: -1, z: -4 });
  const restored = decodeEconomy(encodeEconomy(e));
  assert.equal(restored.state.tasks[0].progress, progress);
  assert.deepEqual(restored.reserved(), e.reserved());
  h.moves.delete('farmer'); c.update(.01); h.arrive(); c.update(8 - progress);
  assert.equal(build.status, 'done'); assert.deepEqual(e.state.inventory, { wood: 12, stone: 8, food: 0 });
  c.update(20); assert.deepEqual(e.state.buildings, ['site-0']);
});

test('direct work preempts automatic work, reuses queued tasks and preserves the interrupted progress', () => {
  const h = setup(), { economy: e, controller: c } = h;
  const till = e.request('till', 'plot-3').task!;
  const harvest = e.request('harvest', 'plot-0').task!;
  c.update(.01); h.arrive(); c.update(.7);
  const progress = till.progress;
  assert.ok(c.command('farmer', { kind: 'work', work: 'harvest', target: 'plot-0' }).ok);
  assert.equal(e.active()?.id, harvest.id); assert.equal(till.progress, progress);
  assert.equal(e.state.tasks.length, 2);
  h.arrive(); c.update(.5);
  assert.ok(c.command('farmer', { kind: 'work', work: 'harvest', target: 'plot-0' }).ok);
  assert.equal(h.residents.farmerWorkState()?.status, 'working'); assert.equal(harvest.progress, .5);
  c.update(2.5); assert.equal(e.state.inventory.food, 8); assert.equal(e.active()?.id, till.id);
  h.arrive(); c.update(3 - progress);
  assert.equal(till.status, 'done'); assert.equal(e.state.inventory.food, 8);
});

test('dogs and soldiers accept movement while unsupported or invalid work cannot interrupt an existing command', () => {
  const h = setup(), { economy: e, controller: c } = h;
  for (const id of ['dog', 'infantry', 'archer', 'cavalry', 'worker', 'base-human']) {
    assert.ok(c.command(id, { kind: 'move', point: { x: 0, z: -3 } }).ok);
    assert.equal(c.command(id, { kind: 'work', work: 'harvest', target: 'plot-0' }).ok, false);
    assert.ok(h.moves.has(id));
  }
  assert.equal(e.state.tasks.length, 0);
  assert.ok(c.command('farmer', { kind: 'work', work: 'harvest', target: 'plot-0' }).ok);
  h.arrive(); c.update(.5);
  const active = e.active()!.id;
  assert.equal(c.command('farmer', { kind: 'work', work: 'harvest', target: 'plot-1' }).ok, false);
  assert.equal(c.command('farmer', { kind: 'work', work: 'build', target: 'site-0' }).ok, false);
  h.blocked(true);
  assert.equal(c.command('farmer', { kind: 'move', point: { x: 100, z: 100 } }).ok, false);
  assert.equal(c.command('farmer', { kind: 'work', work: 'chop', target: 'tree-0' }).ok, false);
  assert.equal(e.active()!.id, active); assert.equal(e.active()!.status, 'working');
  c.update(2.5); assert.equal(e.state.inventory.food, 8);
});
