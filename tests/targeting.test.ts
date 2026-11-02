import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat } from '../src/game/combat.ts';
import { COMBAT_CONFIG as C, OUTPOST } from '../src/game/combat-config.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { chooseTarget } from '../src/game/targeting.ts';
import type { CombatTarget } from '../src/game/targeting.ts';
import { changeHealth, eat, health, needsFood } from '../src/game/vitals.ts';
import { livingPopulation } from '../src/game/home-status.ts';
import { ENEMIES, RESIDENTS } from '../src/game/resident-data.ts';
import { WILD_WOLF_SPAWNS, allWolves } from '../src/game/raid-state.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { isBlocked } from '../src/game/movement.ts';

test('target preference is symmetric, excludes friends/dead, and ranks capability before distance', () => {
  for (const team of ['home', 'enemy'] as const) {
    const enemy = team === 'home' ? 'enemy' : 'home';
    const actor = { team, position: { x: 0, z: 0 } };
    const target = (id: string, distance: number, canAttack: boolean): CombatTarget => ({ id, team: enemy, position: { x: distance, z: 0 }, canAttack, hp: 100, life: 'active', radius: .4 });
    const civilian = target('civilian', 1, false), soldier = target('soldier', 7, true), near = target('near-soldier', 5, true);
    const friend = { ...target('friend', .5, true), team }, dead = { ...target('dead', 1, true), hp: 0, life: 'defeated' as const };
    assert.equal(chooseTarget(actor, [civilian, soldier, near, friend, dead], 8)?.id, near.id);
    assert.equal(chooseTarget(actor, [civilian, soldier], 6)?.id, civilian.id);
    assert.equal(chooseTarget(actor, [civilian, soldier], 8, t => t.id !== soldier.id)?.id, civilian.id);
  }
});

test('both sides acquire in alert range, pursue outside it and return when the larger leash is exceeded', () => {
  for (const friendly of [true, false]) {
    const e = new Economy(), c = new Combat(e.state.combat, e, () => []);
    const actor = c.unit(friendly ? 'infantry' : 'enemy-guard')!, target = c.unit(friendly ? 'enemy-guard' : 'infantry')!;
    for (const u of c.state.units) { u.position = { x: 70, z: 70 }; u.cooldown = 8; }
    actor.position = { ...OUTPOST }; target.position = { x: OUTPOST.x + C.acquire - .2, z: OUTPOST.z };
    c.update(.05); assert.equal(actor.target, target.id);
    const anchor = { ...actor.defendFrom! };
    target.position = { x: OUTPOST.x + C.acquire + 2, z: OUTPOST.z };
    target.order = 'move'; target.goal = { x: OUTPOST.x + 30, z: OUTPOST.z };
    c.update(.05); assert.equal(actor.target, target.id, 'leaving alert radius does not drop an established opponent');
    target.position = { x: OUTPOST.x + C.chase + 2, z: OUTPOST.z };
    c.update(.05); assert.equal(actor.target, undefined); assert.equal(actor.order, 'hold');
    assert.deepEqual(actor.goal, friendly ? { x: anchor.x, z: anchor.z } : actor.home);
  }
});

test('enemy soldiers acquire every civilian role; lethal damage stops work/food and survives reload', () => {
  for (const id of ['farmer', 'farmer-2', 'farmer-leader', 'dog']) {
    const e = new Economy(), c = new Combat(e.state.combat, e, () => []), foe = c.unit('enemy-guard')!;
    e.setLeadership(false);
    for (const u of c.state.units) if (u !== foe) u.position = { x: 65, z: 65 };
    foe.position = { x: OUTPOST.x, z: OUTPOST.z };
    const position = { x: OUTPOST.x, z: OUTPOST.z + 1.3 };
    c.setResidentPositions(other => other === id ? position : { x: 65, z: 60 });
    e.state.residents[id] = { position, manualGoal: { x: 0, z: 0 } };
    e.state.vitals[id].hp = 1; e.state.vitals[id].meal = { remaining: 4 };
    const before = livingPopulation(e.state);
    let cargo: string | undefined;
    if (id !== 'dog') {
      cargo = e.dropReward(position, { wood: 3 })[0];
      const task = e.request('haul', cargo).task!; assert(e.assign(task.id, id).ok); e.arrive(task.id);
      assert.equal(e.state.goods.find(g => g.id === cargo)!.state, 'transit');
    }
    c.update(.05); assert.equal(foe.target, id);
    for (let i = 0; i < 10; i++) { e.state.seconds += .05; c.update(.05); }
    assert.equal(health(e.state, id), 0); assert(e.state.vitals[id].diedAt! > 0);
    assert.equal(e.active(id), undefined); assert.equal(e.state.vitals[id].meal, undefined);
    assert.equal(livingPopulation(e.state), before - (id === 'dog' ? 0 : 1));
    if (cargo) assert.equal(e.state.goods.find(g => g.id === cargo)!.state, 'ground');
    const restored = decodeEconomy(encodeEconomy(e));
    changeHealth(restored.state, id, 100); eat(restored.state, id, 20);
    assert.equal(health(restored.state, id), 0); assert(!needsFood(restored.state, id));
    assert.equal(restored.state.residents[id].manualGoal, undefined);
    assert.equal(restored.claim(id), undefined);
    const task = restored.state.tasks.find(t => t.status === 'waiting');
    if (task) assert.equal(restored.assign(task.id, id).ok, false);
  }
});

test('priority promotes an automatic civilian target but preserves an explicit player target', () => {
  const e = new Economy(), c = new Combat(e.state.combat, e, () => []), foe = c.unit('enemy-guard')!, ally = c.unit('infantry')!;
  for (const u of c.state.units) { u.position = { x: 60, z: 60 }; u.cooldown = 8; }
  foe.position = { ...OUTPOST }; c.setResidentPositions(id => id === 'farmer' ? { x: OUTPOST.x + 1, z: OUTPOST.z } : { x: 60, z: 60 });
  c.update(.05); assert.equal(foe.target, 'farmer');
  ally.position = { x: OUTPOST.x + 6, z: OUTPOST.z }; c.update(.05); assert.equal(foe.target, ally.id);
  const other = c.unit('enemy-sentry')!; other.position = { x: OUTPOST.x + 5, z: OUTPOST.z + 1 };
  assert.equal(c.attack([ally.id], foe.id), 1); c.update(.05); assert.equal(ally.target, foe.id);
  assert.equal(c.move([ally.id], { x: OUTPOST.x + 20, z: OUTPOST.z }), 1); c.update(.05); assert.equal(ally.target, undefined);
});

test('six extra enemies and six fixed wolves occupy legal sites away from the starting residents', () => {
  const extra = ENEMIES.filter(r => ['road', 'grove', 'ore'].includes(r.camp!));
  assert.equal(extra.length, 6); assert.equal(WILD_WOLF_SPAWNS.length, 6);
  const solids = economyObstacles([], [], []);
  for (const { p, radius } of [...extra.map(r => ({ p: r.spawn, radius: r.bodyRadius })), ...WILD_WOLF_SPAWNS.map(p => ({ p, radius: .72 }))]) {
    assert(!isBlocked(p, radius, solids));
    assert(RESIDENTS.every(r => Math.hypot(p.x - r.spawn.x, p.z - r.spawn.z) > C.acquire + 6));
  }
  const e = new Economy(); assert.equal(allWolves(e.state.raids).length, 6);
  assert.deepEqual(decodeEconomy(encodeEconomy(e)).state.raids.wildWolves, e.state.raids.wildWolves.map(w => ({ ...w, planIn: .2 })));
});
