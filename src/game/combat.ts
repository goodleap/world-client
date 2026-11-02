import type { Point, Obstacle } from './movement.ts';
import { WORLD_BOUNDS } from './world-data.ts';
import { RESIDENTS, ENEMIES } from './resident-data.ts';
import { segmentIsClear } from './wander.ts';
import { createRouteState, resetRouteState, stepRoute } from './route-following.ts';
import type { RouteState, Neighbour } from './route-following.ts';
import { planMoveDestination, planWorkApproach } from './work-navigation.ts';
import { COMBAT_CONFIG as C, ENCOUNTERS } from './combat-config.ts';
import type { CombatRole } from './combat-config.ts';
import type { Economy } from './economy.ts';
import { effort, VITAL_CONFIG, changeHealth } from './vitals.ts';
import { chooseTarget, hostile } from './targeting.ts';
import type { CombatTarget } from './targeting.ts';

export type CombatOrder = 'guard' | 'move' | 'attack' | 'retreat' | 'hold' | 'rest';
export type CombatLife = 'active' | 'defeated';
export interface Fighter {
  id: string; role: CombatRole; team: 'home' | 'enemy'; position: Point; home: Point;
  hp: number; life: CombatLife; order: CombatOrder; goal?: Point; target?: string;
  diedAt?: number;
  facing: number; speed: number; cooldown: number; defendFrom?: Point; hurtAt?: number;
  attack?: { id: number; target: string; elapsed: number; released: boolean };
  route: Point[]; navigation: RouteState; planIn: number;
}
export interface Projectile { id: number; source: string; target: string; from: Point; to: Point; elapsed: number; duration: number; damage: number }
export interface CampState { id: string; cleared: boolean; discovered: boolean; rewardGranted: boolean; respawnAt: number; cycle: number }
export interface CombatState { camps: CampState[]; units: Fighter[]; projectiles: Projectile[]; nextAttack: number; discovered: boolean; cleared: boolean; rewardGranted: boolean; rewardGoods: string[] }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const enemyDefinitions = new Map(ENEMIES.map(enemy => [enemy.id, enemy]));
export function fighterStats(u: Pick<Fighter, 'role' | 'team'> & { id?: string }) {
  return u.role === 'wolf' ? C.wolf : u.team === 'home' ? C[u.role] : enemyDefinitions.get(u.id ?? '')?.variant === 'heavy' ? C.enemyHeavy : u.role === 'infantry' ? C.enemyMelee : C.enemyArcher;
}
export const fighterRadius = (u: Pick<Fighter, 'role'>) => u.role === 'cavalry' ? 1.12 : u.role === 'wolf' ? .72 : .4;
// Melee reach accounts for the target body, so foot soldiers can strike a
// mounted opponent without routing into the horse's collision circle.
const reach = (u: Fighter, target: CombatTarget) => fighterStats(u).range + (u.role === 'archer' ? 0 : Math.max(0, target.radius - .4));
export function initialCombat(): CombatState {
  return { camps: ENCOUNTERS.map(c => ({ id: c.id, cleared: false, discovered: false, rewardGranted: false, respawnAt: 0, cycle: 0 })), nextAttack: 1, discovered: false, cleared: false, rewardGranted: false, rewardGoods: [], projectiles: [],
    units: [...RESIDENTS.filter(r => r.id === 'infantry' || r.id === 'archer' || r.id === 'cavalry'), ...ENEMIES].map(r => {
      const role = r.role as CombatRole, team = r.id.startsWith('enemy-') ? 'enemy' as const : 'home' as const;
      return { id: r.id, role, team, position: { ...r.spawn }, home: { ...r.home }, hp: fighterStats({ id: r.id, role, team }).hp,
        life: 'active', order: 'guard', facing: Math.PI, speed: 0, cooldown: 0,
        route: [], navigation: createRouteState(), planIn: 0 };
    }) };
}

