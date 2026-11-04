import test from 'node:test';
import { buildingAt } from '../src/game/construction.ts';
import assert from 'node:assert/strict';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { gridPoint, GRID_SIZE } from '../src/game/world-data.ts';
import { CAMPFIRE_CONFIG as F, newCampfire, advanceCampfire, fireAppearance } from '../src/game/campfire.ts';
import { VITAL_CONFIG as V, vitalIds, health, maxHealth, eat } from '../src/game/vitals.ts';
import { createNeedsController } from '../src/game/needs-controller.ts';
import { Combat } from '../src/game/combat.ts';
import { RESIDENTS, ENEMIES } from '../src/game/resident-data.ts';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { createPalette } from '../src/game/models.ts';
import { createCampfireView } from '../src/game/campfire-view.ts';
import { CAMPFIRE_SHAPE } from '../src/game/campfire-shape.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { isBlocked } from '../src/game/movement.ts';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { updateDangerZones, pathInDanger } from '../src/game/danger-zones.ts';

function built() {
  const e = new Economy(); e.setLeadership(false); e.state.inventory = { wood: 30, food: 30, stone: 20, iron: 0 };
  const result = e.placeBuilding('campfire', gridPoint(44, 56)); assert(result.ok, result.message);
  const t = e.claim()!; e.arrive(t.id); e.advance(8);
  assert.equal(e.state.inventory.stone, 20 - F.cost.stone); assert.equal(e.state.inventory.wood, 30);
  return { e, f: e.campfire(t.target)!, site: e.state.sites[0] };
}
function needsHarness(e: Economy) {
  const c = new Combat(e.state.combat, e, () => []);
  for (const u of c.state.units) if (!u.goal) u.order = 'hold';
  const states = Object.fromEntries([...RESIDENTS, ...ENEMIES].map(r => [r.id, { position: { ...r.spawn }, speed: 0, moving: false, working: false, goal: undefined as { x: number; z: number } | undefined }]));
  const residents = {
    needsStatus: (id: string) => states[id], setResting() {}, releaseFarmerWork() {},
    command(point: { x: number; z: number }, id?: string) { if (!id) return false; states[id].position = { ...point }; states[id].goal = point; return true; },
  };
  const n = createNeedsController(e, residents, c);
  const advance = (seconds: number) => { for (let left = seconds; left > 1e-8; left -= .1) { const dt = Math.min(left, .1); e.advance(dt); c.update(dt); n.update(dt); } };
  return { c, n, states, advance };
}
test('fire is built with stone; off never consumes fuel or food, toggling preserves partial fuel/cooking', () => {
  const { e, f } = built(); Object.assign(f, { wood: 6, food: 4 });
  e.advance(20); assert.equal(f.wood, 6); assert.equal(f.food, 4); assert.equal(e.state.tasks.filter(t => t.kind === 'supply').length, 0);
  e.setFire(f.id, true); advanceCampfire(f, 2, 1); assert.equal(f.wood, 5); assert.equal(f.food, 3); assert.equal(f.cook, 2);
  assert.equal(fireAppearance(f), 'cooking'); e.setFire(f.id, false); const before = structuredClone(f);
  advanceCampfire(f, 60, 4); assert.deepEqual(f, before); assert.equal(fireAppearance(f), 'off');
  e.setFire(f.id, true); e.setCooking(f.id, false); advanceCampfire(f, 3, 1); assert.equal(f.cook, 2); assert.equal(f.fuel, 25); assert.equal(fireAppearance(f), 'lit');
  e.setCooking(f.id, true); advanceCampfire(f, 2, 1); assert.equal(f.meals, 1); assert.equal(f.food, 3);
});
test('cooking is independent of frame subdivisions and waits for actual diner demand', () => {
  const a = { ...newCampfire('a'), enabled: true, wood: 6, food: 4 }, b = structuredClone(a);
  advanceCampfire(a, 18, 4); for (let i = 0; i < 180; i++) advanceCampfire(b, .1, 4);
  assert.equal(a.meals, 4); assert.equal(a.food, 0); assert.equal(b.meals, 4); assert(Math.abs(a.fuel - b.fuel) < 1e-8);
  const c = { ...newCampfire('c'), enabled: true, wood: 2, food: 4 }; advanceCampfire(c, 40, 0);
  assert.equal(c.food, 4); assert.equal(c.meals, 0); assert.equal(c.wood, 0);
});
test('supply reserves then physically picks up and deposits one batch; interrupted/reloaded cargo is never charged twice', () => {
  const { e, f } = built(); e.setFire(f.id, true); e.advance(.1);
  const task = e.claim()!; assert.equal(task.kind, 'supply'); assert.equal(task.amount, F.batch.wood);
  assert.equal(e.state.inventory.wood, 30); assert.equal(f.wood, 0); assert.equal(e.reserved().wood, F.batch.wood);
  e.arrive(task.id); assert.equal(e.state.inventory.wood, 24); assert.equal(f.wood, 0); assert.equal(e.state.goods[0].destination, f.id);
  e.interrupt({ x: -4, z: -2 }); assert.equal(e.state.goods[0].state, 'ground');
  const restored = decodeEconomy(encodeEconomy(e)), cargo = restored.state.goods[0];
  assert.deepEqual({ x: cargo.x, z: cargo.z }, { x: -4, z: -2 });
  restored.assign(task.id, 'farmer-2'); restored.arrive(task.id); assert.equal(restored.state.inventory.wood, 24);
  const inTransit = decodeEconomy(encodeEconomy(restored)); inTransit.arrive(task.id); inTransit.arrive(task.id);
  assert.equal(inTransit.campfire(f.id)!.wood, 6); assert.equal(inTransit.state.inventory.wood, 24); assert.equal(inTransit.state.goods.length, 0);
  assert.doesNotThrow(() => decodeEconomy(encodeEconomy(inTransit)));
});
test('cancelled outbound cargo returns via normal hauling and obeys warehouse capacity', () => {
  const { e, f } = built(); e.setFire(f.id, true); e.advance(.1); const t = e.claim()!; e.arrive(t.id);
  e.cancel(t.id); const cargo = e.state.goods[0]; assert.equal(cargo.destination, undefined); assert.equal(cargo.state, 'ground');
  const haul = e.taskFor(cargo.id)!; assert.equal(haul.kind, 'haul');
  e.assign(haul.id); e.arrive(haul.id); e.state.inventory.wood = e.capacity().wood - 1; e.arrive(haul.id);
  assert.equal(cargo.amount, 5); assert.equal(e.state.inventory.wood, e.capacity().wood); assert.equal(f.wood, 0);
});
test('one paid food portion restores stamina faster than health, saving and pause preserve the remaining portion', () => {
  const { e } = built();
  for (const id of vitalIds) {
    const v = e.state.vitals[id]; v.stamina = 5; if (v.hp !== undefined) v.hp = 10;
    const fighter = e.state.combat.units.find(u => u.id === id); if (fighter) fighter.hp = 10;
    v.meal = { remaining: V.mealSeconds }; eat(e.state, id, 1);
    assert.equal(v.stamina, 12.5); assert.equal(health(e.state, id), 12);
  }
  const restored = decodeEconomy(encodeEconomy(e)), before = encodeEconomy(restored);
  for (const id of vitalIds) eat(restored.state, id, 0);
  assert.equal(encodeEconomy(restored), before);
  for (const id of vitalIds) { eat(restored.state, id, 8); assert.equal(restored.state.vitals[id].stamina, 50); assert.equal(health(restored.state, id), 22); assert.equal(restored.state.vitals[id].meal, undefined); }
});
test('all controlled bodies drain stamina; exhausted workers and rider/horse can still move and deliver supplies', () => {
  const { e } = built(), { states, advance, n } = needsHarness(e);
  assert.match(n.label(ENEMIES.find(r=>r.role==='cavalry')!.id), /^110\/110/);
  states.farmer.working = true; states.dog.speed = 1; states.cavalry.speed = 2;
  advance(5);
  assert(Math.abs(e.state.vitals.farmer.stamina - (100 - V.workDrain * 5)) < 1e-6);
  assert(e.state.vitals.dog.stamina < 100); assert.equal(e.state.vitals.horse.stamina, e.state.vitals.cavalry.stamina);
  for (const id of vitalIds) e.state.vitals[id].stamina = 0;
  advance(5);
  for(const id of vitalIds)assert.equal(e.state.vitals[id].stamina,0);
  assert(!e.state.vitals.farmer.rest,'working farmers keep their task at zero stamina');
});
test('dog, rider and horse consume distinct meals; manual orders interrupt rest without cancelling another unit', () => {
  const { e, f, site } = built(); Object.assign(f, { enabled: true, wood: 12, food: 12, meals: 3 });
  for (const id of ['dog', 'cavalry', 'horse']) e.state.vitals[id].stamina = 0;
  const { c, n, advance } = needsHarness(e); c.unit('cavalry')!.position = { x: site.x + 4, z: site.z - 4 };
  advance(3); assert.equal(f.meals, 0);
  for (const id of ['dog', 'cavalry', 'horse']) assert(e.state.vitals[id].stamina > 5);
  n.manual('dog'); assert.equal(e.state.vitals.dog.rest, undefined); assert(e.state.vitals.cavalry.rest);
  const stamina = e.state.vitals.dog.stamina; advance(1); assert(e.state.vitals.dog.stamina <= stamina);
  assert(e.state.vitals.horse.stamina > 10);
});
test('empty stamina never interrupts active farmer work, movement or a combat order for food',()=>{
  const {e,f,site}=built();Object.assign(f,{enabled:true,wood:12,food:12,meals:4});
  const {c,n,states}=needsHarness(e);
  for(const id of ['farmer','dog','infantry']){e.state.vitals[id].stamina=0;states[id].position={x:site.x,z:site.z-4};}
  states.farmer.working=true;states.dog.moving=true;
  const soldier=c.unit('infantry')!;soldier.position={x:site.x,z:site.z-4};soldier.target='enemy-guard';soldier.order='attack';
  n.update(.05);for(const id of ['farmer','dog','infantry'])assert(!e.state.vitals[id].rest,id);
  assert.equal(soldier.target,'enemy-guard');
  soldier.target=undefined;soldier.order='move';soldier.goal={x:site.x+8,z:site.z-4};
  n.update(.05);assert(!e.state.vitals.infantry.rest,'an active move goal survives an empty route');
  assert.deepEqual(soldier.goal,{x:site.x+8,z:site.z-4});
});
test('injured soldier walks to food and heals gradually, no fire means no automatic health or inventory changes', () => {
  const { e, f, site } = built(), { c, n, advance } = needsHarness(e); const u = c.unit('infantry')!;
  u.hp = 1; u.life = 'active'; u.position = { x: site.x + 4, z: site.z + 4 };
  advance(4); assert.equal(u.hp, 1); assert(!e.state.vitals[u.id].rest); assert.equal(e.state.inventory.food, 30);
  Object.assign(f, { enabled: true, wood: 10, food: 8, meals: 1 }); e.state.vitals[u.id].retryAt = 0; n.update(.01); assert(e.state.vitals[u.id].rest);
  advance(10); assert(u.hp > 0 && u.hp < maxHealth(u.id)); assert.equal(u.life, 'active');
  assert(!u.attack); assert(!u.target); assert(e.state.vitals[u.id].rest);
  const before = encodeEconomy(e); n.update(0); c.update(0); e.advance(0); assert.equal(encodeEconomy(e), before);
  assert.equal(c.move([u.id], { x: site.x + 10, z: site.z + 10 }, true), 1); assert(!e.state.vitals[u.id].rest);
});
test('strict saves reject invalid local stock, duplicated vitality health and orphaned deliveries', () => {
  const { e, f } = built();
  for (const corrupt of [(s: Economy['state']) => { s.campfires[0].wood = 13; }, (s: Economy['state']) => { s.vitals.infantry.hp = 140; }, (s: Economy['state']) => { s.vitals.horse.stamina = -1; }]) {
    const s = JSON.parse(encodeEconomy(e)); corrupt(s); assert.throws(() => decodeEconomy(JSON.stringify(s)));
  }
  e.setFire(f.id, true); e.advance(.1); e.arrive(e.claim()!.id); const s = JSON.parse(encodeEconomy(e)); s.tasks = [];
  assert.throws(() => decodeEconomy(JSON.stringify(s)));
});
test('fire render states follow stock and cooking; local light count remains capped', () => {
  const engine = new NullEngine(), scene = new Scene(engine), view = createCampfireView(scene, createPalette(scene));
  const fires = Array.from({ length: 5 }, (_, i) => { const f = { ...newCampfire(`fire-${i}`), enabled: true, wood: 3 }; view.add({ id: f.id, x: i * 8, z: 0 }); return f; });
  fires[0].enabled = false; fires[1].cook = 2; view.update(fires, .1, { x: 0, z: 0 });
  assert.equal(view.snapshot().lights, 2); assert.equal(view.snapshot().states[0].state, 'off'); assert.equal(view.snapshot().states[1].state, 'cooking');
  const before = view.snapshot(); view.update(fires, 0, { x: 0, z: 0 }); assert.deepEqual(view.snapshot(), before);
  view.remove('fire-1'); assert(!scene.getTransformNodeByName('fire-1:base')); scene.dispose(); engine.dispose();
});

