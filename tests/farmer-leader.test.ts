import { gridPoint } from '../src/game/world-data.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, decodeEconomy, encodeEconomy } from '../src/game/economy.ts';
import { createEconomyController } from '../src/game/economy-controller.ts';
import { canResidentWork, RESIDENTS, roleLeader } from '../src/game/resident-data.ts';

const leader = roleLeader('farmer')!;
function crew() {
  type Residents = Parameters<typeof createEconomyController>[2];
  const economy = new Economy(), work = new Map<string, NonNullable<ReturnType<Residents['farmerWorkState']>>>();
  const moves = new Set<string>(), dispatched: string[] = [];
  const farmers = RESIDENTS.filter(resident => canResidentWork(resident.id));
  const residents: Residents = {
    farmerIds: () => farmers.map(resident => resident.id),
    farmerPosition: (id = 'farmer') => farmers.find(resident => resident.id === id)!.spawn,
    canWork: canResidentWork, hasMoveCommand: id => moves.has(id),
    command(_point, id = 'farmer') { work.delete(id); moves.add(id); return true; },
    farmerWorkState: (id = 'farmer') => work.get(id),
    releaseFarmerWork(id = 'farmer') { work.delete(id); },
    beginFarmerWork(id, unit = 'farmer') { work.set(unit, { id, status: 'working' }); },
    planFarmerWork: points => [...points],
    startFarmerWork(id, _path, _target, unit = 'farmer') { moves.delete(unit); work.set(unit, { id, status: 'travelling' }); },
  };
  const controller = createEconomyController(economy, {
    sync: () => false, workPoints: () => ({ points: [{ x: 3, z: 0 }], target: { x: 3, z: 1 } }),
  }, residents, true, worker => dispatched.push(worker));
  return { economy, controller, work, moves, dispatched, farmers };
}

test('the farmer leader works at the ordinary rate while the crew continues receiving orders', () => {
  const h = crew(); h.controller.update(.01);
  assert.equal(h.farmers.length, 3);
  assert.equal(leader.name, '农民·领头');
  assert(h.farmers.every(resident => h.economy.active(resident.id)), 'the leader also claims a job');
  assert.equal(new Set(h.economy.state.tasks.filter(task => task.worker).map(task => task.target)).size, 3);
  for (const work of h.work.values()) work.status = 'arrived';
  h.controller.update(.01); h.controller.update(.5);
  const job = h.economy.active(leader.id)!;
  assert.equal(job.status, 'working'); assert.equal(job.progress, .5);
  assert.equal(h.economy.active('farmer')!.progress, job.progress, 'leadership does not replace or speed up work');
  const orders = h.dispatched.length;
  assert(h.controller.command('farmer', { kind: 'move', point: { x: 0, z: -4 } }).ok);
  h.moves.delete('farmer'); h.controller.update(.1);
  assert.equal(h.dispatched.length, orders + 1, 'orders continue while the leader is working');
  assert.equal(h.economy.active(leader.id)?.id, job.id);
  assert.equal(job.progress, .6);
});

test('manual commands interrupt the leader just like another farmer and preserve partial work', () => {
  const h = crew(); h.controller.update(.01);
  for (const work of h.work.values()) work.status = 'arrived';
  h.controller.update(.01); h.controller.update(.5);
  const original = h.economy.active(leader.id)!;
  assert(h.controller.command(leader.id, { kind: 'move', point: { x: 0, z: -5 } }).ok);
  h.controller.update(.25);
  assert.equal(h.economy.active(leader.id), undefined);
  assert.equal(original.status, 'waiting'); assert.equal(original.progress, .5);
  const field = h.economy.placeBuilding('farm', gridPoint(51.5, 55.5)).task!.target;
  assert(h.controller.command(leader.id, { kind: 'work', work: 'till', target: field }).ok);
  assert.equal(h.economy.active(leader.id)?.target, field);
  assert.equal(h.moves.has(leader.id), false);
  h.work.get(leader.id)!.status = 'arrived'; h.controller.update(.01); h.controller.update(.2);
  assert.equal(h.economy.active(leader.id)?.status, 'working');
  assert.equal(h.economy.active(leader.id)?.progress, .2);
  const resumed = decodeEconomy(encodeEconomy(h.economy));
  assert.equal(resumed.taskFor(original.target)?.progress, .5);
  assert.equal(resumed.taskFor(field)?.progress, .2);
});

