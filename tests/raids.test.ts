import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, initialEconomy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { Combat } from '../src/game/combat.ts';
import { Raids } from '../src/game/raids.ts';
import { newWolf, RAID_CONFIG, initialRaids } from '../src/game/raid-state.ts';
import { RESIDENTS } from '../src/game/resident-data.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { isBlocked } from '../src/game/movement.ts';
import type { Point, Obstacle } from '../src/game/movement.ts';
import { createRouteState } from '../src/game/route-following.ts';
import { newCampfire } from '../src/game/campfire.ts';
import { buildingAt } from '../src/game/construction.ts';

function setup(e = new Economy(initialEconomy()), solids: readonly Obstacle[] = [], visible = false) {
  e.setLeadership(false);
  const positions = Object.fromEntries(RESIDENTS.map((r, i) => [r.id, { x: 40 + i * 2, z: -40 }]));
  const moving = new Set<string>(), released: string[] = [], commands: { id: string; point: Point }[] = [];
  const c = new Combat(e.state.combat, e, () => solids);
  for (const u of c.state.units) { u.order = 'hold'; if (u.team === 'home') u.position = { x: 35, z: -40 }; }
  const r = new Raids(e, c, { status: id => ({ position: positions[id], moving: moving.has(id) }),
    command: (p, id) => { commands.push({ id, point: p }); moving.add(id); return true; },
    release: id => { released.push(id); moving.delete(id); }, resting: () => {}, neighbours: () => [],
  }, () => solids, () => visible);
  const advance = (seconds: number, checks = () => {}) => {
    for (let i = 0; i < Math.ceil(seconds / .05); i++) { e.state.seconds += .05; r.update(.05); c.update(.05); checks(); }
  };
  const wave = (spots: Point[]) => {
    Object.assign(e.state.raids, { phase: 'raid', wave: 1, origin: spots[0], startedAt: e.state.seconds,
      wolves: spots.map((p, i) => newWolf(`wolf-1-${i}`, p)) });
    c.setThreats(e.state.raids.wolves);
    return e.state.raids.wolves;
  };
  return { e, c, r, positions, moving, released, commands, wave, advance };
}

test('raid protection, hidden connected spawns, bounded pack and saved random schedule', () => {
  const e = new Economy(initialEconomy(184)), solids = economyObstacles([], [], []), s = setup(e, solids);
  e.state.seconds = RAID_CONFIG.protection - 1; s.r.update(.05); assert.equal(s.r.state.phase, 'peace');
  e.state.seconds = RAID_CONFIG.protection; s.r.update(.05);
  for (let i = 0; s.r.state.phase === 'peace' && i < 10; i++) { e.state.seconds = s.r.state.nextAt; s.r.update(.05); }
  assert.equal(s.r.state.wolves.length, 2); assert.equal(s.r.state.wave, 1);
  for (const w of s.r.state.wolves) { assert(!isBlocked(w.position, .72, solids)); assert(w.route.length); }
  const restored = decodeEconomy(encodeEconomy(e));
  assert.equal(restored.state.raids.seed, e.state.raids.seed); assert.equal(restored.state.raids.wave, 1);
  assert.deepEqual(restored.state.raids.wolves.map(w => [w.hp, w.position]), e.state.raids.wolves.map(w => [w.hp, w.position]));
  const seen = setup(new Economy(initialEconomy()), [], true); seen.e.state.seconds = 240; seen.r.update(.05);
  assert.equal(seen.r.state.phase, 'peace'); assert(seen.r.state.nextAt > 240);
  const weak = setup(); weak.c.unit('archer')!.hp = 0; weak.c.unit('cavalry')!.hp = 0; weak.e.state.seconds = 240; weak.r.update(.05);
  assert.equal(weak.r.state.nextAt, 248); assert.equal(weak.r.state.pendingCount, 1);
});