test('built fire collision follows the actual stone circle, while construction reserves its grid footprint', () => {
  const { e, site } = built();
  const builtSolids = economyObstacles([], [site], [site.id]), construction = economyObstacles([], [site], []);
  for (const [offset, body] of [[1.45, .4], [1.85, 1.12]]) {
    const corner = { x: site.x + offset, z: site.z + offset };
    assert(!isBlocked(corner, body, builtSolids), 'empty corner is walkable');
    assert(isBlocked(corner, body, construction), 'unfinished grid site remains reserved');
    assert(isBlocked({ x: site.x + CAMPFIRE_SHAPE.radius + body - .01, z: site.z }, body, builtSolids));
  }
  assert.equal(e.placeBuilding('house', site).ok, false, 'construction cannot overlap the reserved cells');
  const engine = new NullEngine(), scene = new Scene(engine), view = createCampfireView(scene, createPalette(scene));
  view.add({ id: 'measure', x: 0, z: 0 });
  let outer = 0;
  for (const mesh of scene.meshes.filter(m => m.metadata?.worldObjectId === 'measure' && !m.metadata?.pickingProxy)) {
    const xyz = mesh.getVerticesData('position')!; mesh.computeWorldMatrix(true);
    for (let i = 0; i < xyz.length; i += 3) {
      const p = Vector3.TransformCoordinates(Vector3.FromArray(xyz, i), mesh.getWorldMatrix());
      outer = Math.max(outer, Math.hypot(p.x, p.z));
    }
  }
  assert(outer <= CAMPFIRE_SHAPE.radius && CAMPFIRE_SHAPE.radius - outer < .03, `rendered radius ${outer}`);
  scene.dispose(); engine.dispose();
});

