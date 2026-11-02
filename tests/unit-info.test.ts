import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { Combat } from '../src/game/combat.ts';
import { eat, maxHealth } from '../src/game/vitals.ts';
import { selectedUnitInfo } from '../src/game/unit-info.ts';

test('unit inspection reads current health/stamina without changing orders or saved state', () => {
  const e = new Economy(); e.setLeadership(false);
  e.state.vitals.farmer.hp = 63.5; e.state.vitals.farmer.stamina = 27.25;
  const before = encodeEconomy(e), info = selectedUnitInfo(e, 'farmer')!;
  assert.equal(info.activity, '空闲');
  assert.deepEqual(info.meters.map(m => [m.label, m.value, m.maximum]), [['生命',63.5,100],['体力',27.25,100]]);
  assert.equal(encodeEconomy(e), before);
  assert.deepEqual(selectedUnitInfo(decodeEconomy(before), 'farmer'), info);
  assert.equal(selectedUnitInfo(e, undefined), undefined);
  assert.equal(selectedUnitInfo(e, 'enemy-guard'), undefined);
  assert.equal(selectedUnitInfo(e, 'missing'), undefined);
});

test('mounted card shows only the rider while horse recovery remains independent', () => {
  const e = new Economy(), rider = e.state.combat.units.find(u => u.id === 'cavalry')!;
  rider.hp = 42; e.state.vitals.cavalry.stamina = 11;
  e.state.vitals.horse.hp = 92; e.state.vitals.horse.stamina = 22;
  e.state.vitals.cavalry.rest = { camp:'fire', goal:{x:0,z:0} };
  e.state.vitals.horse.meal = { remaining:6 };
  const read = () => selectedUnitInfo(e, 'cavalry')!;
  assert.equal(read().activity, '正在进食');
  assert.deepEqual(read().meters.map(m => [m.label,m.value,m.maximum]), [
    ['骑手生命',42,maxHealth('cavalry')],['骑手体力',11,100],
  ]);
  eat(e.state, 'horse', 1);
  assert.deepEqual(read().meters.map(m => m.value), [42,11]);
  assert.equal(e.state.vitals.horse.hp,94); assert.equal(e.state.vitals.horse.stamina,29.5);
  const paused = read(); eat(e.state, 'horse', 0); assert.deepEqual(read(), paused);
});

test('activity follows real work transitions and combat priority; death removes the card permanently', () => {
  const e = new Economy(); e.setLeadership(false);
  const result = e.request('harvest', 'plot-0'); assert(result.ok);
  const task = e.claim('farmer')!;
  assert.equal(selectedUnitInfo(e,'farmer')!.activity, '前往作业');
  e.arrive(task.id);
  assert.equal(selectedUnitInfo(e,'farmer')!.activity, '正在收获');
  e.advance(10);
  assert.equal(selectedUnitInfo(e,'farmer')!.activity, '等待搬运');
  const haul = e.active('farmer')!; e.arrive(haul.id);
  assert.equal(selectedUnitInfo(e,'farmer')!.activity, '搬运入库');
  e.arrive(haul.id);
  assert.equal(selectedUnitInfo(e,'farmer')!.activity, '空闲');
  assert.equal(selectedUnitInfo(e,'farmer',{moving:true,speed:1,working:false})!.activity, '正在移动');
  const c = new Combat(e.state.combat,e,()=>[]), u = c.unit('infantry')!;
  u.target = 'enemy-guard';
  assert.equal(selectedUnitInfo(e,u.id)!.activity, '正在战斗');
  c.hurt(u.id,9999,'enemy-guard');
  assert.equal(selectedUnitInfo(e,u.id), undefined);
  assert.equal(selectedUnitInfo(decodeEconomy(encodeEconomy(e)),u.id), undefined);
});
