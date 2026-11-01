import type { Point, Obstacle } from './movement.ts';
import { WORLD_BOUNDS } from './world-data.ts';
import { RESIDENTS, ENEMIES } from './resident-data.ts';
import { segmentIsClear } from './wander.ts';
import { createRouteState, resetRouteState, stepRoute } from './route-following.ts';
import type { RouteState, Neighbour } from './route-following.ts';
import { planMoveDestination, planWorkApproach } from './work-navigation.ts';
import { COMBAT_CONFIG as C, OUTPOST } from './combat-config.ts';
import type { CombatRole } from './combat-config.ts';
import type { Economy } from './economy.ts';

export type CombatOrder = 'guard' | 'move' | 'attack' | 'retreat' | 'hold';
export type CombatLife = 'active' | 'returning' | 'recovering' | 'defeated';
export interface Fighter {
  id: string; role: CombatRole; team: 'home' | 'enemy'; position: Point; home: Point;
  hp: number; life: CombatLife; order: CombatOrder; goal?: Point; target?: string;
  facing: number; speed: number; cooldown: number; recovery: number; paid: boolean;
  attack?: { id: number; target: string; elapsed: number; released: boolean };
  route: Point[]; navigation: RouteState; planIn: number;
}
export interface Projectile { id: number; source: string; target: string; from: Point; to: Point; elapsed: number; duration: number; damage: number }
export interface CombatState { units: Fighter[]; projectiles: Projectile[]; nextAttack: number; discovered: boolean; cleared: boolean; rewardGranted: boolean; rewardGoods: string[] }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export function fighterStats(u: Pick<Fighter, 'role' | 'team'>) {
  return u.team === 'home' ? C[u.role] : u.role === 'infantry' ? C.enemyMelee : C.enemyArcher;
}
export function initialCombat(): CombatState {
  return { nextAttack: 1, discovered: false, cleared: false, rewardGranted: false, rewardGoods: [], projectiles: [],
    units: [...RESIDENTS.filter(r => r.id === 'infantry' || r.id === 'archer'), ...ENEMIES].map(r => {
      const role = r.role as CombatRole, team = r.id.startsWith('enemy-') ? 'enemy' as const : 'home' as const;
      return { id: r.id, role, team, position: { ...r.spawn }, home: { ...r.home }, hp: fighterStats({ role, team }).hp,
        life: 'active', order: 'guard', facing: Math.PI, speed: 0, cooldown: 0, recovery: 0, paid: false,
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
  constructor(state: CombatState, economy: Economy, solids: () => readonly Obstacle[], civilians: () => Neighbour[] = () => []) {
    this.state = state; this.economy = economy; this.solids = solids; this.civilians = civilians;
  }
  unit(id: string) { return this.state.units.find(u => u.id === id); }
  controllable(ids: readonly string[]) { return this.state.units.filter(u => ids.includes(u.id) && u.team === 'home' && u.life === 'active'); }
  private neighbours(u: Fighter) {
    return [...this.civilians(), ...this.state.units.filter(n => n !== u && n.life !== 'defeated').map(n => ({ id: n.id, position: n.position, radius: .4,
      moving: n.speed > .08, purposeful: !!n.route.length, waiting: n.navigation.waiting }))];
  }
  private reservations(u: Fighter) {
    return this.neighbours(u).map(n => ({ ...n, destination: this.unit(n.id)?.route.at(-1) }));
  }
  private stop(u: Fighter) { u.route = []; u.speed = 0; resetRouteState(u.navigation); }
  move(ids: readonly string[], point: Point, retreat = false) {
    let accepted = 0;
    for (const u of this.controllable(ids)) {
      const goal = retreat ? u.home : point;
      const path = planMoveDestination(u.position, goal, .4, WORLD_BOUNDS, this.solids(), this.reservations(u));
      if (!path) continue;
      // Cancelling the windup never refunds the committed cooldown.
      u.attack = undefined; u.target = undefined; u.order = retreat ? 'retreat' : 'move';
      u.goal = { ...path.at(-1) ?? goal }; u.route = path; u.planIn = 0; resetRouteState(u.navigation); accepted++;
    }
    return accepted;
  }
  attack(ids: readonly string[], target: string) {
    const foe = this.unit(target); if (!foe || foe.team !== 'enemy' || foe.life !== 'active') return 0;
    let accepted = 0;
    for (const u of this.controllable(ids)) {
      // Repeated attack clicks do not restart or accelerate an attack.
      u.order = 'attack'; u.target = foe.id; u.goal = undefined; accepted++;
    }
    return accepted;
  }
  guard(ids: readonly string[]) {
    for (const u of this.controllable(ids)) { u.order = 'guard'; u.goal = undefined; u.target = undefined; u.attack = undefined; this.stop(u); }
  }
  private damage(target: Fighter, amount: number) {
    if (target.life !== 'active') return;
    target.hp = Math.max(0, target.hp - Math.max(1, amount - fighterStats(target).armor));
    if (target.hp) return;
    this.stop(target); target.attack = undefined; target.target = undefined; target.goal = undefined;
    target.life = target.team === 'home' ? 'returning' : 'defeated';
    target.order = 'hold'; target.planIn = 0; target.recovery = 0; target.paid = false;
  }
  private travel(u: Fighter, dt: number, speed: number) {
    const previous = u.position;
    const step = stepRoute(u.id, u.position, u.route, u.navigation, dt, speed, .4, WORLD_BOUNDS, this.solids(), this.neighbours(u));
    u.position = step.position; u.speed = distance(previous, u.position) / dt;
    if (u.speed > .01) u.facing = Math.atan2(u.position.x - previous.x, u.position.z - previous.z);
    if (step.unreachable) { this.stop(u); u.planIn = 1; }
  }
  private plan(u: Fighter, points: Point[]) {
    u.planIn = .8;
    u.route = planWorkApproach(u.position, points, .4, WORLD_BOUNDS, this.solids(), this.reservations(u)) ?? [];
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
      const target = this.unit(shot.target);
      // A shot lands at its committed point. A moving target can dodge it.
      if (target && distance(target.position, shot.to) < .8 && segmentIsClear(shot.from, shot.to, .05, WORLD_BOUNDS, this.solids())) this.damage(target, shot.damage);
    }
    for (const u of this.state.units) {
      const stats = fighterStats(u);
      u.speed = 0; u.cooldown = Math.max(0, u.cooldown - dt); u.planIn = Math.max(0, u.planIn - dt);
      if (u.life === 'defeated') continue;
      if (u.team === 'home' && distance(u.position, OUTPOST) < OUTPOST.discover) this.state.discovered = true;
      if (u.life === 'returning') {
        if (distance(u.position, u.home) < 1.6) { u.life = 'recovering'; this.stop(u); }
        else {
          if (!u.route.length && u.planIn <= 0) this.plan(u, [u.home, { x: u.home.x + 1, z: u.home.z }, { x: u.home.x - 1, z: u.home.z }]);
          this.travel(u, dt, stats.speed * .65);
        }
        continue;
      }
      if (u.life === 'recovering') {
        if (!u.paid && this.economy.available().food >= C.recoveryFood) {
          this.economy.state.inventory.food -= C.recoveryFood; this.economy.revision++; u.paid = true;
        }
        if (u.paid) u.recovery = Math.min(C.recoverySeconds, u.recovery + dt);
        if (u.recovery >= C.recoverySeconds) { u.hp = stats.hp; u.life = 'active'; u.order = 'hold'; }
        continue;
      }
      if (u.order === 'move' || u.order === 'retreat' || u.team === 'enemy' && u.order === 'hold') {
        if (u.goal && distance(u.position, u.goal) > .15) {
          if (!u.route.length && u.planIn <= 0) this.plan(u, [u.goal]);
          this.travel(u, dt, stats.speed);
        } else { this.stop(u); u.goal = undefined; u.order = u.team === 'enemy' ? 'guard' : u.order === 'retreat' ? 'hold' : 'guard'; }
        continue;
      }
      if (u.order === 'hold') continue;
      if (u.team === 'enemy' && (distance(u.position, OUTPOST) > OUTPOST.leash || u.target && distance(this.unit(u.target)!.position, OUTPOST) > OUTPOST.leash)) {
        u.order = 'hold'; u.goal = { ...u.home }; u.target = undefined; u.attack = undefined; this.stop(u); continue;
      }
      if (u.attack) {
        const action = u.attack; action.elapsed += dt;
        const target = this.unit(action.target);
        if (target) u.facing = Math.atan2(target.position.x - u.position.x, target.position.z - u.position.z);
        if (!action.released && action.elapsed >= stats.windup) {
          action.released = true;
          if (target?.life === 'active' && distance(u.position, target.position) <= stats.range + .15
            && segmentIsClear(u.position, target.position, .05, WORLD_BOUNDS, this.solids())) {
            if (u.role === 'infantry') this.damage(target, stats.attack);
            else this.state.projectiles.push({ id: action.id, source: u.id, target: target.id, from: { ...u.position }, to: { ...target.position },
              elapsed: 0, duration: distance(u.position, target.position) / C.projectileSpeed, damage: stats.attack });
          }
        }
        if (action.elapsed >= stats.windup + stats.recovery) u.attack = undefined;
        continue;
      }
      let target = u.target ? this.unit(u.target) : undefined;
      if (!target || target.life !== 'active' || target.team === u.team || u.order !== 'attack' && distance(u.position, target.position) > C.acquire + 3) {
        target = this.state.units.filter(t => t.team !== u.team && t.life === 'active' && distance(u.position, t.position) < C.acquire
          && (u.team === 'home' || distance(t.position, OUTPOST) <= OUTPOST.leash))
          .sort((a, b) => distance(u.position, a.position) - distance(u.position, b.position) || a.id.localeCompare(b.id))[0];
        u.target = target?.id;
        if (!target) { this.stop(u); if (u.order === 'attack') u.order = 'guard'; continue; }
      }
      const clear = segmentIsClear(u.position, target.position, .05, WORLD_BOUNDS, this.solids());
      if (distance(u.position, target.position) <= stats.range && clear) {
        this.stop(u); u.facing = Math.atan2(target.position.x - u.position.x, target.position.z - u.position.z);
        if (!u.cooldown) { u.cooldown = stats.interval; u.attack = { id: this.state.nextAttack++, target: target.id, elapsed: 0, released: false }; }
      } else {
        if (u.planIn <= 0) {
          const radius = stats.range * .8;
          const points = Array.from({ length: 12 }, (_, i) => ({ x: target!.position.x + Math.cos(i * Math.PI / 6) * radius,
            z: target!.position.z + Math.sin(i * Math.PI / 6) * radius }))
            .filter(p => segmentIsClear(p, target!.position, .05, WORLD_BOUNDS, this.solids()));
          this.plan(u, points);
        }
        this.travel(u, dt, stats.speed);
      }
    }
    if (!this.state.cleared && this.state.units.filter(u => u.team === 'enemy').every(u => u.life === 'defeated')) {
      this.state.cleared = true; this.state.discovered = true;
    }
    if (this.state.cleared && !this.state.rewardGranted) {
      this.state.rewardGranted = true;
      this.state.rewardGoods = this.economy.dropReward(OUTPOST, C.reward);
    }
  }
}

/** Strict v6 save validation. Reject malformed state instead of silently healing,
 * resetting cooldowns, or minting another outpost reward. */
export function decodeCombat(raw: CombatState): CombatState {
  const initial = initialCombat();
  const num = (x: number, max = 1e9) => Number.isFinite(x) && x >= 0 && x <= max;
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= WORLD_BOUNDS.maxX && Math.abs(p.z) <= WORLD_BOUNDS.maxZ;
  if (!raw || !Array.isArray(raw.units) || raw.units.length !== initial.units.length || !Array.isArray(raw.projectiles) || raw.projectiles.length > 20
    || !Number.isSafeInteger(raw.nextAttack) || raw.nextAttack < 1 || typeof raw.discovered !== 'boolean' || typeof raw.cleared !== 'boolean'
    || typeof raw.rewardGranted !== 'boolean' || raw.rewardGranted !== raw.cleared || !Array.isArray(raw.rewardGoods) || raw.rewardGoods.length !== (raw.rewardGranted ? 3 : 0)
    || new Set(raw.rewardGoods).size !== raw.rewardGoods.length || !raw.rewardGoods.every(id => /^goods-\d+$/.test(id))) throw new Error('战斗存档无效');
  for (const template of initial.units) {
    const units = raw.units.filter(u => u.id === template.id), u = units[0];
    if (units.length !== 1 || u.role !== template.role || u.team !== template.team || !point(u.position) || !point(u.home)
      || distance(u.home, template.home) > .001 || !num(u.hp, fighterStats(u).hp) || !num(u.cooldown, 3) || !num(u.recovery, C.recoverySeconds)
      || typeof u.paid !== 'boolean' || !Number.isFinite(u.facing) || !['active', 'returning', 'recovering', 'defeated'].includes(u.life)
      || !['guard', 'move', 'attack', 'retreat', 'hold'].includes(u.order) || u.goal && !point(u.goal)
      || u.target && !initial.units.some(t => t.id === u.target && t.team !== u.team)
      || (u.life === 'active') !== (u.hp > 0) || u.team === 'enemy' && !['active', 'defeated'].includes(u.life)
      || u.team === 'home' && u.life === 'defeated' || !Array.isArray(u.route) || u.route.length > 1000 || !u.route.every(point)) throw new Error('战斗人物存档无效');
    if (u.attack && (!Number.isSafeInteger(u.attack.id) || u.attack.id < 1 || u.attack.id >= raw.nextAttack
      || !num(u.attack.elapsed, 3) || typeof u.attack.released !== 'boolean' || !raw.units.some(t => t.id === u.attack!.target && t.team !== u.team))) throw new Error('攻击存档无效');
    u.navigation = createRouteState(); u.planIn = 0; u.speed = 0;
  }
  if (raw.cleared !== raw.units.filter(u => u.team === 'enemy').every(u => u.life === 'defeated')) throw new Error('据点存档不一致');
  const ids = new Set<number>();
  for (const p of raw.projectiles) {
    const source = raw.units.find(u => u.id === p.source), target = raw.units.find(u => u.id === p.target);
    if (!source || !target || source.team === target.team || !point(p.from) || !point(p.to) || !num(p.elapsed, 3) || !num(p.duration, 3)
      || p.duration <= 0 || p.elapsed >= p.duration || !num(p.damage, 100) || !Number.isSafeInteger(p.id) || p.id < 1 || p.id >= raw.nextAttack || ids.has(p.id)) throw new Error('投射物存档无效');
    ids.add(p.id);
  }
  return structuredClone(raw);
}