test('bite has windup, exactly one contact per attack, stable target and persisted cooldown', () => {
  const s = setup(), [w] = s.wave([{ x: 0, z: 0 }]);
  s.positions.farmer = { x: 0, z: 1.5 }; s.e.state.vitals.farmer.manualUntil = 100;
  s.advance(.05); assert(w.attack); const serial = w.attack.id;
  s.advance(.15); assert.equal(s.e.state.vitals.farmer.hp, 100);
  s.advance(.1); assert.equal(s.e.state.vitals.farmer.hp, 92); assert(w.attack?.released);
  const e = decodeEconomy(encodeEconomy(s.e)), restored = setup(e); restored.positions.farmer = s.positions.farmer;
  restored.advance(.5); assert.equal(e.state.vitals.farmer.hp, 92); assert.equal(e.state.raids.wolves[0].attack, undefined);
  assert(e.state.raids.wolves[0].cooldown > 0); assert.equal(w.attack?.id, serial);
  s.advance(.55); assert.equal(s.e.state.vitals.farmer.hp, 92);
});

test('wolf path respects cover and crowd, and cannot bite through a wall', () => {
  const wall: Obstacle = { kind: 'box', x: 0, z: .7, halfWidth: 4, halfDepth: .1 };
  const s = setup(undefined, [wall]), wolves = s.wave([{ x: -1.5, z: -2 }, { x: 1.5, z: -2 }]);
  s.positions.farmer = { x: 0, z: 2 }; s.e.state.vitals.farmer.manualUntil = 100;
  wolves.forEach(w => { w.target = 'farmer'; w.mode = 'hunt'; });
  s.advance(8, () => {
    for (const w of wolves) assert(!isBlocked(w.position, .72, [wall]));
    assert(Math.hypot(wolves[0].position.x - wolves[1].position.x, wolves[0].position.z - wolves[1].position.z) >= 1.43);
  });
  assert(s.e.state.vitals.farmer.hp! < 100, 'wolves approach around cover and land a bite');
});

test('idle defenders aid neighbours; moving soldiers and manual civilian orders retain priority', () => {
  const s = setup(), [w] = s.wave([{ x: 0, z: 0 }]); s.positions.farmer = { x: 0, z: 3 };
  const soldier = s.c.unit('infantry')!; soldier.position = { x: 5, z: 0 }; soldier.order = 'guard';
  s.r.update(.05); assert.equal(soldier.target, w.id); assert(soldier.defendFrom); assert(s.released.includes('farmer')); assert(s.commands.some(c => c.id === 'farmer'));
  assert(s.c.move(['infantry'], { x: 15, z: 0 })); s.advance(.5); assert.equal(soldier.order, 'move'); assert(!soldier.target);
  s.r.manual('farmer'); s.e.state.vitals.farmer.manualUntil = s.e.state.seconds + 8;
  const count = s.released.length; s.advance(.5); assert.equal(s.released.length, count);
  assert(!s.r.state.evading.farmer);
});

test('village dog keeps evasion, health and stamina across save and manual override', () => {
  const s = setup(); s.wave([{ x: 0, z: 0 }]); s.positions.dog = { x: 0, z: 3 };
  s.e.state.vitals.dog.hp = 55; s.e.state.vitals.dog.stamina = 42;
  s.r.update(.05); assert(s.r.state.evading.dog); assert(s.commands.some(c => c.id === 'dog'));
  const restored = decodeEconomy(encodeEconomy(s.e));
  assert(restored.state.raids.evading.dog);
  assert.equal(restored.state.vitals.dog.hp, 55); assert.equal(restored.state.vitals.dog.stamina, 42);
  s.r.manual('dog'); assert(!s.r.state.evading.dog);
});

test('burning fire causes retreat; an empty enabled fire does not; theft takes one completed meal', () => {
  const s = setup(), site = buildingAt('campfire', { x: 0, z: 0 }, 'site-0');
  s.e.state.sites.push(site); s.e.state.buildings.push(site.id); s.e.state.campfires.push(newCampfire(site.id));
  const fire = s.e.state.campfires[0]; fire.enabled = true;
  const [w] = s.wave([{ x: site.x + 3, z: site.z }]);
  s.advance(2); assert.notEqual(w.mode, 'flee'); assert.equal(w.fear, 0);
  w.position = { x: site.x + 3, z: site.z }; w.route = []; fire.fuel = 15;
  s.advance(3.1); assert(['flee', 'gone'].includes(w.mode));
  const t = setup(); const [thief] = t.wave([{ x: site.x + 2.2, z: site.z }]);
  t.e.state.sites.push(site); t.e.state.buildings.push(site.id); t.e.state.campfires.push({ ...newCampfire(site.id), meals: 2, food: 4, wood: 3 });
  const stock = { ...t.e.state.inventory }; t.advance(1.3);
  assert.equal(thief.carried, 1); assert.equal(t.e.state.campfires[0].meals, 1); assert.equal(t.e.state.campfires[0].food, 4);
  assert.deepEqual(t.e.state.inventory, stock); t.advance(2); assert.equal(t.e.state.campfires[0].meals, 1);
});

