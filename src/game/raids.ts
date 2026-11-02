import { Combat, fighterRadius } from './combat.ts';
import { COMBAT_CONFIG } from './combat-config.ts';
import { RAID_CONFIG as C, newWolf, raidRandom, allWolves } from './raid-state.ts';
import type { Wolf } from './raid-state.ts';
import type { Economy } from './economy.ts';
import { RESIDENTS } from './resident-data.ts';
import { health } from './vitals.ts';
import { fireIsLit } from './campfire.ts';
import { BUILDINGS, LANDSCAPE, WORLD_BOUNDS } from './world-data.ts';
import { isBlocked } from './movement.ts';
import type { Point, Obstacle } from './movement.ts';
import { planMoveDestination, planWorkApproach } from './work-navigation.ts';
import { resetRouteState, stepRoute } from './route-following.ts';
import type { Neighbour } from './route-following.ts';
import { segmentIsClear } from './wander.ts';
import { chooseTarget } from './targeting.ts';

export interface RaidResidents {
  status(id: string): { position: Point; moving: boolean };
  command(point: Point, id: string): boolean;
  release(id: string): void;
  resting(id: string, value: boolean): void;
  neighbours(): Neighbour[];
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const home = { x: 0, z: -3 };
const circle = (p: Point, radius: number) => Array.from({ length: 8 }, (_, i) => ({ x: p.x + Math.cos(i * Math.PI / 4) * radius, z: p.z + Math.sin(i * Math.PI / 4) * radius }));

/** Dynamic threats share the combat hit pipeline and the swept route follower.
 * Only this controller owns wolf decisions, theft and wave settlement. */
export class Raids {
  private economy: Economy;
  private combat: Combat;
  private people: RaidResidents;
  private solids: () => readonly Obstacle[];
  private visible: (point: Point) => boolean;
  private decisions = 0;
  constructor(economy: Economy, combat: Combat, people: RaidResidents, solids: () => readonly Obstacle[], visible: (point: Point) => boolean) {
    this.economy = economy; this.combat = combat; this.people = people; this.solids = solids; this.visible = visible;
    combat.setResidentPositions(id => people.status(id).position);
    this.syncThreats();
  }
  get state() { return this.economy.state.raids; }
  get wolves() { return allWolves(this.state); }
  private syncThreats() { this.combat.setThreats(this.wolves.filter(w => w.mode !== 'gone')); }
  private position(id: string) { return this.combat.unit(id)?.position ?? this.people.status(id).position; }
  private fireClear(a: Point, b: Point) { return segmentIsClear(a, b, .05, WORLD_BOUNDS, this.solids().filter(o => !(o.kind === 'circle' && distance(o, b) < .01))); }
  private clear(a: Point, b: Point) { return segmentIsClear(a, b, .05, WORLD_BOUNDS, this.solids()); }
  neighbours(): Neighbour[] {
    return this.wolves.filter(w => w.life === 'active' && w.mode !== 'gone').map(w => ({ id: w.id, position: w.position,
      radius: fighterRadius(w), moving: w.speed > .08, purposeful: !!w.route.length, waiting: w.navigation.waiting }));
  }
  occupancy() { return this.neighbours().map(n => ({ kind: 'circle' as const, ...n.position, radius: n.radius })); }
  canWork(id: string) { return !this.state.evading[id] && health(this.economy.state, id) > 0; }
  manual(id: string) { delete this.state.evading[id]; }
  private neighboursFor(w: Wolf) {
    return [...this.people.neighbours(), ...this.combat.state.units.filter(u => u.life !== 'defeated').map(u => ({ id: u.id, position: u.position,
      radius: fighterRadius(u), moving: u.speed > .08, purposeful: !!u.route.length, waiting: u.navigation.waiting })), ...this.neighbours().filter(n => n.id !== w.id)];
  }
  private plan(w: Wolf, points: Point[]) {
    w.planIn = .9;
    const reservations = this.neighboursFor(w).map(n => ({ ...n, destination: this.combat.unit(n.id)?.route.at(-1) }));
    w.route = planWorkApproach(w.position, points, fighterRadius(w), WORLD_BOUNDS, this.solids(), reservations) ?? [];
  }
  private travel(w: Wolf, dt: number) {
    const before = w.position;
    const result = stepRoute(w.id, w.position, w.route, w.navigation, dt, COMBAT_CONFIG.wolf.speed, fighterRadius(w), WORLD_BOUNDS, this.solids(), this.neighboursFor(w));
    w.position = result.position;
    const moved = distance(before, w.position); w.speed = moved / dt; w.gait = (w.gait + moved / 1.26) % 1;
    if (moved > .0001) w.facing = Math.atan2(w.position.x - before.x, w.position.z - before.z);
    if (result.unreachable) { w.route = []; w.planIn = 1.5; }
  }
  private flee(w: Wolf) {
    if (w.mode === 'flee' || w.mode === 'gone') return;
    w.mode = 'flee'; w.target = undefined; w.foodTarget = undefined; w.attack = undefined; w.feeding = 0; w.route = []; w.planIn = 0;
    resetRouteState(w.navigation);
  }
  private spawn() {
    const state = this.state, now = this.economy.state.seconds;
    if (this.combat.state.units.filter(u => u.team === 'home' && u.hp > COMBAT_CONFIG[u.role].hp * .35).length < 2) { state.nextAt = now + 60; return; }
    const candidates = LANDSCAPE.regions.filter(r => r.id !== 'home' && !('camp' in r) && distance(r, home) > 32);
    const start = Math.floor(raidRandom(state) * candidates.length);
    const count = state.wave === 0 ? 2 : Math.min(C.maxWolves, 2 + this.economy.state.upgrades.arms + Math.floor(this.economy.state.buildings.length / 3) + Math.floor(raidRandom(state) * 2));
    // At most three spawn candidates per attempt. If all routes are occupied or in
    // view, postpone; never pop wolves into the visible village.
    for (let i = 0; i < Math.min(3, candidates.length); i++) {
      const region = candidates[(start + i) % candidates.length];
      const origin = { x: region.x + (raidRandom(state) - .5) * 6, z: region.z + (raidRandom(state) - .5) * 6 };
      const spots = circle(origin, 2.5).slice(0, count);
      if (spots.some(p => this.visible(p) || isBlocked(p, .72, this.solids())
        || RESIDENTS.some(r => distance(p, this.position(r.id)) < 16)
        || [...BUILDINGS, ...this.economy.state.sites].some(s => distance(p, s) < 12))) continue;
      const route = planMoveDestination(origin, home, .72, WORLD_BOUNDS, this.solids(), []);
      if (!route) continue;
      const wolves = spots.map((p, n) => newWolf(`wolf-${state.wave + 1}-${n}`, p));
      // Every member must have a legal connection; the first leg cannot cut a bank.
      if (wolves.some(w => !segmentIsClear(w.position, origin, .72, WORLD_BOUNDS, this.solids()))) continue;
      for (const w of wolves) w.route = [{ ...origin }, ...route.map(p => ({ ...p }))];
      state.wave++; state.wolves = wolves; state.phase = 'raid'; state.startedAt = now; state.origin = origin;
      const direction = Math.abs(origin.x) > Math.abs(origin.z) ? origin.x > 0 ? '东侧' : '西侧' : origin.z > 0 ? '北侧' : '南侧';
      state.notice = `${direction}传来狼嚎 · ${count}只灰狼正在接近`; state.noticeUntil = now + 18;
      this.syncThreats(); return;
    }
    state.nextAt = now + 20;
  }
  private protect() {
    const now = this.economy.state.seconds;
    const threats = this.combat.targets().filter(t => t.team === 'enemy' && t.life === 'active'
      && !this.wolves.some(w => w.id === t.id && ['gone', 'flee'].includes(w.mode)));
    for (const r of RESIDENTS) {
      if (health(this.economy.state, r.id) <= 0) { delete this.state.evading[r.id]; continue; }
      const position = this.position(r.id), vital = this.economy.state.vitals[r.id];
      const nearby = threats.filter(w => distance(position, w.position) < 8 && this.clear(position, w.position));
      if (this.combat.unit(r.id)) {
        for (const w of threats) if (distance(position, w.position) <= C.aidRadius
          && RESIDENTS.some(n => health(this.economy.state, n.id) > 0 && distance(this.position(n.id), w.position) < 8) && this.clear(position, w.position)) {
          if (this.combat.assist(r.id, w.id)) break;
        }
        continue;
      }
      const evasion = this.state.evading[r.id];
      if (!nearby.length) {
        if (evasion && now >= evasion.safeAt) { this.people.release(r.id); delete this.state.evading[r.id]; }
        continue;
      }
      // An accepted player movement stays in charge, even beyond its grace time.
      if (vital.manualUntil > now || !evasion && this.people.status(r.id).moving && !this.economy.active(r.id) && !vital.rest) continue;
      const e = evasion ?? (this.state.evading[r.id] = { safeAt: now + 5, planAt: 0 });
      e.safeAt = now + 5; vital.hurtUntil = Math.max(vital.hurtUntil, now + 1);
      if (e.planAt > now) continue;
      e.planAt = now + 2;
      const wolf = nearby.reduce((a, b) => distance(position, a.position) < distance(position, b.position) ? a : b);
      const dx = position.x - wolf.position.x, dz = position.z - wolf.position.z, length = Math.hypot(dx, dz) || 1;
      const points = [{ x: position.x + dx / length * 8, z: position.z + dz / length * 8 },
        ...this.economy.state.campfires.filter(fireIsLit).flatMap(f => circle(this.economy.state.sites.find(s => s.id === f.id)!, 3)),
        ...this.economy.warehouseDoors()]
        .filter(p => distance(p, wolf.position) > distance(position, wolf.position) + 2)
        .sort((a, b) => distance(position, a) - distance(position, b));
      // Interrupt once: carried resources are preserved by the economy, never refunded.
      if (!evasion) { this.economy.interrupt(position, r.id); this.people.release(r.id); vital.rest = undefined; this.people.resting(r.id, false); }
      for (const point of points) if (this.people.command(point, r.id)) break;
    }
  }
  update(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const dt = Math.min(seconds, .25), now = this.economy.state.seconds;
    if (this.state.phase === 'peace' && now >= this.state.nextAt) this.spawn();
    this.decisions -= dt;
    if (this.decisions <= 0) { this.decisions = .35; this.protect(); }
    let remaining = dt;
    while (remaining > 1e-8) { const step = Math.min(.05, remaining); for (const w of this.wolves) this.tick(w, step); remaining -= step; }
    if (this.state.phase === 'raid' && this.state.wolves.every(w => w.life === 'defeated' || w.mode === 'gone')) {
      this.state.phase = 'peace'; this.state.nextAt = now + C.intervalMin + raidRandom(this.state) * (C.intervalMax - C.intervalMin);
      const stolen = this.state.wolves.filter(w => w.mode === 'gone').reduce((n, w) => n + w.carried, 0);
      this.state.notice = stolen ? `狼群离开了 · 带走${stolen}份熟食` : '狼群已被赶走'; this.state.noticeUntil = now + 10;
    }
  }
  private tick(w: Wolf, dt: number) {
    w.speed = 0;
    if (w.life === 'defeated') {
      if (!w.settled) { w.settled = true; this.economy.dropReward(w.position, { food: C.loot + w.carried }, false); }
      return;
    }
    if (w.mode === 'gone') return;
    const now = this.economy.state.seconds, stats = COMBAT_CONFIG.wolf, wild = this.state.wildWolves.includes(w);
    w.cooldown = Math.max(0, w.cooldown - dt); w.planIn = Math.max(0, w.planIn - dt);
    const fireNear = this.economy.state.campfires.some(f => fireIsLit(f) && this.economy.state.sites.some(s => s.id === f.id && distance(s, w.position) < C.fearRadius && this.fireClear(w.position, s)));
    w.fear = Math.max(0, Math.min(10, w.fear + (fireNear ? dt : -dt * .5)));
    const lost = this.state.wolves.filter(n => n.life === 'defeated').length;
    if (w.hp <= stats.hp * .25 || w.fear >= C.fearSeconds || w.carried || !wild && (lost >= Math.ceil(this.state.wolves.length / 2) || now - this.state.startedAt >= C.duration)) this.flee(w);
    if (w.mode === 'flee') {
      if (wild && distance(w.position, w.home) < .5 && w.fear < 1 && w.hp > stats.hp * .25) { w.mode = 'approach'; w.defendFrom = undefined; }
      if (!wild && distance(w.position, w.home) < 2 && !this.visible(w.position) && !RESIDENTS.some(r => distance(this.position(r.id), w.position) < 16)) {
        w.mode = 'gone'; w.route = []; this.syncThreats(); return;
      }
      if (!w.route.length && w.planIn <= 0 && distance(w.position, w.home) >= .3) this.plan(w, [w.home]);
      this.travel(w, dt); return;
    }
    if (w.attack) {
      const attack = w.attack; attack.elapsed += dt;
      const target = this.position(attack.target);
      w.facing = Math.atan2(target.x - w.position.x, target.z - w.position.z);
      if (!attack.released && attack.elapsed >= stats.windup) {
        attack.released = true;
        if (health(this.economy.state, attack.target) > 0 && distance(w.position, target) <= stats.range + .15 + (attack.target === 'cavalry' ? .72 : 0) && this.clear(w.position, target)) {
          this.combat.hurt(attack.target, stats.attack, w.id);
        }
      }
      if (attack.elapsed >= stats.windup + stats.recovery) w.attack = undefined;
      return;
    }
    const anchor = wild ? w.home : w.defendFrom ?? w.position;
    if (w.target && (health(this.economy.state, w.target) <= 0 || distance(w.position, this.position(w.target)) > C.chase
      || distance(anchor, this.position(w.target)) > C.chase)) {
      w.target = undefined; w.route = []; w.defendFrom = undefined;
      if (wild) { w.mode = 'flee'; w.planIn = 0; return; }
    }
    if ((!w.target || !this.combat.target(w.target)?.canAttack) && w.planIn <= 0) {
      const candidate = chooseTarget(w, this.combat.targets(), C.acquire,
        t => this.clear(w.position, t.position) && distance(anchor, t.position) <= C.chase);
      if (candidate && (!w.target || candidate.canAttack)) {
        w.target = candidate.id; w.defendFrom ??= { ...anchor };
        w.mode = 'hunt'; w.foodTarget = undefined; w.feeding = 0; w.route = [];
      }
    }
    if (w.target) {
      const target = this.position(w.target), reach = stats.range + (w.target === 'cavalry' ? .72 : 0);
      if (distance(w.position, target) <= reach && this.clear(w.position, target)) {
        w.route = []; w.facing = Math.atan2(target.x - w.position.x, target.z - w.position.z);
        if (!w.cooldown) { w.cooldown = stats.interval; w.attack = { id: this.combat.state.nextAttack++, target: w.target, elapsed: 0, released: false }; }
      } else {
        if (w.planIn <= 0) this.plan(w, circle(target, reach * .85).filter(p => this.clear(p, target)));
        this.travel(w, dt);
      }
      return;
    }
    if (wild) {
      if (distance(w.position, w.home) > .5) { if (!w.route.length && w.planIn <= 0) this.plan(w, [w.home]); this.travel(w, dt); }
      else { w.route = []; w.mode = 'approach'; w.defendFrom = undefined; }
      return;
    }
    if (!w.foodTarget && w.planIn <= 0) {
      const fire = this.economy.state.campfires.find(f => f.meals > 0 && this.economy.state.sites.some(s => s.id === f.id && distance(s, w.position) < 12));
      if (fire) { w.foodTarget = fire.id; w.mode = 'feed'; w.route = []; }
    }
    if (w.foodTarget) {
      const fire = this.economy.campfire(w.foodTarget), site = this.economy.state.sites.find(s => s.id === w.foodTarget);
      if (!fire?.meals || !site) { w.foodTarget = undefined; w.feeding = 0; w.mode = 'approach'; w.route = []; }
      else {
        if (distance(w.position, site) <= 2.3 && this.fireClear(w.position, site)) {
          w.route = []; w.facing = Math.atan2(site.x - w.position.x, site.z - w.position.z); w.feeding += dt;
          if (w.feeding >= C.feedSeconds && fire.meals > 0) { fire.meals--; w.carried = 1; this.flee(w); }
        } else { if (w.planIn <= 0) this.plan(w, circle(site, 2.2)); this.travel(w, dt); }
        return;
      }
    }
    if (!w.route.length && w.planIn <= 0) this.plan(w, circle(home, 6));
    this.travel(w, dt);
  }
}