/** Owns combat time and settlement. Animation callbacks never apply damage.
 * All state, including an in-flight shot and release flag, is saved atomically
 * with the economy. Navigation reuses the game's swept crowd route follower. */
export class Combat {
  readonly state: CombatState;
  private economy: Economy;
  private solids: () => readonly Obstacle[];
  private civilians: () => Neighbour[];
  private residentPosition?: (id: string) => Point;
  private units: Map<string, Fighter>;
  private threats: readonly Fighter[] = [];
  private statCache = new Map<string, { level: number; value: ReturnType<typeof fighterStats> }>();
  constructor(state: CombatState, economy: Economy, solids: () => readonly Obstacle[], civilians: () => Neighbour[] = () => []) {
    this.state = state; this.economy = economy; this.solids = solids; this.civilians = civilians;
    this.units = new Map(state.units.map(unit => [unit.id, unit]));
  }
  private camp(u: Fighter) { return ENCOUNTERS.find(c => c.id === enemyDefinitions.get(u.id)?.camp)!; }
  private stats(u: Fighter) {
    const level = u.team === 'home' ? this.economy.state.upgrades.arms : 0, cached = this.statCache.get(u.id);
    if (cached?.level === level) return cached.value;
    const base = fighterStats(u), value = { ...base, attack: base.attack + level * 3, armor: base.armor + level };
    this.statCache.set(u.id, { level, value }); return value;
  }
  unit(id: string) { return this.units.get(id); }
  setResidentPositions(read: (id: string) => Point) { this.residentPosition = read; }
  targets(): CombatTarget[] {
    const neighbours = this.civilians();
    return [...this.units.values()].map(u => ({ id: u.id, team: u.team, position: u.position, hp: u.hp, life: u.life, radius: fighterRadius(u), canAttack: true }))
      .concat(RESIDENTS.filter(r => !this.units.has(r.id)).map(r => ({ id: r.id, team: 'home' as const,
        position: this.residentPosition?.(r.id) ?? neighbours.find(n => n.id === r.id)?.position ?? this.economy.state.residents[r.id]?.position ?? r.spawn,
        hp: this.economy.state.vitals[r.id].hp!, life: this.economy.state.vitals[r.id].hp! > 0 ? 'active' as const : 'defeated' as const,
        radius: r.bodyRadius, canAttack: false })));
  }
  target(id: string) { return this.targets().find(t => t.id === id); }
  setThreats(threats: readonly Fighter[]) {
    this.threats = threats;
    this.units = new Map([...this.state.units, ...threats].map(u => [u.id, u]));
    for (const u of this.state.units) {
      if (u.target && !this.target(u.target)) u.target = undefined;
      if (u.attack && !this.target(u.attack.target)) u.attack = undefined;
    }
    this.state.projectiles = this.state.projectiles.filter(p => this.target(p.target) && this.units.has(p.source));
    for (const id of this.statCache.keys()) if (!this.units.has(id)) this.statCache.delete(id);
  }
  hurt(id: string, damage: number, source: string) { const target = this.target(id); if (target) this.damage(target, damage, source); }
  assist(id: string, target: string) {
    const u = this.unit(id), foe = this.unit(target);
    if (!u || !foe || u.team !== 'home' || u.life !== 'active' || foe.life !== 'active' || u.target || u.attack || u.goal
      || u.defendFrom && (distance(foe.position, u.defendFrom) > C.chase || distance(u.position, u.defendFrom) > C.chase)
      || !['guard', 'hold'].includes(u.order) || this.economy.state.vitals[id].rest
      || this.economy.state.vitals[id].manualUntil > this.economy.state.seconds || this.economy.active(id)) return false;
    u.target = target; u.order = 'guard'; u.defendFrom ??= { ...u.position }; this.stop(u); return true;
  }
  controllable(ids: readonly string[]) { return this.state.units.filter(u => ids.includes(u.id) && u.team === 'home' && u.life === 'active'); }
  private neighbours(u: Fighter) {
    return [...this.civilians(), ...[...this.state.units, ...this.threats].filter(n => n !== u && n.life !== 'defeated').map(n => ({ id: n.id, position: n.position, radius: fighterRadius(n),
      moving: n.speed > .08, purposeful: !!n.route.length, waiting: n.navigation.waiting }))];
  }
  private reservations(u: Fighter) {
    return this.neighbours(u).map(n => ({ ...n, destination: this.unit(n.id)?.route.at(-1) }));
  }
  private stop(u: Fighter) { u.route.length = 0; u.speed = 0; resetRouteState(u.navigation); }
  move(ids: readonly string[], point: Point, retreat = false, rest = false) {
    let accepted = 0;
    for (const u of this.state.units.filter(u => ids.includes(u.id) && u.team === 'home' && u.life !== 'defeated')) {
      const requested = retreat ? u.home : point;
      if (!Number.isFinite(requested.x) || !Number.isFinite(requested.z)) continue;
      // Picking returns a Babylon Vector3 whose x/z are prototype accessors.
      // Copy coordinates explicitly before pathfinding: a direct path retains
      // its destination, and spreading a Vector3 loses x/z in live goals/saves.
      const goal: Point = { x: requested.x, z: requested.z };
      const path = rest ? planWorkApproach(u.position, [goal], fighterRadius(u), WORLD_BOUNDS, this.solids(), this.reservations(u))
        : planMoveDestination(u.position, goal, fighterRadius(u), WORLD_BOUNDS, this.solids(), this.reservations(u));
      if (!path) continue;
      // Cancelling the windup never refunds the committed cooldown.
      u.attack = undefined; u.target = undefined; u.order = rest ? 'rest' : retreat ? 'retreat' : 'move';
      if (!rest) this.manual(u.id);
      const destination = path.at(-1) ?? goal;
      u.goal = { x: destination.x, z: destination.z }; u.route = path; u.planIn = 0; resetRouteState(u.navigation); accepted++;
    }
    return accepted;
  }
  private manual(id: string) {
    this.unit(id)!.defendFrom = undefined;
    if (this.economy.active(id)?.kind === 'supply') this.economy.interrupt(this.unit(id)!.position, id);
    const v = this.economy.state.vitals[id]; v.rest = undefined; v.manualUntil = this.economy.state.seconds + VITAL_CONFIG.manualGrace;
  }
  attack(ids: readonly string[], target: string) {
    const foe = this.target(target); if (!foe || foe.life !== 'active') return 0;
    let accepted = 0;
    for (const u of this.controllable(ids)) {
      if (!hostile(u, foe)) continue;
      // Repeated attack clicks do not restart or accelerate an attack.
      this.manual(u.id); if (u.target !== foe.id) { u.attack = undefined; this.stop(u); }
      u.order = 'attack'; u.target = foe.id; u.goal = undefined; accepted++;
    }
    return accepted;
  }
  guard(ids: readonly string[]) {
    for (const u of this.controllable(ids)) { this.manual(u.id); u.order = 'guard'; u.goal = undefined; u.target = undefined; u.attack = undefined; this.stop(u); }
  }
  private damage(victim: CombatTarget, amount: number, sourceId: string) {
    const source = this.target(sourceId);
    if (victim.life !== 'active' || source && !hostile(victim, source)) return;
    const target = this.unit(victim.id);
    if (!target) {
      changeHealth(this.economy.state, victim.id, -Math.max(1, amount));
      this.economy.state.vitals[victim.id].hurtUntil = this.economy.state.seconds + 3;
      if (!this.economy.state.vitals[victim.id].hp) {
        this.economy.interrupt(victim.position, victim.id);
        if (RESIDENTS.find(r => r.id === victim.id)?.effects?.includes('leader')) this.economy.setLeadership(false);
        delete this.economy.state.raids.evading[victim.id];
        if (this.economy.state.residents[victim.id]) this.economy.state.residents[victim.id].manualGoal = undefined;
      }
      this.economy.revision++; return;
    }
    target.hp = Math.max(0, target.hp - Math.max(1, amount - this.stats(target).armor));
    target.hurtAt = this.economy.state.seconds;
    if (target.role === 'wolf') {
      const source = this.unit(sourceId);
      if (source?.team === 'home' && !target.target && distance(target.position, source.position) <= C.acquire + 3) target.target = source.id;
      if (!target.hp) { target.life = 'defeated'; target.diedAt = this.economy.state.seconds; target.attack = undefined; target.target = undefined; this.stop(target); }
      return;
    }
    this.economy.state.vitals[target.id].hurtUntil = this.economy.state.seconds + 3;
    if (target.hp) {
      const source = this.target(sourceId), current = target.target && this.target(target.target);
      // Both sides retaliate, keeping an existing valid opponent stable.
      // Player movement wins; automatic meals/supply yield to combat.
      if (source?.life === 'active' && source.team !== target.team && !['move', 'retreat'].includes(target.order)
        && !(target.order === 'hold' && target.goal) && (!current || current.life !== 'active')
        && distance(target.position, source.position) <= C.chase
        && (target.team === 'home' || distance(source.position, this.camp(target)) <= this.camp(target).leash)) {
        this.economy.interrupt(target.position, target.id);
        this.economy.state.vitals[target.id].rest = undefined;
        target.defendFrom ??= target.team === 'home' ? { ...target.position } : { ...this.camp(target) };
        target.order = 'guard'; target.target = source.id; target.goal = undefined; this.stop(target);
      }
      return;
    }
    this.economy.interrupt(target.position, target.id);
    this.economy.state.vitals[target.id].rest = undefined;
    this.stop(target); target.attack = undefined; target.target = undefined; target.goal = undefined;
    target.life = 'defeated'; target.diedAt = this.economy.state.seconds;
    for (const id of target.id === 'cavalry' ? ['cavalry', 'horse'] : [target.id]) {
      this.economy.state.vitals[id].rest = undefined; this.economy.state.vitals[id].meal = undefined;
    }
    target.order = 'hold'; target.planIn = 0;
  }
  private travel(u: Fighter, dt: number, speed: number) {
    const previous = u.position;
    const step = stepRoute(u.id, u.position, u.route, u.navigation, dt, speed, fighterRadius(u), WORLD_BOUNDS, this.solids(), this.neighbours(u));
    u.position = step.position; u.speed = distance(previous, u.position) / dt;
    if (u.speed > .01) u.facing = Math.atan2(u.position.x - previous.x, u.position.z - previous.z);
    if (step.unreachable) { this.stop(u); u.planIn = 1; }
  }
  private plan(u: Fighter, points: Point[]) {
    u.planIn = .8;
    u.route = planWorkApproach(u.position, points, fighterRadius(u), WORLD_BOUNDS, this.solids(), this.reservations(u)) ?? [];
  }
  update(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    // Bound catch-up. The game feeds the same active delta to every system.
    let remaining = Math.min(seconds, .25);
    while (remaining > 1e-8) { const dt = Math.min(remaining, .05); this.tick(dt); remaining -= dt; }
  }
  private tick(dt: number) {
    for (const shot of [...this.state.projectiles]) {
      shot.elapsed += dt;
      if (shot.elapsed < shot.duration) continue;
      this.state.projectiles.splice(this.state.projectiles.indexOf(shot), 1);
      const target = this.target(shot.target);
      // A shot lands at its committed point. A moving target can dodge it.
      if (target && distance(target.position, shot.to) < .8 && segmentIsClear(shot.from, shot.to, .05, WORLD_BOUNDS, this.solids())) this.damage(target, shot.damage, shot.source);
    }
    for (const u of this.state.units) {
      const stats = this.stats(u);
      u.speed = 0; u.cooldown = Math.max(0, u.cooldown - dt); u.planIn = Math.max(0, u.planIn - dt);
      if (u.life === 'defeated') continue;
      if (u.team === 'home') for (const camp of this.state.camps) { const definition = ENCOUNTERS.find(c => c.id === camp.id)!; if (distance(u.position, definition) < definition.discover) camp.discovered = true; }
      // Commands to move and a return to the engagement anchor take priority.
      const returning = u.order === 'hold' && !!u.goal;
      let target = u.target ? this.target(u.target) : undefined;
      const explicit = u.order === 'attack' && target?.life === 'active';
      const anchor = u.team === 'enemy' ? this.camp(u) : u.defendFrom ?? u.position;
      const leash = u.team === 'enemy' ? Math.max(C.chase, this.camp(u).leash) : C.chase;
      if (!explicit && target && (distance(u.position, target.position) > C.chase
        || distance(target.position, anchor) > leash || distance(u.position, anchor) > leash)) {
        u.goal = u.team === 'enemy' ? { ...u.home } : { x: anchor.x, z: anchor.z }; u.order = 'hold'; u.target = undefined; u.attack = undefined;
        this.stop(u); continue;
      }
      if (!['move', 'retreat'].includes(u.order) && !returning && !explicit) {
        if (!target || target.life !== 'active' || !hostile(u, target)) target = undefined;
        // Keep combat opponents stable; promote a civilian target when a fighter
        // enters alert range. Both factions use exactly the same selection rule.
        if (!target || !target.canAttack) {
          const candidate = chooseTarget(u, this.targets(), C.acquire, t => distance(t.position, anchor) <= leash
            && segmentIsClear(u.position, t.position, .05, WORLD_BOUNDS, this.solids()));
          if (candidate && (!target || candidate.canAttack)) target = candidate;
        }
        if (target) {
          if (u.target !== target.id || this.economy.state.vitals[u.id].rest) {
            this.economy.interrupt(u.position, u.id); this.economy.state.vitals[u.id].rest = undefined;
            u.attack = undefined; this.stop(u);
          }
          u.defendFrom ??= { x: anchor.x, z: anchor.z };
          u.target = target.id; u.order = 'guard'; u.goal = undefined;
        } else { u.target = undefined; u.attack = undefined; u.defendFrom = undefined; }
      }
      if (u.order === 'move' || u.order === 'retreat' || u.order === 'rest' || returning) {
        if (u.goal && distance(u.position, u.goal) > .15) {
          if (!u.route.length && u.planIn <= 0) this.plan(u, [u.goal]);
          this.travel(u, dt, stats.speed * effort(this.economy.state.vitals, u.id));
        } else { this.stop(u); u.goal = undefined; u.order = 'guard'; if (returning) u.defendFrom = undefined; }
        continue;
      }
      if (!target && this.economy.state.vitals[u.id]?.rest) continue;
      if (u.attack) {
        const action = u.attack; action.elapsed += dt;
        const target = this.target(action.target);
        if (target) u.facing = Math.atan2(target.position.x - u.position.x, target.position.z - u.position.z);
        if (!action.released && action.elapsed >= stats.windup) {
          action.released = true;
          if (target?.life === 'active' && distance(u.position, target.position) <= reach(u, target) + .15
            && segmentIsClear(u.position, target.position, .05, WORLD_BOUNDS, this.solids())) {
            if (u.role !== 'archer') this.damage(target, stats.attack, u.id);
            else this.state.projectiles.push({ id: action.id, source: u.id, target: target.id, from: { ...u.position }, to: { ...target.position },
              elapsed: 0, duration: distance(u.position, target.position) / C.projectileSpeed, damage: stats.attack });
          }
        }
        if (action.elapsed >= stats.windup + stats.recovery) u.attack = undefined;
        continue;
      }
      if (!target || target.life !== 'active') {
        u.target = undefined;
        const patrol = u.team === 'enemy' ? this.camp(u).patrol : [];
        if (patrol.length) {
          const offset = Number(u.id.slice(-1)) * 1.1;
          const index = Math.floor(this.economy.state.seconds / 12) % patrol.length;
          const goal = { x: patrol[index].x + offset, z: patrol[index].z };
          if (distance(u.position, goal) > .5 && u.planIn <= 0 && !u.route.length) { this.plan(u, [goal]); u.planIn = 3; }
          this.travel(u, dt, stats.speed * .65);
        } else this.stop(u);
        if (u.order === 'attack') u.order = 'guard'; continue;
      }
      const clear = segmentIsClear(u.position, target.position, .05, WORLD_BOUNDS, this.solids());
      if (distance(u.position, target.position) <= reach(u, target) && clear) {
        this.stop(u); u.facing = Math.atan2(target.position.x - u.position.x, target.position.z - u.position.z);
        if (!u.cooldown) { u.cooldown = stats.interval / effort(this.economy.state.vitals, u.id); u.attack = { id: this.state.nextAttack++, target: target.id, elapsed: 0, released: false }; }
      } else {
        if (u.planIn <= 0) {
          const radius = Math.max(reach(u, target) * .8, fighterRadius(u) + target.radius + .1);
          const points = Array.from({ length: 12 }, (_, i) => ({ x: target!.position.x + Math.cos(i * Math.PI / 6) * radius,
            z: target!.position.z + Math.sin(i * Math.PI / 6) * radius }))
            .filter(p => segmentIsClear(p, target!.position, .05, WORLD_BOUNDS, this.solids()));
          this.plan(u, points);
        }
        this.travel(u, dt, stats.speed * effort(this.economy.state.vitals, u.id));
      }
    }
    for (const camp of this.state.camps) {
      const config = ENCOUNTERS.find(c => c.id === camp.id)!;
      const units = this.state.units.filter(u => u.team === 'enemy' && this.camp(u).id === camp.id);
      if (!camp.cleared && units.every(u => u.life === 'defeated')) {
        camp.cleared = camp.discovered = true;
        camp.respawnAt = config.repeat ? this.economy.state.seconds + config.repeat : 0;
      }
      if (camp.cleared && !camp.rewardGranted) {
        camp.rewardGranted = true;
        this.state.rewardGoods.push(...this.economy.dropReward(config, config.reward));
      }
      if (camp.cleared && config.repeat && this.economy.state.seconds >= camp.respawnAt
        && ![...this.civilians().map(n => n.position), ...Object.values(this.economy.state.residents).map(r => r.position), ...this.state.units.filter(u => u.team === 'home').map(u => u.position)]
          .some(p => distance(p, config) < config.leash + 8)
        && !this.economy.state.sites.some(s => distance(s, config) < config.leash + 8)) {
        // Patrol routes only. Captured construction regions never repopulate.
        camp.cleared = camp.rewardGranted = false; camp.cycle++;
        for (const u of units) { u.hp = fighterStats(u).hp; u.life = 'active'; u.diedAt = undefined; u.order = 'guard'; u.position = { ...u.home }; u.cooldown = 0; this.economy.state.vitals[u.id].stamina = 100; this.economy.state.vitals[u.id].hurtUntil = 0; }
      }
    }
    this.state.discovered = this.state.camps.some(c => c.discovered);
    this.state.cleared = this.state.camps.every(c => c.cleared);
    this.state.rewardGranted = this.state.cleared;
    this.state.rewardGoods = this.state.rewardGoods.filter(id => this.economy.state.goods.some(g => g.id === id));
  }
}

