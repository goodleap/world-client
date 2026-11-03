import test from 'node:test';
import { bodiesFor } from '../src/game/vitals.ts';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import assert from 'node:assert/strict';
import { Combat, fighterRadius, fighterStats } from '../src/game/combat.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { COMBAT_CONFIG as C, OUTPOST, ENCOUNTERS } from '../src/game/combat-config.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { isBlocked } from '../src/game/movement.ts';
import type { Obstacle } from '../src/game/movement.ts';
function setup(solids: Obstacle[] = []) {
  const e = new Economy(), c = new Combat(e.state.combat, e, () => solids);
  // Isolate the duel; other guards still retain their real autonomous AI.
  for (const u of c.state.units) { u.order = 'guard'; u.position = { x: 60, z: -70 }; u.cooldown = 8; }
  const a = c.unit('infantry')!, b = c.unit('enemy-guard')!, archer = c.unit('archer')!;
  a.cooldown = archer.cooldown = b.cooldown = 0;
  a.position = { x: OUTPOST.x + 2, z: OUTPOST.z }; b.position = { x: OUTPOST.x + .7, z: OUTPOST.z }; archer.position = { x: 55, z: -70 };
  return { e, c, a, b, archer };
}
function advance(c: Combat, seconds: number, check = () => {}) { for (let i = 0; i < Math.ceil(seconds / .05); i++) { c.update(.05); check(); } }