test('defeated wolves settle ground loot once, including stolen meal, across reload', () => {
  const s = setup(), [w] = s.wave([{ x: 0, z: 0 }]); w.carried = 1; w.hp = 0; w.life = 'defeated';
  const stock = { ...s.e.state.inventory }; s.advance(.1);
  assert.equal(s.e.state.goods.length, 1); assert.equal(s.e.state.goods[0].amount, 3); assert.equal(s.e.state.goods[0].state, 'ground'); assert.deepEqual(s.e.state.inventory, stock);
  const e = decodeEconomy(encodeEconomy(s.e)), next = setup(e); next.advance(1);
  assert.equal(e.state.goods.length, 1); assert.equal(e.state.raids.nextAt, s.e.state.raids.nextAt);
  assert.equal(e.state.raids.wolves[0].settled, true);
});

test('wounded wolves withdraw through actual terrain and timeouts do not teleport them', () => {
  const e = new Economy(initialEconomy()), solids = economyObstacles([], [], []), s = setup(e, solids);
  e.state.seconds = 240;
  for (let i = 0; i < 10 && s.r.state.phase === 'peace'; i++) { e.state.seconds = s.r.state.nextAt; s.r.update(.05); }
  assert.equal(s.r.state.phase, 'raid');
  s.advance(12, () => { for (const w of s.r.state.wolves) assert(!isBlocked(w.position, .72, solids)); });
  const before = s.r.state.wolves.map(w => ({ ...w.position }));
  s.r.state.wolves.forEach(w => w.hp = 15); s.advance(.05);
  s.r.state.wolves.forEach((w, i) => { assert(['flee', 'gone'].includes(w.mode)); assert(Math.hypot(w.position.x - before[i].x, w.position.z - before[i].z) <= .166); });
  s.advance(60, () => { for (const w of s.r.state.wolves) assert(!isBlocked(w.position, .72, solids)); });
  assert.equal(s.r.state.phase, 'peace');
});

test('old saves and corrupted raid/projectile state are rejected; current saves round-trip', () => {
  const e = new Economy(initialEconomy()); e.state.seconds = 312; e.state.combat.units[0].hp = 47;
  const old: any = structuredClone(e.state); old.version = 9; delete old.raids;
  assert.throws(() => decodeEconomy(JSON.stringify(old)), /不支持的存档版本/);
  const current = decodeEconomy(encodeEconomy(e)); assert.equal(current.state.combat.units[0].hp, 47); assert.deepEqual(current.state.inventory, old.inventory);
  const s = setup(); const [w] = s.wave([{ x: 0, z: 0 }]); const bad = JSON.parse(encodeEconomy(s.e)); bad.raids.wolves[0].hp = 999;
  assert.throws(() => decodeEconomy(JSON.stringify(bad)));
  const shot = { id: s.c.state.nextAttack++, source: 'archer', target: w.id, from: { x: 0, z: 2 }, to: w.position, elapsed: 0, duration: .2, damage: 18 };
  s.c.state.projectiles.push(shot); const reloaded = decodeEconomy(encodeEconomy(s.e)); assert.equal(reloaded.state.combat.projectiles[0].target, w.id);
  s.r.state.wolves[0].mode = 'gone'; s.r.state.phase = 'peace'; s.r.state.wolves[0].navigation = createRouteState();
  assert.doesNotThrow(() => decodeEconomy(encodeEconomy(s.e)));
  assert.equal(initialRaids(12, 3).nextAt, 72);
});

