import assert from 'node:assert/strict';
import test from 'node:test';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { LANDSCAPE, WORLD_BOUNDS, GRID_SIZE, gridPoint } from '../src/game/world-data.ts';
import { RESOURCE_NODES, economyObstacles, ECONOMY_CONFIG as E } from '../src/game/economy-config.ts';
import { ENCOUNTERS } from '../src/game/combat-config.ts';
import { Combat, fighterStats } from '../src/game/combat.ts';
import { WILD_WOLF_SPAWNS } from '../src/game/raid-state.ts';
import { ENEMIES, RESIDENTS } from '../src/game/resident-data.ts';
import { findPath } from '../src/game/pathfinding.ts';
import { isBlocked, sweepIsBlocked } from '../src/game/movement.ts';
import { insidePolygon } from '../src/game/polygon.ts';

function finish(e: Economy) {
  const task = e.claim()!; assert.ok(task); e.arrive(task.id); e.advance(E.workSeconds[task.kind]);
  return task;
}
function clearCamp(e: Economy, id: string) {
  for (const u of e.state.combat.units.filter(u => ENEMIES.find(r => r.id === u.id)?.camp === id)) { u.hp = 0; u.life = 'defeated'; }
  new Combat(e.state.combat, e, () => economyObstacles(e.state.depleted)).update(.05);
}

test('every clearing has a swept route for infantry and cavalry; authored woodland and water stay inaccessible', () => {
  const solids = economyObstacles([]), start = { x: -4, z: -4 };
  for (const radius of [.4, .6]) for (const region of LANDSCAPE.regions) {
    const route = findPath(start, region, radius, WORLD_BOUNDS, solids);
    assert.ok(route?.length, `${region.id} radius ${radius}`);
    let from = start;
    for (const to of route) { assert.equal(sweepIsBlocked(from, to, radius, solids), false); from = to; }
  }
  for (const actor of [...RESIDENTS,...ENEMIES]) assert.equal(isBlocked(actor.spawn, actor.bodyRadius, solids), false, actor.id);
  for(const wolf of WILD_WOLF_SPAWNS)assert.equal(isBlocked(wolf,.4,solids),false);
  let solid = 0, sampled = 0;
  for (let x = WORLD_BOUNDS.minX + 1; x < WORLD_BOUNDS.maxX; x += 3) for (let z = WORLD_BOUNDS.minZ + 1; z < WORLD_BOUNDS.maxZ; z += 3) {
    sampled++; if (!LANDSCAPE.contains({ x, z })) solid++;
  }
  assert.ok(solid / sampled > .45 && solid / sampled < .7);
  assert.equal(findPath(start, { x: 0, z: 30 }, .4, WORLD_BOUNDS, solids), undefined);
});

test('passages and uncleared camps allow construction while physical wildland and guarded gathering remain restricted', () => {
  const e = new Economy(); e.setLeadership(false);
  e.state.inventory = { wood: 200, stone: 200, food: 0, iron: 0 };
  assert.ok(e.placeBuilding('house', { x: -28, z: 0 }).ok);
  assert.match(e.placeBuilding('house', { x: 0, z: 30 }).message, /地面/);
  const mine = LANDSCAPE.regions.find(r => r.id === 'quarry')!;
  const placed = e.placeBuilding('campfire', { x: mine.x + 5, z: mine.z });
  assert.ok(placed.ok, placed.message);
  clearCamp(e, 'quarry');
  assert.equal(e.regionLocked(mine), '');
  assert.match(e.regionLocked(LANDSCAPE.regions.find(r => r.id === 'pass')!), /守卫/);
  assert.equal(e.state.goods.length, 3); assert.equal(e.state.inventory.wood, 200);
});

test('iron requires cleared mine, physical hauling and reserved processing; upgrades settle once', () => {
  const e = new Economy(); e.setLeadership(false); e.state.inventory.iron = 0;
  const mine = LANDSCAPE.regions.find(r => r.id === 'quarry')!;
  const node = RESOURCE_NODES.find(n => n.kind === 'iron' && insidePolygon(n, mine.area))!;
  assert.equal(e.request('mine', node.id).ok, false);
  clearCamp(e, 'quarry');
  e.request('mine', node.id); const mining = finish(e);
  assert.equal(mining.kind, 'mine'); assert.equal(e.state.inventory.iron, 0);
  const haul = e.active()!; assert.equal(haul.kind, 'haul');
  e.arrive(haul.id); assert.equal(e.state.inventory.iron, 0); e.arrive(haul.id);
  assert.equal(e.state.inventory.iron, 6);
  e.state.inventory.iron = 20;
  const task = e.request('tools', 'warehouse').task!;
  assert.equal(task.reserved, true); assert.equal(e.available().iron, 12);
  assert.equal(e.request('arms', 'warehouse').ok, false);
  e.assign(task.id); e.arrive(task.id); e.advance(3);
  const resumed = decodeEconomy(encodeEconomy(e));
  resumed.assign(task.id); resumed.arrive(task.id); resumed.advance(9);
  assert.deepEqual(resumed.state.upgrades, { tools: 1, arms: 0 });
  assert.equal(resumed.state.inventory.iron, 12); assert.equal(resumed.state.inventory.wood, 4);
  resumed.arrive(task.id); resumed.advance(1); assert.equal(resumed.state.upgrades.tools, 1);
  const next = resumed.request('arms', 'warehouse').task!;
  assert.equal(next.reserved, false, 'wood is also required to process iron');
  resumed.cancel(next.id); assert.equal(resumed.state.inventory.iron, 12);
});

