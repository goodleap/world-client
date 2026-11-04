import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat, fighterStats } from '../src/game/combat.ts';
import { COMBAT_CONFIG as C } from '../src/game/combat-config.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { ENEMIES } from '../src/game/resident-data.ts';
import { newTower } from '../src/game/towers.ts';
import { buildingAt } from '../src/game/construction.ts';
import { Raids } from '../src/game/raids.ts';
import type { Obstacle } from '../src/game/movement.ts';

function fight(enemy = 'enemy-guard', home = false) {
  const e = new Economy(); e.setLeadership(false); e.state.raids.nextAt = 1000;
  const walls: Obstacle[] = [], c = new Combat(e.state.combat, e, () => walls);
  c.setResidentPositions(() => ({ x: 75, z: 75 }));
  const actor = c.unit(home ? 'infantry' : enemy)!, distant = c.unit(home ? enemy : 'archer')!, near = c.unit(home ? 'enemy-sentry' : 'infantry')!;
  for (const u of c.state.units) if (![actor, distant, near].includes(u)) { u.life = 'defeated'; u.hp = 0; u.diedAt = 0; }
  actor.position = { x: 0, z: -20 }; actor.target = distant.id;
  actor.defendFrom = { ...actor.position };
  if (actor.team === 'enemy') actor.provoked = { from: { ...actor.position }, leash: 30 };
  distant.position = { x: 11, z: -20 }; near.position = { x: 1.3, z: -20 };
  const step = (count = 1) => {
    for (let i = 0; i < count; i++) {
      for (const u of [distant, near]) { u.order = 'move'; u.goal = undefined; u.route = []; u.attack = undefined; u.target = undefined; }
      e.state.seconds += .05; c.update(.05);
    }
  };
  return { e, c, actor, distant, near, walls, step };
}

for (const id of ['enemy-guard', 'enemy-archer', ENEMIES.find(r => r.role === 'cavalry')!.id]) {
  test(`${id} switches from a distant attacker to a soldier in actual reach and deals damage`, () => {
    const { actor, distant, near, step } = fight(id), before = near.hp, farHP = distant.hp;
    step(); assert.equal(actor.target, near.id); assert.equal(actor.attack?.target, near.id);
    step(18); assert(near.hp < before); assert.equal(distant.hp, farHP);
    assert.equal(actor.target, near.id); assert.equal(actor.speed, 0);
  });
}

test('home automatic combat follows the same rule, while a player attack or move is authoritative', () => {
  const { c, actor, distant, near, step } = fight('enemy-guard', true);
  c.attack([actor.id], distant.id); c.hurt(actor.id, 1, near.id); step();
  assert.equal(actor.target, distant.id); assert.equal(actor.order, 'attack');
  c.guard([actor.id]); actor.target = distant.id; step(); assert.equal(actor.target, near.id);
  assert.equal(c.move([actor.id], { x: -5, z: -20 }), 1); step(); assert.equal(actor.target, undefined);
});

test('an attackable current opponent is retained even when another is closer', () => {
  const { actor, distant, near, step } = fight();
  distant.position = { x: 1.5, z: -20 }; near.position = { x: 0, z: -21.2 };
  step(4); assert.equal(actor.target, distant.id); assert.equal(actor.attack?.target, distant.id);
});

test('finishes the committed swing, then changes target without resetting attack cooldown', () => {
  const { e, c, actor, distant, near, step } = fight();
  actor.attack = { id: e.state.combat.nextAttack++, target: distant.id, elapsed: 0, released: false };
  actor.cooldown = fighterStats(actor).interval;
  c.hurt(actor.id, 1, near.id);
  step(3); assert.equal(actor.target, distant.id); assert.equal(actor.attack?.target, distant.id);
  assert(Math.abs(actor.cooldown - (fighterStats(actor).interval - .15)) < 1e-8);
  const old = actor.attack;
  for (let i = 0; i < 30 && actor.attack === old; i++) step();
  step(); assert.equal(actor.target, near.id);
  assert.equal(near.hp, fighterStats(near).hp, 'switching never skips the new attack windup');
  if (actor.attack) assert.notEqual(actor.attack.id, old!.id);
});

test('switch cooldown survives reload and delays another switch until it expires', () => {
  const { e, actor, distant, near, step } = fight();
  actor.cooldown = 5; step(); assert.equal(actor.target, near.id);
  assert.equal(decodeEconomy(encodeEconomy(e)).state.combat.units.find(u => u.id === actor.id)!.targetSwitchIn, actor.targetSwitchIn);
  near.position = { x: 8, z: -20 }; distant.position = { x: -1.4, z: -20 };
  // Hold the positions steady so pursuit does not move the candidate out of reach.
  for (let i = 0; i < 18; i++) {
    actor.position = { x: 0, z: -20 }; step();
    if (i < 6) assert.equal(actor.target, near.id);
  }
  assert.equal(actor.target, distant.id);
  const bad = JSON.parse(encodeEconomy(e)); bad.combat.units.find((u: { id: string }) => u.id === actor.id).targetSwitchIn = C.targetSwitchSeconds + 1;
  assert.throws(() => decodeEconomy(JSON.stringify(bad)), /战斗人物/);
});

test('does not switch to an occluded soldier or an unreachable tower occupant', () => {
  const { e, actor, distant, near, walls, step } = fight();
  walls.push({ kind: 'box', x: .65, z: -20, halfWidth: .1, halfDepth: .4 });
  step(); assert.equal(actor.target, distant.id);
  walls.length = 0; actor.position = { x: 0, z: -20 }; actor.route = [];
  const site = buildingAt('tower', near.position, 'site-0'), tower = newTower(site);
  tower.unit = near.id; tower.phase = 'occupied'; e.state.towers.push(tower);
  step(); assert.equal(actor.target, distant.id);
});

test('a melee soldier chasing a tower attacker engages a nearby soldier first', () => {
  const { e, c, actor, distant, near, step } = fight();
  const site = buildingAt('tower', distant.position, 'site-0'), tower = newTower(site);
  e.state.sites.push(site); e.state.buildings.push(site.id); tower.unit = distant.id; tower.phase = 'occupied'; e.state.towers.push(tower);
  actor.target = undefined; c.hurt(actor.id, 1, distant.id); assert.equal(actor.target, tower.id);
  step(); assert.equal(actor.target, near.id);
});

test('wolves also engage nearby soldiers, but fear and low-health retreat remain higher priority', () => {
  const { e, c, distant, near } = fight();
  const w = e.state.raids.wildWolves[0]; w.position = { x: 0, z: -20 }; w.target = distant.id;
  w.provoked = { from: { ...w.position }, leash: 30 }; w.mode = 'hunt';
  const raids = new Raids(e, c, { status: () => ({ position: { x: 75, z: 75 }, moving: false }), command: () => true,
    release: () => {}, resting: () => {}, neighbours: () => [] }, () => [], () => false);
  raids.update(.05); assert.equal(w.target, near.id); assert.equal(w.attack?.target, near.id);
  w.hp = 10; raids.update(.05); assert.equal(w.mode, 'flee'); assert.equal(w.target, undefined);
});