test('an injured diner waits when every fire seat is occupied instead of eating at a distant fallback point', () => {
  const { e, f, site } = built(); Object.assign(f, { enabled: true, wood: 10, meals: 4 });
  const blockers = Array.from({ length: F.seats }, (_, i) => ({ id: `blocker-${i}`, position: {
    x: site.x + Math.cos((i + .5) * Math.PI * 2 / F.seats) * F.seatRadius,
    z: site.z + Math.sin((i + .5) * Math.PI * 2 / F.seats) * F.seatRadius,
  }, radius: .4, moving: false, purposeful: false, waiting: false }));
  const c = new Combat(e.state.combat, e, () => [], () => blockers), u = c.unit('infantry')!;
  Object.assign(u, { hp: 1, life: 'active', order: 'hold', position: { x: site.x + 6, z: site.z + 6 } });
  const n = createNeedsController(e, {
    needsStatus: () => ({ position: u.position, speed: 0, moving: false, working: false, goal: undefined }),
    setResting() {}, releaseFarmerWork() {}, command: () => false,
  }, c);
  n.update(.01); assert(!e.state.vitals[u.id].rest); assert.equal(u.order, 'hold'); assert.equal(u.goal, undefined); assert.equal(f.meals, 4);
});

test('automatic healing waits for recent damage and explicit commands, then resumes without an eating button', () => {
  const { e, f, site } = built(), { c, advance } = needsHarness(e), u = c.unit('infantry')!;
  Object.assign(f, { enabled: true, wood: 10, meals: 2 });
  Object.assign(u, { hp: 10, position: { x: site.x + 3, z: site.z + 3 } });
  e.state.vitals[u.id].hurtUntil = e.state.seconds + 3;
  e.state.vitals[u.id].manualUntil = e.state.seconds + 4;
  const before = { ...u.position }; advance(3);
  assert.deepEqual(u.position, before); assert(!e.state.vitals[u.id].rest); assert.equal(u.hp, 10);
  advance(4); assert(e.state.vitals[u.id].rest); assert(u.hp > 10);
});