test('tools accelerate production, equipment changes actual damage, and heavy guards differ in speed and armor', () => {
  const e = new Economy(); e.state.upgrades.tools = 1;
  e.request('chop', 'tree-0'); const t = e.claim()!; e.arrive(t.id); e.advance(4); assert.equal(t.status, 'done');
  const damage = (level: number) => {
    const e = new Economy(); e.state.upgrades.arms = level;
    const a = e.state.combat.units.find(u => u.id === 'infantry')!, b = e.state.combat.units.find(u => u.id === 'enemy-guard')!;
    a.position = { ...b.position, x: b.position.x + 1.5 }; b.order = 'hold';
    const c = new Combat(e.state.combat, e, () => []); c.attack([a.id], b.id); c.update(.05); c.update(fighterStats(a).windup + .01); return fighterStats(b).hp - b.hp;
  };
  assert(Math.abs(damage(1) - damage(0) - 30/11) < 1e-8);
  const heavy = fighterStats({ id: 'enemy-pass-0', role: 'infantry', team: 'enemy' });
  const normal = fighterStats({ id: 'enemy-guard', role: 'infantry', team: 'enemy' });
  assert.ok(heavy.speed < normal.speed && heavy.armor > normal.armor);
});

test('forage remains finite until active-time regrowth; reload, pause and occupied sites preserve it', () => {
  const e = new Economy(); e.setLeadership(false); e.state.inventory.food = 0;
  e.request('gather', 'forage-0'); finish(e);
  assert.equal(e.state.inventory.food, 0); assert.equal(e.state.goods[0].amount, 6);
  const restored = decodeEconomy(encodeEconomy(e));
  const at = restored.state.regrowth['forage-0']; restored.advance(0);
  assert.equal(restored.state.regrowth['forage-0'], at);
  const node = RESOURCE_NODES.find(n => n.id === 'forage-0')!;
  restored.setOccupancy(() => [node]); restored.advance(90); assert.ok(restored.state.depleted.includes(node.id));
  restored.setOccupancy(() => []); restored.advance(10); assert.ok(!restored.state.depleted.includes(node.id));
  assert.equal(restored.state.goods.length, 1, 'renewal alone produces no goods');
  assert.equal(restored.request('gather', node.id).ok, true);
});

test('captured regions stay clear; patrol renewal waits for distance and yields one reward per cycle', () => {
  const e = new Economy(); e.setLeadership(false); const c = new Combat(e.state.combat, e, () => economyObstacles([]));
  clearCamp(e, 'quarry'); clearCamp(e, 'patrol');
  const config = ENCOUNTERS.find(c => c.id === 'patrol')!, unit = c.unit('infantry')!;
  unit.position = { x: config.x, z: config.z };
  e.state.seconds += 300; c.update(.05); assert.equal(c.state.camps.find(c => c.id === 'patrol')!.cycle, 0);
  unit.position = { x: 0, z: 0 }; c.update(.05);
  assert.equal(c.state.camps.find(c => c.id === 'patrol')!.cycle, 1);
  assert.equal(c.state.camps.find(c => c.id === 'quarry')!.cleared, true);
  const afterRespawn = decodeEconomy(encodeEconomy(e)); clearCamp(afterRespawn, 'patrol');
  const count = afterRespawn.state.goods.length;
  const again = decodeEconomy(encodeEconomy(afterRespawn));
  new Combat(again.state.combat, again, () => []).update(.2);
  assert.equal(again.state.goods.length, count);
});

test('patrols visit both ends of the actual forest passage without crossing solids', () => {
  const e = new Economy(); e.setLeadership(false);
  const solids = economyObstacles([]), c = new Combat(e.state.combat, e, () => solids);
  const visited = new Set<number>(), route = ENCOUNTERS.find(c => c.id === 'patrol')!.patrol;
  for (let step = 0; step < 300; step++) {
    e.advance(.2); c.update(.2);
    for (const u of c.state.units.filter(u => u.id.startsWith('enemy-patrol-'))) {
      assert.equal(isBlocked(u.position, .4, solids), false);
      route.forEach((p, i) => { if (Math.hypot(p.x - u.position.x, p.z - u.position.z) < 1.8) visited.add(i); });
    }
  }
  assert.deepEqual(visited, new Set([0, 1]));
});

test('renewable resources never grow through completed buildings', () => {
  const e = new Economy(); e.setLeadership(false);
  e.state.inventory = { wood: 12, stone: 8, food: 0, iron: 0 };
  const node = RESOURCE_NODES.find(n => n.id === 'tree-0')!;
  e.state.depleted.push(node.id); e.state.regrowth[node.id] = 1;
  e.state.sites.push({ ...node, id: 'site-0', kind: 'campfire', width: 2 * GRID_SIZE, depth: 2 * GRID_SIZE, height: 1.2 });
  e.advance(20); assert.ok(e.state.depleted.includes(node.id));
  assert.equal(e.placeBuilding('house', gridPoint(44, 56)).ok, true);
});
