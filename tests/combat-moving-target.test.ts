import test from 'node:test';
import assert from 'node:assert/strict';
import { Combat, fighterStats, fighterRadius } from '../src/game/combat.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import type { Obstacle } from '../src/game/movement.ts';
import { leadShot } from '../src/game/combat-aim.ts';
import { Raids } from '../src/game/raids.ts';

function duel(actorId = 'infantry', targetId = 'enemy-guard', gap?: number) {
  const e = new Economy(); e.setLeadership(false);
  const walls: Obstacle[] = [], c = new Combat(e.state.combat, e, () => walls);
  for (const u of c.state.units) { u.life = 'defeated'; u.hp = 0; u.diedAt = 0; u.order = 'hold'; }
  const a = c.unit(actorId)!, b = c.unit(targetId)!;
  for (const u of [a, b]) { u.life = 'active'; u.hp = fighterStats(u).hp; u.diedAt = undefined; }
  b.position = { x: b.home.x + 20, z: b.home.z }; b.order = 'hold'; b.goal = { ...b.home }; b.route = [{ ...b.home }]; b.cooldown = 8;
  a.position = { x: b.position.x + (gap ?? fighterStats(a).range + .1), z: b.position.z };
  // The same explicit pursuit order is valid for either faction.
  a.order = 'attack'; a.target = b.id;
  const step = () => { e.state.seconds += .05; c.update(.05); };
  return { e, c, a, b, walls, step };
}

for (const role of ['infantry', 'cavalry', 'archer']) test(`${role} catches and hits a returning enemy before it reaches home`, () => {
  const { a, b, step } = duel(role); const hp = b.hp;
  for (let i = 0; i < 100 && b.hp === hp; i++) {
    step();
    assert(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) >= fighterRadius(a) + fighterRadius(b) - 1e-6);
  }
  assert(b.hp < hp, 'continuous return movement must not make the target untouchable');
  assert(Math.hypot(b.position.x - b.home.x, b.position.z - b.home.z) > 2, 'hit happened during the return');
});

test('enemy melee and archers use the same moving-target rules', () => {
  for (const id of ['enemy-guard', 'enemy-archer']) {
    const { a, b, step } = duel(id, 'infantry', id === 'enemy-guard' ? 1.8 : 4);
    // Controlled target motion tests enemy prediction independently of stamina.
    b.order='rest';b.goal=undefined;b.route=[];
    const hp = b.hp;
    for (let i = 0; i < 100 && b.hp === hp; i++){b.position.x-=.1;step();}
    assert(b.hp < hp, `${a.id} should hit a nearby retreating opponent`);
  }
});

test('a melee victim can still escape the committed strike or gain cover', () => {
  for (const cover of [false, true]) {
    const { a, b, walls, step } = duel('infantry', 'enemy-guard', 1);
    b.goal = undefined; b.route = []; step(); assert(a.attack);
    const hp = b.hp;
    if (cover) walls.push({ kind: 'box', x: (a.position.x + b.position.x) / 2, z: b.position.z, halfWidth: .05, halfDepth: 2 });
    else b.position = { x: b.position.x - 4, z: b.position.z };
    while (a.attack && !a.attack.released) step();
    assert.equal(b.hp, hp);
  }
});

test('a faster runner can escape a slower melee pursuer', () => {
  const { a, b, step } = duel('enemy-guard', 'cavalry', 3.2);
  const hp = b.hp, initial = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
  for (let i = 0; i < 60; i++) step();
  assert.equal(b.hp, hp);
  assert(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > initial);
});

test('a clear approach point with blocked aim still routes around cover', () => {
  const { a, b, walls, step } = duel('archer', 'enemy-guard', 4.3);
  b.goal = undefined; b.route = [];
  walls.push({ kind: 'box', x: b.position.x + 2.3, z: b.position.z, halfWidth: .3, halfDepth: 2 });
  const hp = b.hp;
  for (let i = 0; i < 160 && b.hp === hp; i++) {
    // Hold the target in place so its own pursuit cannot hide a stuck archer.
    b.order = 'move'; b.goal = { ...b.position }; b.route = []; step();
  }
  assert(b.hp < hp, 'the archer must find a shooting angle instead of waiting behind cover');
  assert(Math.abs(a.position.z - b.position.z) > 1);
});