test('fire seats fit the mounted horse and retain reachable approaches on the real map', async () => {
  const { economyObstacles } = await import('../src/game/economy-config.ts');
  const { planWorkApproach } = await import('../src/game/work-navigation.ts');
  const { WORLD_BOUNDS } = await import('../src/game/world-data.ts');
  const e = new Economy(); assert(e.placeBuilding('campfire', { x: -10, z: -10 }).ok); const site = e.state.sites[0];
  const seats = Array.from({ length: F.seats }, (_, i) => ({ x: site.x + Math.cos((i + .5) * Math.PI * 2 / F.seats) * F.seatRadius, z: site.z + Math.sin((i + .5) * Math.PI * 2 / F.seats) * F.seatRadius }));
  const path = planWorkApproach({ x: -3.5, z: -10 }, seats, 1.12, WORLD_BOUNDS, economyObstacles([], e.state.sites), []);
  assert(path, 'mounted rider must have a reachable feeding place'); assert(seats.some(s => Math.hypot(s.x - path.at(-1)!.x, s.z - path.at(-1)!.z) < .01));
});


test('automatic meals require low stamina or injury and an enabled reachable fire within 30 map cells', () => {
  const { e, f, site } = built(); Object.assign(f, { enabled: true, wood: 12, food: 12 });
  const { n, states } = needsHarness(e), v = e.state.vitals.farmer;
  states.farmer.position = { x: site.x + 30 * GRID_SIZE + .01, z: site.z }; v.stamina = 20;
  n.update(.01); assert(!v.rest, 'outside radius');
  states.farmer.position.x = site.x + 30 * GRID_SIZE; v.retryAt = 0; v.stamina = 30.01;
  n.update(.01); assert(!v.rest, '30 percent alone is not low enough');
  v.stamina = 29.9; n.update(.01); assert.equal(e.state.vitals.farmer.rest?.camp, f.id);
  n.manual('farmer'); v.manualUntil = v.retryAt = 0; e.setFire(f.id, false);
  n.update(.01); assert(!v.rest); assert.equal(f.enabled, false);
  e.setFire(f.id, true); v.retryAt = 0; v.stamina = 100; v.hp = 20;
  n.update(.01); assert(v.rest, 'injury alone launches automatic healing at full stamina');
});

