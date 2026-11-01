import test from 'node:test';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import assert from 'node:assert/strict';
import { Combat } from '../src/game/combat.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { COMBAT_CONFIG as C, OUTPOST } from '../src/game/combat-config.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { isBlocked } from '../src/game/movement.ts';
import type { Obstacle } from '../src/game/movement.ts';
function setup(solids: Obstacle[] = []) {
  const e = new Economy(), c = new Combat(e.state.combat, e, () => solids);
  for (const u of c.state.units) u.order = 'hold';
  const a = c.unit('infantry')!, b = c.unit('enemy-guard')!, archer = c.unit('archer')!;
  a.position = { x: OUTPOST.x + 2, z: OUTPOST.z }; b.position = { x: OUTPOST.x + .7, z: OUTPOST.z }; archer.position = { x: OUTPOST.x + 5, z: OUTPOST.z };
  return { e, c, a, b, archer };
}
function advance(c: Combat, seconds: number, check = () => {}) { for (let i = 0; i < Math.ceil(seconds / .05); i++) { c.update(.05); check(); } }

test('melee windup hits once and repeated clicks cannot bypass cooldown', () => {
  const { c, a, b } = setup(); c.attack([a.id], b.id); c.update(.05);
  const serial = a.attack!.id; const hp = b.hp;
  advance(c, .3, () => { c.attack([a.id], b.id); assert.equal(a.attack!.id, serial); });
  assert.equal(b.hp, hp);
  advance(c, .15); assert.equal(b.hp, hp - C.infantry.attack + C.enemyMelee.armor);
  advance(c, .6, () => c.attack([a.id], b.id)); assert.equal(b.hp, hp - C.infantry.attack + C.enemyMelee.armor);
  assert(a.cooldown > 0);
});
test('manual move cancels a windup, retains cooldown and suppresses auto acquisition throughout travel', () => {
  const { c, a, b } = setup(); c.attack([a.id], b.id); c.update(.05);
  const hp = b.hp; assert.equal(c.move([a.id], { x: OUTPOST.x + 12, z: OUTPOST.z }), 1);
  c.update(.05); assert(a.cooldown > 0); assert(!a.attack); assert(!a.target);
  advance(c, 1); assert.equal(a.order, 'move'); assert.equal(b.hp, hp);
});
test('idle soldiers do not hunt; both sides retaliate and a manual move wins over incoming hits', () => {
  const { e, c, a, b } = setup();
  a.order = 'guard'; b.order = 'hold'; b.goal = { ...b.position }; b.cooldown = 8;
  c.update(.05); assert.equal(a.target, undefined);
  c.attack([a.id], b.id); advance(c, .5);
  assert.equal(b.target, a.id, 'enemy retaliates against its attacker');
  c.move([a.id], { x: OUTPOST.x + 10, z: OUTPOST.z });
  const hit = () => c.state.projectiles.push({ id: c.state.nextAttack++, source: b.id, target: a.id,
    from: { ...b.position }, to: { ...a.position }, elapsed: 0, duration: .01, damage: 5 });
  hit(); c.update(.05); assert.equal(a.order, 'move'); assert(!a.target); assert(!a.attack);
  // Once stopped, receiving a fresh hit triggers retaliation without a UI switch.
  a.order = 'hold'; a.route = []; a.goal = undefined; hit(); c.update(.05);
  assert.equal(a.target, b.id); assert.equal(a.order, 'guard');
  const restored = decodeEconomy(encodeEconomy(e)); assert.equal(restored.state.combat.units.find(u => u.id === a.id)!.target, b.id);
});
test('projectiles release once, persist through reload, and cannot hit through cover', () => {
  const { e, c, a, archer, b } = setup(); a.position = { x: 0, z: 0 }; c.attack([archer.id], b.id); advance(c, .65);
  assert.equal(c.state.projectiles.length, 1); const hp = b.hp;
  const restored = decodeEconomy(encodeEconomy(e)), next = new Combat(restored.state.combat, restored, () => []);
  advance(next, .45); assert.equal(next.unit(b.id)!.hp, hp - C.archer.attack + C.enemyMelee.armor);
  advance(next, .3); assert.equal(next.unit(b.id)!.hp, hp - C.archer.attack + C.enemyMelee.armor);
  const blocked = decodeEconomy(encodeEconomy(e));
  const wall: Obstacle = { kind: 'box', x: OUTPOST.x + 3, z: OUTPOST.z, halfWidth: .2, halfDepth: 10 };
  const cover = new Combat(blocked.state.combat, blocked, () => [wall]); advance(cover, .4);
  assert.equal(cover.unit(b.id)!.hp, hp);
});
test('archers reposition around cover instead of releasing through it', () => {
  const wall: Obstacle = { kind: 'box', x: OUTPOST.x + 3, z: OUTPOST.z, halfWidth: .3, halfDepth: 2 };
  const { c, archer, b } = setup([wall]); c.attack([archer.id], b.id);
  c.update(.05); assert(!archer.attack); assert(archer.route.length);
  advance(c, 12, () => assert(!isBlocked(archer.position, .4, [wall])));
  assert(b.hp < C.enemyMelee.hp);
});
test('enemy target is stable and chase is limited to the outpost', () => {
  const { c, a, b } = setup(); b.order = 'guard'; c.update(.05); assert.equal(b.target, a.id);
  a.position = { x: OUTPOST.x + 20, z: OUTPOST.z }; c.unit('archer')!.position = { x: 0, z: 0 }; c.update(.05);
  assert.equal(b.order, 'hold'); assert.equal(b.target, undefined);
  advance(c, 4); assert(Math.hypot(b.position.x - b.home.x, b.position.z - b.home.z) < .5);
});
test('actual map paths and shared crowd follower keep soldiers out of solids and apart', () => {
  const e = new Economy(), solids = economyObstacles([], []), c = new Combat(e.state.combat, e, () => solids);
  const allies = c.state.units.filter(u => u.team === 'home');
  assert.equal(c.attack(allies.map(u => u.id), 'enemy-guard'), 2);
  advance(c, 20, () => {
    for (const u of c.state.units) assert(!isBlocked(u.position, .399, solids), `${u.id} crossed terrain`);
    const live = c.state.units.filter(u => u.life !== 'defeated');
    for (let i = 0; i < live.length; i++) for (const v of live.slice(i + 1)) assert(Math.hypot(live[i].position.x - v.position.x, live[i].position.z - v.position.z) >= .795);
  });
  assert(c.unit('enemy-guard')!.hp < C.enemyMelee.hp);
});
test('injury holds position without automatic home recovery or warehouse food charges', () => {
  const { e, c, a, b } = setup(); a.hp = 1; b.order = 'guard'; e.state.inventory.food = 30;
  advance(c, 1); assert.equal(a.life, 'injured'); assert.equal(a.hp, 0);
  const where = { ...a.position }; advance(c, 35);
  assert.deepEqual(a.position, where); assert.equal(a.hp, 0); assert.equal(e.state.inventory.food, 30);
  const restored = decodeEconomy(encodeEconomy(e)), next = new Combat(restored.state.combat, restored, () => []);
  advance(next, 30); assert.equal(next.unit(a.id)!.life, 'injured'); assert.equal(next.unit(a.id)!.hp, 0);
  assert.equal(restored.state.inventory.food, 30);
  assert.equal(next.move([a.id], { x: OUTPOST.x + 10, z: OUTPOST.z }, true), 1);
  advance(next, 1); assert(next.unit(a.id)!.position.x > where.x);
});
test('outpost reward is a single ground delivery; reload and capacity cannot mint inventory', () => {
  const { e, c } = setup();
  for (const u of c.state.units.filter(u => u.team === 'enemy')) { u.hp = 0; u.life = 'defeated'; }
  const inventory = { ...e.state.inventory }; c.update(.05);
  assert(c.state.rewardGranted); assert.equal(e.state.goods.length, 3); assert.deepEqual(e.state.inventory, inventory);
  const restored = decodeEconomy(encodeEconomy(e)), next = new Combat(restored.state.combat, restored, () => []);
  advance(next, 2); restored.advance(.05); assert.equal(restored.state.goods.length, 3);
  assert.deepEqual(restored.state.inventory, inventory);
  const wood = restored.state.goods.find(g => g.resource === 'wood')!;
  const task = restored.taskFor(wood.id)!; restored.assign(task.id); restored.arrive(task.id);
  restored.state.inventory.wood = restored.capacity().wood - 1; restored.arrive(task.id);
  assert.equal(wood.amount, C.reward.wood - 1); assert.equal(restored.state.inventory.wood, restored.capacity().wood);
  next.update(.05); assert.equal(restored.state.goods.length, 3);
});
test('pause freezes every combat field; corrupt or old saves are rejected', () => {
  const { e, c, a, b } = setup(); c.attack([a.id], b.id); c.update(.05);
  const before = encodeEconomy(e); c.update(0); c.update(Number.NaN); assert.equal(encodeEconomy(e), before);
  const bad = JSON.parse(before); bad.combat.units[0].hp = 999; assert.throws(() => decodeEconomy(JSON.stringify(bad)));
  const old = JSON.parse(before); old.version = 5; assert.throws(() => decodeEconomy(JSON.stringify(old)));
});

test('a picked Babylon destination actually moves the soldier and remains valid across reload', () => {
  const { e, c, a } = setup();
  a.position = { x: 0, z: 1.2 };
  const clicked = new Vector3(-.7, 0, -2), before = { ...a.position };
  assert.equal(c.move([a.id], clicked), 1);
  assert.deepEqual(a.goal, { x: clicked.x, z: clicked.z });
  assert.deepEqual(a.route.at(-1), a.goal);
  advance(c, .3);
  assert(Math.hypot(a.position.x - before.x, a.position.z - before.z) > .5, 'the accepted click must move the body');
  const restored = decodeEconomy(encodeEconomy(e)), next = new Combat(restored.state.combat, restored, () => []);
  assert.deepEqual(next.unit(a.id)!.goal, { x: clicked.x, z: clicked.z });
  advance(next, 4);
  assert(Math.hypot(next.unit(a.id)!.position.x - clicked.x, next.unit(a.id)!.position.z - clicked.z) < .15);
  const state = encodeEconomy(restored);
  assert.equal(next.move([a.id], new Vector3(NaN, 0, 0)), 0);
  assert.equal(encodeEconomy(restored), state, 'invalid coordinates must not cancel the previous order');
});