test('leading arrows keep a committed landing point; changing direction can dodge', () => {
  const { c, a, b, step } = duel('archer', 'enemy-guard', 5);
  for (let i = 0; i < 30 && !c.state.projectiles.length; i++) step();
  assert.equal(c.state.projectiles.length, 1);
  const shot = c.state.projectiles[0], landing = { ...shot.to }, hp = b.hp;
  assert(landing.x < b.position.x - .3, 'aim ahead of the moving target');
  c.move([a.id], { x: a.position.x + 10, z: a.position.z });
  b.goal = { x: b.position.x, z: b.position.z + 10 }; b.route = [{ ...b.goal }];
  for (let i = 0; i < 20 && c.state.projectiles.length; i++) { step(); assert.deepEqual(shot.to, landing); }
  assert.equal(c.state.projectiles.length, 0);
  assert.equal(b.hp, hp);
});

test('an in-flight lead shot survives reload and settles damage exactly once', () => {
  const { e, c, a, b, step } = duel('archer', 'enemy-guard', 5);
  for (let i = 0; i < 30 && !c.state.projectiles.length; i++) step();
  assert.equal(c.state.projectiles.length, 1);
  c.move([a.id], { x: a.position.x + 10, z: a.position.z });
  const saved = encodeEconomy(e), restored = decodeEconomy(saved), next = new Combat(restored.state.combat, restored, () => []);
  assert.deepEqual(next.state.projectiles, c.state.projectiles);
  const hp = b.hp;
  for (let i = 0; i < 20; i++) { restored.state.seconds += .05; next.update(.05); }
  assert.equal(next.unit(b.id)!.hp, hp - fighterStats(a).attack * 20 / (20 + fighterStats(b).armor));
  assert.equal(next.state.projectiles.length, 0);
});

test('lead aims at a final stop instead of extrapolating past it', () => {
  const from = { x: 0, z: 0 }, target = { x: 5, z: 0 }, velocity = { x: 3.3, z: 0 }, stop = { x: 5.2, z: 0 };
  const shot = leadShot(from, target, velocity, 14, stop);
  assert.deepEqual(shot.point, stop);
  assert(Math.abs(shot.duration - 5.2 / 14) < 1e-8);
  const crossing = leadShot(from, target, { x: 0, z: 3.3 }, 14);
  assert(Math.abs(crossing.point.z - 3.3 * crossing.duration) < 1e-8);
  assert(Math.abs(Math.hypot(crossing.point.x, crossing.point.z) - 14 * crossing.duration) < 1e-8);
});

test('soldiers can hit a fleeing wolf updated by the real raid movement system', () => {
  for (const id of ['infantry', 'cavalry', 'archer']) {
    const { e, c, a, b } = duel(id); b.hp = 0; b.life = 'defeated'; b.diedAt = 0;
    const wolf = e.state.raids.wildWolves[0];
    wolf.position = { x: wolf.home.x + 20, z: wolf.home.z }; wolf.mode = 'flee'; wolf.fear = 10; wolf.route = [{ ...wolf.home }];
    a.position = { x: wolf.position.x + fighterStats(a).range + .3, z: wolf.position.z }; a.target = wolf.id;
    const raids = new Raids(e, c, { status: () => ({ position: { x: 70, z: -70 }, moving: false }),
      command: () => true, release: () => {}, resting: () => {}, neighbours: () => [],
    }, () => [], () => true);
    const hp = wolf.hp;
    for (let i = 0; i < 100 && wolf.hp === hp; i++) { e.state.seconds += .05; raids.update(.05); c.update(.05); }
    assert(wolf.hp < hp, `${id} should hit the fleeing wolf`);
    assert(Math.hypot(wolf.position.x - wolf.home.x, wolf.position.z - wolf.home.z) > 2);
  }
});

test('slower melee has a bounded follow-through without extending attack initiation', () => {
  for (const offset of [.45, .55]) {
    const { a, b, step } = duel('infantry', 'enemy-guard', 1.6);
    b.goal = undefined; b.route = []; step(); assert(a.attack);
    const hp = b.hp;
    b.position.x = a.position.x - 1.6 - offset;
    b.order = 'hold'; b.goal = { ...b.position }; // Prevent retaliation and hold position for contact.
    while (!a.attack?.released) { b.order = 'hold'; b.goal = { ...b.position }; step(); }
    assert.equal(b.hp < hp, offset < .5);
  }
  const { a, b, step } = duel('infantry', 'enemy-guard', 1.9);
  b.goal = undefined; b.route = []; step();
  assert(!a.attack, 'follow-through does not permit starting from outside ordinary reach');
});