test('every human can supply an empty fire and eat; animals never carry and reservations are shared', () => {
  for (const id of ['farmer', 'farmer-2', 'farmer-leader', 'infantry', 'archer', 'cavalry']) {
    const { e, f } = built(); e.setFire(f.id, true); e.state.vitals[id].stamina = 10;
    const { n, advance } = needsHarness(e); advance(70);
    assert(e.state.vitals[id].stamina >= 80, id + ' must have eaten after supplying');
    assert(e.state.tasks.some(t => t.kind === 'supply' && t.worker === id && t.status === 'done'), id + ' must carry');
    assert(e.state.inventory.wood < 30 && e.state.inventory.food < 30);
    assert.doesNotThrow(() => decodeEconomy(encodeEconomy(e)));
    const before = encodeEconomy(e); n.update(0); e.advance(0); assert.equal(encodeEconomy(e), before);
  }
  const { e, f } = built(); e.setFire(f.id, true);
  for (const id of ['farmer', 'farmer-2', 'infantry', 'dog']) e.state.vitals[id].stamina = 10;
  const { advance } = needsHarness(e); advance(.3);
  const tasks = e.state.tasks.filter(t => t.kind === 'supply');
  assert.equal(tasks.length, 1); assert.notEqual(tasks[0].worker, 'dog');
  assert.equal(tasks[0].origin, 'continuation', 'automatic meals must not promote supply to a player command');
  assert.equal(e.assign(tasks[0].id, 'dog').ok, false);
});

