import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { Combat, fighterRadius, fighterDestination } from '../src/game/combat.ts';
import { COMBAT_CONFIG } from '../src/game/combat-config.ts';
import { buildingAt } from '../src/game/construction.ts';
import { newTower, TOWER_CONFIG } from '../src/game/towers.ts';
import { isBlocked } from '../src/game/movement.ts';
import type { Obstacle } from '../src/game/movement.ts';
import { newWolf } from '../src/game/raid-state.ts';

function duel(enemy = 'enemy-guard') {
  const e = new Economy(), walls: Obstacle[] = [], c = new Combat(e.state.combat, e, () => walls);
  for (const u of c.state.units) if (!['archer', enemy].includes(u.id)) { u.life = 'defeated'; u.hp = 0; u.diedAt = 0; }
  const a = c.unit('archer')!, b = c.unit(enemy)!;
  a.position = { x: -14, z: -20 }; b.position = { x: 0, z: -20 };
  const step = () => { e.state.seconds += .05; c.update(.05); };
  return { e, c, a, b, walls, step };
}

test('shared attack route ends at the moving target; reservations use approach and attacks stop within range', () => {
  const { c, a, b, step } = duel(); c.attack([a.id], b.id);
  let travelled = 0;
  for (let i = 0; i < 200 && !a.attack; i++) {
    b.order = 'move'; b.goal = { x: 40, z: -20 }; b.route = [{ ...b.goal }];
    const before = { ...a.position }; step();
    travelled += Math.hypot(a.position.x - before.x, a.position.z - before.z);
    if (a.route.length) {
      assert.deepEqual(a.route.at(-1), b.position);
      assert.notDeepEqual(fighterDestination(a), b.position, 'do not reserve the occupied target');
    }
    assert(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) >= fighterRadius(a) + fighterRadius(b));
  }
  assert(a.attack); assert(travelled > 7);
  assert(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= COMBAT_CONFIG.archer.range);
  assert.equal(a.speed, 0);
});

test('a shootable tower occupant does not require a path to its feet', () => {
  const { e, a, b, walls, step } = duel('enemy-archer');
  const site = buildingAt('tower', { x: 0, z: -20 }, 'site-0');
  e.state.sites.push(site); e.state.buildings.push(site.id); e.state.nextSiteId = 1;
  const tower = newTower(site); tower.unit = a.id; tower.phase = 'occupied'; e.state.towers.push(tower);
  a.position = { x: site.x, z: site.z }; b.position = { x: site.x - 14, z: site.z };
  walls.push({ kind: 'box', x: site.x, z: site.z, halfWidth: site.width / 2, halfDepth: site.depth / 2 });
  b.order = 'attack'; b.target = a.id;
  for (let i = 0; i < 200 && !b.attack; i++) {
    a.order = 'move'; a.cooldown = 8; step();
    assert(!isBlocked(b.position, fighterRadius(b) - .001, walls));
    if (b.route.length) assert.deepEqual(b.route.at(-1), a.position);
  }
  assert(b.attack, 'a legal shooting position is enough');
});

for (const enemy of ['enemy-guard', 'enemy-archer']) test(`${enemy} retaliates against a tower shot outside alert range`, () => {
  const { e, c, a, b, walls, step } = duel(enemy);
  const site = buildingAt('tower', { x: 0, z: -20 }, 'site-0');
  e.state.sites.push(site); e.state.buildings.push(site.id); e.state.nextSiteId = 1;
  const tower = newTower(site); tower.unit = a.id; tower.phase = 'occupied'; e.state.towers.push(tower);
  a.position = { x: site.x, z: site.z }; b.position = { x: site.x + 11, z: site.z };
  walls.push({ kind: 'box', x: site.x, z: site.z, halfWidth: site.width / 2, halfDepth: site.depth / 2 });
  b.order = 'hold'; b.goal = { ...b.home };
  c.hurt(b.id, 1, a.id);
  assert.equal(b.target, enemy === 'enemy-guard' ? tower.id : a.id);
  assert.equal(b.goal, undefined); assert(b.provoked);
  const anchor = { ...b.provoked.from }, hp = a.hp;
  for (let i = 0; i < 180 && tower.hp === TOWER_CONFIG.hp && a.hp === hp; i++) {
    a.order = 'move'; a.cooldown = 8; step();
  }
  assert(tower.hp < TOWER_CONFIG.hp || a.hp < hp, 'retaliation must actually land');
  c.hurt(b.id, 1, a.id); assert.deepEqual(b.provoked?.from, anchor, 'repeated hits cannot drag the pursuit anchor');
  assert.doesNotThrow(() => decodeEconomy(encodeEconomy(e)));
});

test('damage does not cancel a player move, and a provoked guard still has a bounded pursuit', () => {
  const { c, a, b, step } = duel();
  c.move([a.id], { x: -20, z: -20 }); c.hurt(a.id, 1, b.id);
  assert.equal(a.order, 'move'); assert.equal(a.target, undefined);
  c.hurt(b.id, 1, a.id); assert.equal(b.target, a.id);
  a.position.x = b.provoked!.from.x - b.provoked!.leash - 2;
  step(); assert.equal(b.order, 'hold'); assert.deepEqual(b.goal, b.home);
});

test('a wolf attacking a civilian responds to a tower shot beyond passive alert', () => {
  const { e, c, a } = duel();
  const site = buildingAt('tower', { x: 0, z: -20 }, 'site-0');
  e.state.sites.push(site); e.state.buildings.push(site.id);
  const tower = newTower(site); tower.unit = a.id; tower.phase = 'occupied'; e.state.towers.push(tower);
  a.position = { x: site.x, z: site.z };
  const wolf = newWolf('wolf-1-0', { x: site.x + 12, z: site.z });
  wolf.target = 'farmer'; c.setThreats([wolf]); c.hurt(wolf.id, 1, a.id);
  assert.equal(wolf.target, tower.id); assert(wolf.provoked);
});

test('the target anchor does not replace the physical stop used for melee prediction', () => {
  const { c, a: archer, b, step } = duel();
  archer.position = { x: 3.28, z: -20 };
  b.position = { x: 1.5, z: -20 }; b.order = 'attack'; b.target = archer.id;
  b.attackApproach = { x: 2, z: -20 }; b.route = [b.attackApproach, { ...archer.position }];
  const striker = c.unit('infantry')!;
  striker.life = 'active'; striker.hp = COMBAT_CONFIG.infantry.hp; striker.diedAt = undefined;
  striker.position = { x: 0, z: -20 };
  c.attack([striker.id], b.id); step();
  assert(striker.attack, 'the victim will stop within committed melee reach, before the target anchor');
});