test('automatic assistance keeps one pursuit origin for the whole wave', () => {
  const s = setup(), [w] = s.wave([{ x: 0, z: 0 }]);
  const a = s.c.unit('infantry')!; a.position = { x: 0, z: 5 }; a.order = 'guard';
  assert(s.c.assist(a.id, w.id));
  a.position = { x: 11, z: 5 }; w.position = { x: 18, z: 5 }; s.positions.farmer = { x: 14, z: 8 };
  s.advance(.5); assert(!a.target); assert.deepEqual(a.defendFrom, { x: 0, z: 5 });
  assert.equal(s.c.assist(a.id, w.id), false, 'repeat aid cannot move the pursuit origin');
  assert(s.c.move([a.id], { x: 15, z: 8 })); assert.equal(a.defendFrom, undefined);
});

test('different seeds produce legal packs capped at six; unavailable borders defer', () => {
  const solids = economyObstacles([], [], []), origins = new Set<string>();
  for (const seed of [3, 1069, 99127, 184]) {
    const e = new Economy(initialEconomy(seed)); e.state.upgrades.arms = 3; e.state.raids.wave = 2;
    const s = setup(e, solids); e.state.seconds = 240;
    for (let i = 0; i < 10 && s.r.state.phase === 'peace'; i++) { e.state.seconds = s.r.state.nextAt; s.r.update(.05); }
    assert.equal(s.r.state.phase, 'raid'); assert.equal(s.r.state.wolves.length, 6);
    origins.add(JSON.stringify(s.r.state.origin));
    s.advance(5, () => { for (const w of s.r.state.wolves) assert(!isBlocked(w.position, .72, solids)); });
  }
  assert(origins.size > 1);
});

test('an archer shot reloads against the same wolf and applies damage once', () => {
  const s = setup(); const [w] = s.wave([{ x: 0, z: 0 }]);
  s.c.state.projectiles.push({ id: s.c.state.nextAttack++, source: 'archer', target: w.id, from: { x: 0, z: 2 }, to: { ...w.position }, elapsed: .1, duration: .2, damage: 18 });
  const e = decodeEconomy(encodeEconomy(s.e)), next = setup(e);
  next.advance(.1); assert.equal(e.state.raids.wolves[0].hp, 58); assert.equal(e.state.combat.projectiles.length, 0);
  const again = setup(decodeEconomy(encodeEconomy(e))); again.advance(.1); assert.equal(again.e.state.raids.wolves[0].hp, 58);
});

test('bite, theft, evasion and random timers freeze on nonpositive delta', () => {
  const s = setup(); const [w] = s.wave([{ x: 0, z: 0 }]);
  w.attack = { id: s.c.state.nextAttack++, target: 'farmer', elapsed: .2, released: false }; w.feeding = .7;
  const before = encodeEconomy(s.e); s.r.update(0); s.r.update(-1); s.c.update(0);
  assert.equal(encodeEconomy(s.e), before);
});

test('warning persists for eight active seconds, alternates soldier raids and settles loot once',()=>{
  const s=setup(),{e,c,r}=s;
  e.state.raids.wave=1;e.state.raids.nextAt=60;e.state.seconds=52;r.update(.05);
  assert(r.state.pendingOrigin);assert.equal(r.state.phase,'peace');assert.equal(r.state.nextAt,60);
  const warned=decodeEconomy(encodeEconomy(e));assert.deepEqual(warned.state.raids.pendingOrigin,r.state.pendingOrigin);
  const frozen=encodeEconomy(e);r.update(0);assert.equal(encodeEconomy(e),frozen);
  e.state.seconds=59.99;r.update(.05);assert.equal(r.state.soldiers.length,0);
  e.state.seconds=60;r.update(.05);assert.equal(r.state.wave,2);assert(r.state.soldiers.length>=2);
  assert.equal(r.state.wolves.length,0);
  const unit=c.unit(r.state.soldiers[0])!,before={...unit.position};c.update(.1);
  assert(Math.hypot(unit.position.x-before.x,unit.position.z-before.z)>0);
  assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
  for(const id of r.state.soldiers)c.hurt(id,1000,'infantry');
  const loot=structuredClone(e.state.goods);r.update(.05);assert.equal(r.state.phase,'peace');
  assert(r.state.nextAt>=105&&r.state.nextAt<=135);
  const restored=setup(decodeEconomy(encodeEconomy(e)));restored.advance(.1);assert.deepEqual(restored.e.state.goods,loot);
});