test('a soldier supply survives reload in transit and manual movement drops goods without a second charge', () => {
  const { e, f } = built(); e.setFire(f.id, true); e.state.vitals.infantry.stamina = 10;
  const { c, n, advance } = needsHarness(e);
  for (let i = 0; i < 200 && !e.state.goods.some(g => g.carrier === 'infantry'); i++) advance(.1);
  const task = e.active('infantry')!; assert.equal(task?.status, 'delivering');
  const paused = encodeEconomy(e); n.update(0); c.update(0); e.advance(0); assert.equal(encodeEconomy(e), paused);
  const stock = e.state.inventory.wood, restored = decodeEconomy(encodeEconomy(e));
  assert.equal(restored.active('infantry')?.status, 'delivering');
  const next = needsHarness(restored); next.advance(60);
  assert(restored.state.tasks.some(t => t.id === task.id && t.status === 'done'));
  assert(restored.state.vitals.infantry.stamina > 70);
  const u = c.unit('infantry')!; assert.equal(c.move([u.id], { x: -2, z: -10 }), 1); n.manual(u.id);
  assert.equal(e.state.goods[0].state, 'ground'); assert.equal(e.state.inventory.wood, stock);
  assert(!e.state.vitals.infantry.rest); assert.equal(u.order, 'move');
  const resumed = decodeEconomy(encodeEconomy(e));
  assert(resumed.assign(task.id, 'archer').ok); resumed.arrive(task.id); resumed.arrive(task.id);
  assert.equal(resumed.state.inventory.wood, stock); assert.equal(resumed.campfire(f.id)!.wood, F.batch.wood);
});

test('shortages retry without free food, switching off interrupts supply, and normal tasks remain available', () => {
  const { e, f } = built(); e.setFire(f.id, true); e.state.inventory.wood = e.state.inventory.food = 0;
  e.state.vitals.farmer.stamina = 10; const { n, advance } = needsHarness(e); advance(10);
  assert(e.state.vitals.farmer.stamina <= 10 && e.state.vitals.farmer.stamina > 9); assert(!e.active('farmer'));
  assert.match(n.label('farmer'), /等待仓库/);
  e.state.inventory.wood = e.state.inventory.food = 12; advance(20);
  assert(e.state.vitals.farmer.stamina > 10);
  e.setFire(f.id, false); advance(.1); assert(!e.state.vitals.farmer.rest);
  assert.equal(n.canTakeWork('farmer'), true);
  assert.doesNotThrow(() => decodeEconomy(encodeEconomy(e)));
});


test('blocked supply routes wait without charging inventory or retrying navigation every frame', () => {
  const { e, f } = built(); e.setFire(f.id, true); e.state.vitals.farmer.stamina = 10;
  let calls = 0, place = { x: -10, z: -10 };
  const c = new Combat(e.state.combat, e, () => []);
  const n = createNeedsController(e, {
    needsStatus: () => ({ position: place, speed: 0, moving: false, working: false, goal: undefined }),
    setResting() {}, releaseFarmerWork() {},
    command(point, id) { calls++; if (point.x > 0) return false; place = { ...point }; return id === 'farmer'; },
  }, c);
  n.update(.1); n.update(.1); const attempts = calls;
  for (let i = 0; i < 20; i++) n.update(.1);
  assert.equal(calls, attempts); assert.equal(e.state.inventory.wood, 30); assert.equal(e.state.goods.length, 0);
  assert.doesNotThrow(() => decodeEconomy(encodeEconomy(e)));
});

test('incoming fire interrupts automatic supply to retaliate, preserving paid cargo', () => {
  const { e, f } = built(); e.setFire(f.id, true); e.state.vitals.infantry.stamina = 10;
  const { c, advance } = needsHarness(e);
  for (let i = 0; i < 200 && !e.state.goods.some(g => g.carrier === 'infantry'); i++) advance(.1);
  const u = c.unit('infantry')!, enemy = c.unit('enemy-archer')!;
  enemy.position = { x: u.position.x + 3, z: u.position.z }; enemy.order = 'hold';
  const stock = e.state.inventory.wood;
  c.state.projectiles.push({ id: c.state.nextAttack++, source: enemy.id, target: u.id,
    from: { ...enemy.position }, to: { ...u.position }, elapsed: 0, duration: .01, damage: 10 });
  c.update(.05);
  assert.equal(u.target, enemy.id); assert(!e.state.vitals[u.id].rest);
  assert.equal(e.state.goods[0].state, 'ground'); assert.equal(e.state.inventory.wood, stock);
  assert.doesNotThrow(() => decodeEconomy(encodeEconomy(e)));
});

