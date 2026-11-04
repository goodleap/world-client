import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, queued, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { createEconomyController } from '../src/game/economy-controller.ts';

test('leader checks the route before creating a job; interrupted work stays out of the queue and keeps progress', () => {
  const e = new Economy();
  type Residents = Parameters<typeof createEconomyController>[2];
  let work: ReturnType<Residents['farmerWorkState']>, routeUnsafe = true, everywhereUnsafe = false;
  const position = { x: 0, z: -3 };
  const people: Residents = {
    farmerIds: () => ['farmer'], farmerPosition: () => position, canWork: () => true, hasMoveCommand: () => false,
    command: () => true, farmerWorkState: () => work,
    releaseFarmerWork: () => { work = undefined; }, beginFarmerWork: id => { work = { id, status: 'working' }; },
    planFarmerWork: () => [routeUnsafe ? { x: 99, z: -3 } : position],
    startFarmerWork: (id, path) => { work = { id, status: 'travelling', path }; },
  };
  const controller = createEconomyController(e, { sync: () => false, workPoints: () => ({ points: [position], target: position }) },
    people, true, undefined, undefined, undefined, points => points.some(p => everywhereUnsafe || p.x === 99));
  controller.update(.5);
  assert.equal(e.state.tasks.length, 0, 'safe target but dangerous route must not enqueue work');
  assert.equal(e.state.nextId, 1);
  routeUnsafe = false;
  controller.update(2.1); controller.update(.5);
  const job = e.active()!; assert(job); assert(queued(job));
  job.progress = .75;
  everywhereUnsafe = true;
  controller.update(.6); controller.update(.1);
  assert(job.danger); assert.equal(job.progress, .75); assert.equal(job.worker, undefined);
  assert.equal(e.state.tasks.filter(queued).length, 0);
  const restored = decodeEconomy(encodeEconomy(e));
  assert.equal(restored.state.tasks[0].progress, .75); assert(!queued(restored.state.tasks[0]));
  assert(restored.assign(job.id, 'farmer').ok, 'player order can take over held work');
  assert(queued(restored.state.tasks[0])); assert.equal(restored.state.tasks[0].origin, 'manual');
});