test('melee windup hits once and repeated clicks cannot bypass cooldown', () => {
  const { c, a, b } = setup(); c.attack([a.id], b.id); c.update(.05);
  const serial = a.attack!.id; const hp = b.hp;
  for (let i = 0; i < 5; i++) { c.attack([a.id], b.id); c.update((C.infantry.windup - .01) / 5); assert.equal(a.attack!.id, serial); }
  assert.equal(b.hp, hp);
  c.update(.02); assert.equal(b.hp, hp - C.infantry.attack * 20 / (20 + C.enemyMelee.armor));
  advance(c, C.infantry.recovery, () => c.attack([a.id], b.id)); assert.equal(b.hp, hp - C.infantry.attack * 20 / (20 + C.enemyMelee.armor));
  assert(a.cooldown > 0);
});
test('manual move cancels a windup, retains cooldown and suppresses auto acquisition throughout travel', () => {
  const { c, a, b, archer } = setup(); archer.position = { x: 60, z: -70 }; c.attack([a.id], b.id); c.update(.05);
  const hp = b.hp; assert.equal(c.move([a.id], { x: OUTPOST.x + 12, z: OUTPOST.z }), 1);
  c.update(.05); assert(a.cooldown > 0); assert(!a.attack); assert(!a.target);
  advance(c, 1); assert.equal(a.order, 'move'); assert.equal(b.hp, hp);
});
test('idle soldiers proactively engage; both sides retaliate and manual movement wins', () => {
  const { e, c, a, b } = setup();
  a.order = 'guard'; b.order = 'hold'; b.goal = { ...b.position }; b.cooldown = 8;
  c.update(.05); assert.equal(a.target, b.id);
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
  const { e, c, a, archer, b } = setup(); a.position = { x: 0, z: 0 }; archer.position = { x: OUTPOST.x + 2, z: OUTPOST.z }; c.attack([archer.id], b.id); advance(c, .05 + C.archer.windup);
  c.move([archer.id], { x: OUTPOST.x + 20, z: OUTPOST.z }); b.cooldown = 8;
  assert.equal(c.state.projectiles.length, 1); const hp = b.hp;
  const restored = decodeEconomy(encodeEconomy(e)), next = new Combat(restored.state.combat, restored, () => []);
  advance(next, .45); assert.equal(next.unit(b.id)!.hp, hp - C.archer.attack * 20 / (20 + C.enemyMelee.armor));
  advance(next, .3); assert.equal(next.unit(b.id)!.hp, hp - C.archer.attack * 20 / (20 + C.enemyMelee.armor));
  const blocked = decodeEconomy(encodeEconomy(e));
  const wall: Obstacle = { kind: 'box', x: OUTPOST.x + 1.4, z: OUTPOST.z, halfWidth: .2, halfDepth: 10 };
  const cover = new Combat(blocked.state.combat, blocked, () => [wall]); advance(cover, .4);
  assert.equal(cover.unit(b.id)!.hp, hp);
});
test('archers reposition around cover instead of releasing through it', () => {
  const wall: Obstacle = { kind: 'box', x: OUTPOST.x + 3, z: OUTPOST.z, halfWidth: .3, halfDepth: 2 };
  const { c, archer, b } = setup([wall]); archer.position = { x: OUTPOST.x + 5, z: OUTPOST.z }; c.attack([archer.id], b.id);
  c.update(.05); assert(!archer.attack); assert(archer.route.length);
  advance(c, 12, () => assert(!isBlocked(archer.position, .4, [wall])));
  assert(b.hp < C.enemyMelee.hp);
});
test('enemy target is stable and chase is limited to the outpost', () => {
  const { c, a, b } = setup(); b.order = 'guard'; c.update(.05); assert.equal(b.target, a.id);
  a.position = { x: OUTPOST.x + 20, z: OUTPOST.z }; c.move([a.id], { x: OUTPOST.x + 35, z: OUTPOST.z }); c.unit('archer')!.position = { x: 0, z: 0 }; c.update(.05);
  assert.equal(b.order, 'hold'); assert.equal(b.target, undefined);
  advance(c, 4); assert(Math.hypot(b.position.x - b.home.x, b.position.z - b.home.z) < .5);
});
test('actual map paths and shared crowd follower keep soldiers out of solids and apart', () => {
  const e = new Economy(), solids = economyObstacles([], []), c = new Combat(e.state.combat, e, () => solids);
  const allies = c.state.units.filter(u => u.team === 'home');
  assert.equal(c.attack(allies.map(u => u.id), 'enemy-guard'), 3);
  advance(c, 20, () => {
    for (const u of c.state.units) assert(!isBlocked(u.position, fighterRadius(u) - .001, solids), `${u.id} crossed terrain`);
    const live = c.state.units.filter(u => u.life !== 'defeated');
    for (let i = 0; i < live.length; i++) for (const v of live.slice(i + 1)) assert(Math.hypot(live[i].position.x - v.position.x, live[i].position.z - v.position.z) >= fighterRadius(live[i]) + fighterRadius(v) - .005);
  });
  assert(c.unit('enemy-guard')!.hp < C.enemyMelee.hp);
});
test('death holds position without automatic home recovery or warehouse food charges', () => {
  const { e, c, a, b } = setup(); a.hp = 1; b.order = 'guard'; e.state.inventory.food = 30;
  advance(c, 1); assert.equal(a.life, 'defeated'); assert.equal(a.hp, 0);
  const where = { ...a.position }; advance(c, 35);
  assert.deepEqual(a.position, where); assert.equal(a.hp, 0); assert.equal(e.state.inventory.food, 30);
  const restored = decodeEconomy(encodeEconomy(e)), next = new Combat(restored.state.combat, restored, () => []);
  advance(next, 30); assert.equal(next.unit(a.id)!.life, 'defeated'); assert.equal(next.unit(a.id)!.hp, 0);
  assert.equal(restored.state.inventory.food, 30);
  assert.equal(next.move([a.id], { x: OUTPOST.x + 10, z: OUTPOST.z }, true), 0);
  advance(next, 1); assert.deepEqual(next.unit(a.id)!.position, where);
});
test('outpost reward is a single ground delivery; reload and capacity cannot mint inventory', () => {
  const { e, c } = setup();
  for (const u of c.state.units.filter(u => u.team === 'enemy')) { u.hp = 0; u.life = 'defeated'; }
  const inventory = { ...e.state.inventory }; c.update(.05);
  assert(c.state.rewardGranted); assert.equal(e.state.goods.length, ENCOUNTERS.reduce((n, camp) => n + Object.keys(camp.reward).length, 0)); assert.deepEqual(e.state.inventory, inventory);
  const restored = decodeEconomy(encodeEconomy(e)), next = new Combat(restored.state.combat, restored, () => []);
  advance(next, 2); restored.advance(.05); assert.equal(restored.state.goods.length, e.state.goods.length);
  assert.deepEqual(restored.state.inventory, inventory);
  const wood = restored.state.goods.find(g => g.resource === 'wood')!;
  const task = restored.taskFor(wood.id)!; restored.assign(task.id); restored.arrive(task.id);
  restored.state.inventory.wood = restored.capacity().wood - 1; restored.arrive(task.id);
  assert.equal(wood.amount, C.reward.wood - 1); assert.equal(restored.state.inventory.wood, restored.capacity().wood);
  next.update(.05); assert.equal(restored.state.goods.length, e.state.goods.length);
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

test('a nearby fallback goal survives reload and an unreachable click preserves the current order', () => {
  const solids: Obstacle[] = [{kind:'circle',x:0,z:0,radius:.8}, {kind:'circle',x:10,z:0,radius:4}];
  const { e, c, a }=setup(solids); a.position={x:-4,z:0};
  assert.equal(c.move([a.id],new Vector3(0,0,0)),1);
  const goal={...a.goal!}; assert(Math.hypot(goal.x,goal.z)<1.21);
  assert(!isBlocked(goal,fighterRadius(a),solids)); assert.deepEqual(a.route.at(-1),goal);
  const state=encodeEconomy(e);
  assert.equal(c.move([a.id],{x:10,z:0}),0); assert.equal(encodeEconomy(e),state);
  const restored=decodeEconomy(state), next=new Combat(restored.state.combat,restored,()=>solids);
  assert.deepEqual(next.unit(a.id)!.goal,goal);
  advance(next,3); assert(Math.hypot(next.unit(a.id)!.position.x-goal.x,next.unit(a.id)!.position.z-goal.z)<.15);
});


test('soldiers on both sides share the farmer hammer cycle regardless of fatigue', () => {
  for (const stamina of [100, 0]) for (const id of ['infantry', 'archer', 'cavalry', 'enemy-guard', 'enemy-archer', 'enemy-pass-0']) {
    const { e, c } = setup();
    const attacker = c.unit(id)!, target = c.unit(attacker.team === 'home' ? 'enemy-guard' : 'infantry')!;
    attacker.position = { x: OUTPOST.x, z: OUTPOST.z }; target.position = { x: OUTPOST.x + 1.58, z: OUTPOST.z };
    for (const other of c.state.units) if (other !== attacker && other !== target) other.position = { x: 20, z: 20 };
    for (const body of bodiesFor(id)) e.state.vitals[body].stamina = stamina;
    attacker.cooldown = 0; attacker.order = 'attack'; attacker.target = target.id; target.cooldown = 8;
    const starts: number[] = [], releases: number[] = []; let last = 0, released = 0;
    const period = .5;
    for (let i = 0; i < 80; i++) {
      target.hp = fighterStats(target).hp; target.life = 'active'; c.update(.05);
      if (attacker.attack && attacker.attack.id !== last) { last = attacker.attack.id; starts.push(i * .05); }
      if (attacker.attack?.released && attacker.attack.id !== released) { released = attacker.attack.id; releases.push(i * .05); }
    }
    assert(starts.length >= 4, id);
    assert.equal(releases.length, starts.length, id + ' releases once in each complete cycle');
    for (let i = 1; i < starts.length; i++) assert(Math.abs(starts[i] - starts[i - 1] - period) < 1e-8, id + ' actual cadence');
    for (let i = 0; i < releases.length; i++) {
      const contact = fighterStats(attacker).windup;
      assert(releases[i] - starts[i] >= contact - 1e-8 && releases[i] - starts[i] < contact + .05, id + ' action and release stay synchronized');
    }
    if (id === 'cavalry') assert.equal(c.state.projectiles.length, 0, 'lance settles melee damage');
  }
});

test('foot soldiers reach a mounted opponent without overlapping the horse; cavalry saves active attacks', () => {
  const { e, c, b } = setup(), rider = c.unit('cavalry')!;
  for (const u of c.state.units) if (u !== b && u !== rider) u.position = { x: 20, z: 20 };
  rider.position = { x: OUTPOST.x + 4, z: OUTPOST.z }; rider.cooldown = 8;
  b.order = 'guard'; const hp = rider.hp;
  advance(c, 2, () => assert(Math.hypot(rider.position.x - b.position.x, rider.position.z - b.position.z) >= fighterRadius(rider) + fighterRadius(b) - .005));
  assert(rider.hp < hp, 'enemy can hit mounted target');
  rider.cooldown = 0; c.attack([rider.id], b.id); c.update(.05); assert(rider.attack);
  const restored = decodeEconomy(encodeEconomy(e));
  assert.deepEqual(restored.state.combat.units.find(u => u.id === rider.id)!.attack, rider.attack);
  const next = new Combat(restored.state.combat, restored, () => []);
  const before = encodeEconomy(restored); next.update(0); assert.equal(encodeEconomy(restored), before);
  assert.equal(next.move([rider.id], { x: OUTPOST.x + 10, z: OUTPOST.z }), 1);
  assert(!next.unit(rider.id)!.attack); assert(next.unit(rider.id)!.cooldown > 0);
});
