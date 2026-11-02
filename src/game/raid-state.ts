import type { Fighter } from './combat.ts';
import { COMBAT_CONFIG } from './combat-config.ts';
import { createRouteState } from './route-following.ts';
import { WORLD_BOUNDS } from './world-data.ts';
import { RESIDENTS } from './resident-data.ts';
import type { Point } from './movement.ts';

/** Trial pacing; game time only. No wall clock or refresh-time random rolls. */
export const RAID_CONFIG = { protection: 240, intervalMin: 240, intervalMax: 420, maxWolves: 5,
  duration: 120, fearRadius: 6, fearSeconds: 3, acquire: 11, aidRadius: 10, loot: 2, feedSeconds: 1.1 };
export interface Wolf extends Fighter {
  role: 'wolf'; mode: 'approach' | 'hunt' | 'feed' | 'flee' | 'gone';
  fear: number; carried: number; settled: boolean; feeding: number; foodTarget?: string; gait: number;
}
export interface RaidState {
  seed: number; wave: number; phase: 'peace' | 'raid'; nextAt: number; startedAt: number;
  notice: string; noticeUntil: number; origin?: Point; wolves: Wolf[];
  evading: Record<string, { safeAt: number; planAt: number }>;
}
export function initialRaids(seconds = 0, seed = 0x59a31b): RaidState {
  return { seed: seed >>> 0 || 1, wave: 0, phase: 'peace', nextAt: seconds + RAID_CONFIG.protection,
    startedAt: 0, notice: '', noticeUntil: 0, wolves: [], evading: {} };
}
export function raidRandom(state: RaidState) {
  let x = state.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; state.seed = x >>> 0;
  return state.seed / 0x100000000;
}
export function newWolf(id: string, position: Point): Wolf {
  return { id, role: 'wolf', team: 'enemy', position: { ...position }, home: { ...position }, hp: COMBAT_CONFIG.wolf.hp,
    life: 'active', order: 'guard', facing: 0, speed: 0, cooldown: 0, route: [], navigation: createRouteState(), planIn: 0,
    mode: 'approach', fear: 0, carried: 0, settled: false, feeding: 0, gait: 0 };
}
export function decodeRaids(raw: RaidState, nextAttack: number): RaidState {
  const n = (x: number, max = 1e12) => Number.isFinite(x) && x >= 0 && x <= max;
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && p.x >= WORLD_BOUNDS.minX && p.x <= WORLD_BOUNDS.maxX && p.z >= WORLD_BOUNDS.minZ && p.z <= WORLD_BOUNDS.maxZ;
  if (!raw || !Number.isInteger(raw.seed) || !n(raw.seed, 0xffffffff) || !raw.seed || !Number.isSafeInteger(raw.wave) || !n(raw.wave)
    || !['peace', 'raid'].includes(raw.phase) || !n(raw.nextAt) || !n(raw.startedAt) || !n(raw.noticeUntil)
    || typeof raw.notice !== 'string' || raw.notice.length > 100 || raw.origin && !point(raw.origin)
    || !Array.isArray(raw.wolves) || raw.wolves.length > RAID_CONFIG.maxWolves || new Set(raw.wolves.map(w => w.id)).size !== raw.wolves.length
    || !raw.evading || typeof raw.evading !== 'object') throw new Error('狼群袭击存档无效');
  for (const [id, e] of Object.entries(raw.evading)) {
    if (!RESIDENTS.some(r => r.id === id) || !e || !n(e.safeAt) || !n(e.planAt)) throw new Error('避险存档无效');
  }
  const attackIds = new Set<number>();
  for (const w of raw.wolves) {
    if (!w || !new RegExp(`^wolf-${raw.wave}-[0-4]$`).test(w.id) || w.role !== 'wolf' || w.team !== 'enemy'
      || !point(w.position) || !point(w.home) || !n(w.hp, COMBAT_CONFIG.wolf.hp) || !['active', 'defeated'].includes(w.life)
      || (w.life === 'active') !== (w.hp > 0) || !['approach', 'hunt', 'feed', 'flee', 'gone'].includes(w.mode)
      || !n(w.cooldown, 2) || !n(w.fear, 10) || !n(w.feeding, 2) || !n(w.gait, 1) || ![0, 1].includes(w.carried)
      || w.settled && w.life !== 'defeated'
      || typeof w.settled !== 'boolean' || !Number.isFinite(w.facing) || w.hurtAt !== undefined && !n(w.hurtAt)
      || w.target && !RESIDENTS.some(r => r.id === w.target) || w.foodTarget && !/^site-\d+$/.test(w.foodTarget)
      || !Array.isArray(w.route) || w.route.length > 1000 || !w.route.every(point)) throw new Error('灰狼存档无效');
    if (w.attack && (!Number.isSafeInteger(w.attack.id) || w.attack.id < 1 || w.attack.id >= nextAttack || attackIds.has(w.attack.id)
      || !Number.isSafeInteger(nextAttack) || !n(w.attack.elapsed, .6) || typeof w.attack.released !== 'boolean' || !RESIDENTS.some(r => r.id === w.attack!.target))) throw new Error('撕咬存档无效');
    if (w.attack) attackIds.add(w.attack.id);
    w.navigation = createRouteState(); w.speed = 0; w.planIn = .2;
  }
  if (raw.phase === 'raid' && (!raw.origin || !raw.wolves.length) || raw.phase === 'peace' && raw.wolves.some(w => w.life === 'active' ? w.mode !== 'gone' : !w.settled)) throw new Error('袭击阶段无效');
  return structuredClone(raw);
}