test('multiple fires reserve seats independently, prefer supplied seats and feed concurrently',()=>{
  const {e,f,site}=built(),second=buildingAt('campfire',{x:site.x+12,z:site.z},'site-1');
  e.state.sites.push(second);e.state.buildings.push(second.id);e.state.nextSiteId=2;
  const g=newCampfire(second.id);e.state.campfires.push(g);Object.assign(f,{enabled:true});Object.assign(g,{enabled:true,wood:6,food:8,meals:4});
  e.state.vitals.farmer.stamina=10;const h=needsHarness(e);h.states.farmer.position={x:site.x,z:site.z-4};
  h.n.update(.01);assert.equal(e.state.vitals.farmer.rest?.camp,g.id,'skip closer unsupplied fire');
  h.n.manual('farmer');e.state.vitals.farmer.manualUntil=0;e.state.vitals.farmer.retryAt=0;
  Object.assign(f,{wood:6,food:8,meals:4});h.states.farmer.position={x:site.x,z:site.z-4};h.states['farmer-2'].position={x:second.x,z:second.z-4};e.state.vitals['farmer-2'].stamina=10;
  h.n.update(.01);assert.equal(e.state.vitals.farmer.rest?.camp,f.id);assert.equal(e.state.vitals['farmer-2'].rest?.camp,g.id);
  h.n.update(.5);assert(e.state.vitals.farmer.stamina>10&&e.state.vitals['farmer-2'].stamina>10,'both eat during the same game step');
  const restored=decodeEconomy(encodeEconomy(e));assert.equal(restored.state.vitals.farmer.rest?.camp,f.id);assert.equal(restored.state.vitals['farmer-2'].rest?.camp,g.id);
  h.n.manual('farmer');e.state.vitals.farmer.manualUntil=0;e.state.vitals.farmer.retryAt=0;h.states.farmer.position={x:site.x,z:site.z-4};
  for(const [i,id] of ['farmer-2','farmer-leader','infantry','archer'].entries()){e.state.vitals[id].stamina=10;e.state.vitals[id].rest={camp:f.id,goal:{x:site.x+Math.cos(i*Math.PI/2)*4,z:site.z+Math.sin(i*Math.PI/2)*4}};}
  h.n.update(.01);assert.equal(e.state.vitals.farmer.rest?.camp,g.id,'travelling reservations fill the nearer fire too');
});

test('personal meals and paid supplies share dangerous areas and do not send farmers back before clearance',()=>{
  const {e,f,site}=built();Object.assign(f,{enabled:true,wood:12,food:12,meals:2});
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  Object.assign(e.state.vitals.farmer,{manualUntil:0,stamina:5});
  const {n,states}=needsHarness(e);states.farmer.position={x:site.x,z:site.z-6};
  const currentRest=()=>e.state.vitals.farmer.rest;
  const start={...states.farmer.position};
  const threat={id:'camp:fire',x:site.x,z:site.z,radius:2,fixed:true};
  updateDangerZones(e.state.dangerZones,[threat],e.state.seconds);n.update(.05);
  assert.equal(currentRest(),undefined);assert.deepEqual(states.farmer.position,start);
  updateDangerZones(e.state.dangerZones,[],e.state.seconds);e.advance(9.9);n.update(.05);
  assert.equal(currentRest(),undefined,'temporary quiet must not invite the worker back');
  e.advance(V.retrySeconds+.1);updateDangerZones(e.state.dangerZones,[],e.state.seconds);n.update(.05);
  const rest=currentRest();assert(rest,'a safe fire can be used again');
  const supply=e.request('supply',f.id,undefined,'continuation',{resource:'wood',amount:2}).task!;
  assert(e.assign(supply.id,'farmer',supply.origin).ok);e.arrive(supply.id);rest.supply=supply.id;
  const stock=e.state.inventory.wood;
  updateDangerZones(e.state.dangerZones,[threat],e.state.seconds);n.update(.05);
  assert(!e.state.vitals.farmer.rest);assert(supply.danger);
  assert.equal(e.state.goods[0].state,'ground');assert.equal(e.state.inventory.wood,stock);
  e.checkDanger(p=>pathInDanger(e.state.dangerZones,p));
  assert.equal(e.claim('farmer-2'),undefined);assert.equal(e.state.inventory.wood,stock);
});