test('the leader can resume delivering without losing or duplicating goods', () => {
  const e = new Economy(); e.state.steward.enabled = false;
  e.state.goods.push({ id: 'goods-1', resource: 'wood', amount: 16, state: 'ground', x: 1, z: 0 }); e.state.nextId = 2;
  const task = e.request('haul', 'goods-1').task!;
  assert.equal(e.claim(leader.id)?.id, task.id); e.arrive(task.id);
  e.updateCargo({ x: .8, z: -.5 }, leader.id);
  const resumed = decodeEconomy(encodeEconomy(e));
  assert.equal(resumed.active(leader.id)?.status, 'delivering');
  assert.equal(resumed.state.goods[0].carrier, leader.id);
  assert.equal(resumed.state.inventory.wood, 8);
  resumed.arrive(task.id); resumed.arrive(task.id);
  assert.equal(resumed.state.inventory.wood, 24); assert.equal(resumed.state.goods.length, 0);
  const invalid = JSON.parse(encodeEconomy(e));
  invalid.tasks[0].worker = invalid.goods[0].carrier = 'infantry';
  assert.throws(() => decodeEconomy(JSON.stringify(invalid)), /运输任务不一致/);
});

test('leadership never queues future orders while every farmer is occupied or moving manually', () => {
  const h = crew();
  for (const farmer of h.farmers) h.moves.add(farmer.id);
  h.controller.update(1);
  assert.equal(h.economy.state.tasks.length, 0);
  h.moves.delete('farmer-2'); h.controller.update(1);
  assert.equal(h.economy.state.tasks.length, 1);
  assert.equal(h.economy.active('farmer-2')?.origin, 'steward');
  for (let i = 0; i < 30; i++) h.controller.update(1);
  assert.equal(h.economy.state.tasks.length, 1, 'a travelling worker is occupied, even as other crops mature');
});

test('disabled leadership persists, leaves ordinary work available and chains delivery to the producer', () => {
  const h = crew(); h.economy.setLeadership(false); h.controller.update(1);
  assert.equal(h.economy.state.tasks.length, 0);
  assert.equal(decodeEconomy(encodeEconomy(h.economy)).state.steward.enabled, false);
  assert(h.controller.command(leader.id, { kind: 'work', work: 'chop', target: 'tree-0' }).ok);
  h.work.get(leader.id)!.status = 'arrived'; h.controller.update(.01); h.controller.update(5);
  const haul = h.economy.active(leader.id)!;
  assert.equal(haul.kind, 'haul'); assert.equal(haul.target, h.economy.state.goods[0].id);
  assert.equal(h.economy.active('farmer'), undefined, 'another idle farmer cannot steal the producer’s delivery');
  assert.equal(h.economy.state.inventory.wood, 8);
  h.work.get(leader.id)!.status = 'arrived'; h.controller.update(.01);
  assert.equal(h.economy.active(leader.id)?.status, 'delivering');
  h.work.get(leader.id)!.status = 'arrived'; h.controller.update(.01);
  assert.equal(h.economy.state.inventory.wood, 24); assert.equal(h.economy.state.goods.length, 0);
  h.controller.update(10); assert.equal(h.economy.active(leader.id), undefined);
  h.economy.setLeadership(true); h.controller.update(.01);
  assert(h.farmers.every(farmer => h.economy.active(farmer.id)), 're-enabling fills only current vacancies');
});