/** Strict fixed-unit and external-target save validation. Reject malformed state instead of silently healing,
 * resetting cooldowns, or minting another outpost reward. */
export function decodeCombat(raw: CombatState, threats: readonly Fighter[] = []): CombatState {
  const initial = initialCombat();
  const opponents = [...initial.units, ...threats, ...RESIDENTS.filter(r => !initial.units.some(u => u.id === r.id)).map(r => ({ id: r.id, team: 'home' as const }))];
  const num = (x: number, max = 1e9) => Number.isFinite(x) && x >= 0 && x <= max;
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= WORLD_BOUNDS.maxX && Math.abs(p.z) <= WORLD_BOUNDS.maxZ;
  if (!raw || !Array.isArray(raw.units) || raw.units.length !== initial.units.length || !Array.isArray(raw.projectiles) || raw.projectiles.length > 20
    || !Number.isSafeInteger(raw.nextAttack) || raw.nextAttack < 1 || typeof raw.discovered !== 'boolean' || typeof raw.cleared !== 'boolean'
    || typeof raw.rewardGranted !== 'boolean' || raw.rewardGranted !== raw.cleared || !Array.isArray(raw.rewardGoods) || raw.rewardGoods.length > 1000
    || new Set(raw.rewardGoods).size !== raw.rewardGoods.length || !raw.rewardGoods.every(id => /^goods-\d+$/.test(id))) throw new Error('战斗存档无效');
  if (!Array.isArray(raw.camps) || raw.camps.length !== ENCOUNTERS.length || new Set(raw.camps.map(c => c.id)).size !== ENCOUNTERS.length
    || raw.camps.some(c => !ENCOUNTERS.some(d => d.id === c.id) || typeof c.cleared !== 'boolean' || typeof c.discovered !== 'boolean'
      || c.rewardGranted !== c.cleared || !num(c.respawnAt, 1e12) || !Number.isSafeInteger(c.cycle) || c.cycle < 0)) throw new Error('区域存档无效');
  for (const template of initial.units) {
    const units = raw.units.filter(u => u.id === template.id), u = units[0];
    if (units.length !== 1 || u.role !== template.role || u.team !== template.team || !point(u.position) || !point(u.home)
      || distance(u.home, template.home) > .001 || !num(u.hp, fighterStats(u).hp) || !num(u.cooldown, 8) || !Number.isFinite(u.facing) || !['active', 'defeated'].includes(u.life)
      || !['guard', 'move', 'attack', 'retreat', 'hold', 'rest'].includes(u.order) || u.goal && !point(u.goal)
      || u.diedAt !== undefined && (!num(u.diedAt, 1e12) || u.life !== 'defeated')
      || u.defendFrom && !point(u.defendFrom) || u.hurtAt !== undefined && !num(u.hurtAt, 1e12)
      || u.target && !opponents.some(t => t.id === u.target && t.team !== u.team)
      || (u.life === 'active') !== (u.hp > 0) || u.team === 'enemy' && !['active', 'defeated'].includes(u.life)
      || !Array.isArray(u.route) || u.route.length > 1000 || !u.route.every(point)) throw new Error('战斗人物存档无效');
    if (u.attack && (!Number.isSafeInteger(u.attack.id) || u.attack.id < 1 || u.attack.id >= raw.nextAttack
      || !num(u.attack.elapsed, 3) || typeof u.attack.released !== 'boolean' || !opponents.some(t => t.id === u.attack!.target && t.team !== u.team))) throw new Error('攻击存档无效');
    if (u.life === 'defeated') { u.order = 'hold'; u.goal = undefined; u.target = undefined; u.attack = undefined; u.route = []; }
    u.navigation = createRouteState(); u.planIn = 0; u.speed = 0;
  }
  if (raw.cleared !== raw.camps.every(c => c.cleared) || raw.camps.some(c => c.cleared !== raw.units.filter(u => ENEMIES.find(r => r.id === u.id)?.camp === c.id).every(u => u.life === 'defeated'))) throw new Error('据点存档不一致');
  const ids = new Set<number>();
  for (const p of raw.projectiles) {
    const source = raw.units.find(u => u.id === p.source), target = opponents.find(u => u.id === p.target);
    if (!source || !target || source.team === target.team || !point(p.from) || !point(p.to) || !num(p.elapsed, 3) || !num(p.duration, 3)
      || p.duration <= 0 || p.elapsed >= p.duration || !num(p.damage, 100) || !Number.isSafeInteger(p.id) || p.id < 1 || p.id >= raw.nextAttack || ids.has(p.id)) throw new Error('投射物存档无效');
    ids.add(p.id);
  }
  return structuredClone(raw);
}
