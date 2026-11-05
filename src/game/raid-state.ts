import type { Fighter } from './combat.ts';
import { MAP_DEVELOPMENT } from './opening-profile.ts';
import { COMBAT_CONFIG } from './combat-config.ts';
import { createRouteState } from './route-following.ts';
import { WORLD_BOUNDS } from './world-data.ts';
import { RESIDENTS } from './resident-data.ts';
import type { ResidentDefinition } from './resident-data.ts';
import type { Point } from './movement.ts';

/** Trial pacing; game time only. No wall clock or refresh-time random rolls. */
export const RAID_CONFIG = { protection: 60, intervalMin: 45, intervalMax: 75, maxWolves: 6, maxSoldiers: 12, warning: 8,
  duration: 120, fearRadius: 6, fearSeconds: 3, acquire: 11, chase: 17, aidRadius: 10, loot: 2, feedSeconds: 1.1 };
export const WILD_WOLF_SPAWNS: readonly Point[] = MAP_DEVELOPMENT?[]:[
  { x: -48, z: -1 }, { x: -48, z: 2 },
  { x: -49, z: 40 }, { x: -49, z: 43 },
  { x: -33, z: -46 }, { x: -33, z: -43 },
];
export interface Wolf extends Fighter {
  role: 'wolf'; mode: 'approach' | 'hunt' | 'feed' | 'flee' | 'gone';
  fear: number; carried: number; settled: boolean; feeding: number; foodTarget?: string; gait: number;
}
export interface RaidState {
  seed: number; wave: number; phase: 'peace' | 'raid'; nextAt: number; startedAt: number;
  notice: string; noticeUntil: number; origin?: Point; wolves: Wolf[]; wildWolves: Wolf[];
  evading: Record<string, { planAt: number; attacker?:string }>;
  soldiers: string[]; warningAt: number; pendingCount:number; pendingOrigin?: Point;
}
export function initialRaids(seconds = 0, seed = 0x59a31b): RaidState {
  return { seed: seed >>> 0 || 1, wave: 0, phase: 'peace', nextAt: seconds + RAID_CONFIG.protection,
    startedAt: 0, notice: '', noticeUntil: 0, wolves: [], wildWolves: WILD_WOLF_SPAWNS.map((p, i) => newWolf(`wolf-wild-${i}`, p)), evading: {},soldiers:[],warningAt:0,pendingCount:0 };
}
export const allWolves = (state: RaidState) => [...state.wolves, ...state.wildWolves];
export function raidRandom(state: RaidState) {
  let x = state.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; state.seed = x >>> 0;
  return state.seed / 0x100000000;
}
export function newWolf(id: string, position: Point): Wolf {
  return { id, role: 'wolf', team: 'enemy', position: { ...position }, home: { ...position }, hp: COMBAT_CONFIG.wolf.hp, experience: 0,
    life: 'active', order: 'guard', facing: 0, speed: 0, cooldown: 0, route: [], navigation: createRouteState(), planIn: 0,
    mode: 'approach', fear: 0, carried: 0, settled: false, feeding: 0, gait: 0 };
}
export function decodeRaids(raw: RaidState, nextAttack: number,residents:readonly ResidentDefinition[]=RESIDENTS,towerIds:readonly string[]=[]): RaidState {
  const n = (x: number, max = 1e12) => Number.isFinite(x) && x >= 0 && x <= max;
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && p.x >= WORLD_BOUNDS.minX && p.x <= WORLD_BOUNDS.maxX && p.z >= WORLD_BOUNDS.minZ && p.z <= WORLD_BOUNDS.maxZ;
  if (!raw || !Number.isInteger(raw.seed) || !n(raw.seed, 0xffffffff) || !raw.seed || !Number.isSafeInteger(raw.wave) || !n(raw.wave)
    || !['peace', 'raid'].includes(raw.phase) || !n(raw.nextAt) || !n(raw.startedAt) || !n(raw.noticeUntil)
    || typeof raw.notice !== 'string' || raw.notice.length > 100 || raw.origin && !point(raw.origin)
    || !Array.isArray(raw.wolves) || raw.wolves.length > RAID_CONFIG.maxWolves || new Set(raw.wolves.map(w => w.id)).size !== raw.wolves.length
    || !Array.isArray(raw.wildWolves) || raw.wildWolves.length !== WILD_WOLF_SPAWNS.length
    || raw.wildWolves.some((w, i) => w.id !== `wolf-wild-${i}` || !point(w.home) || Math.hypot(w.home.x - WILD_WOLF_SPAWNS[i].x, w.home.z - WILD_WOLF_SPAWNS[i].z) > .001 || w.mode === 'gone')
    || !Array.isArray(raw.soldiers)||raw.soldiers.length>RAID_CONFIG.maxSoldiers||new Set(raw.soldiers).size!==raw.soldiers.length||raw.soldiers.some(id=>!new RegExp(`^enemy-raid-(infantry|archer|cavalry)-${raw.wave}-(?:[0-9]|1[01])$`).test(id))
    ||!n(raw.warningAt)||!Number.isInteger(raw.pendingCount)||!n(raw.pendingCount,raw.wave%2 ? RAID_CONFIG.maxSoldiers : RAID_CONFIG.maxWolves)||raw.pendingOrigin&&(!point(raw.pendingOrigin)||!raw.pendingCount)
    || !raw.evading || typeof raw.evading !== 'object') throw new Error('狼群袭击存档无效');
  for (const [id, e] of Object.entries(raw.evading)) {
    if (!residents.some(r => r.id === id) || !e || !n(e.planAt) || e.attacker!==undefined&&(typeof e.attacker!=='string'||e.attacker.length>100)) throw new Error('避险存档无效');
  }
  const targetIds=new Set([...residents.map(r=>r.id),...towerIds]);
  const attackIds = new Set<number>();
  for (const w of allWolves(raw)) {
    if (!w || !(raw.wildWolves.includes(w) || new RegExp(`^wolf-${raw.wave}-[0-5]$`).test(w.id)) || w.role !== 'wolf' || w.team !== 'enemy'
      || !point(w.position) || !point(w.home) || !n(w.hp, COMBAT_CONFIG.wolf.hp) || !['active', 'defeated'].includes(w.life)
      || (w.life === 'active') !== (w.hp > 0) || w.experience !== 0 || !['approach', 'hunt', 'feed', 'flee', 'gone'].includes(w.mode)
      || !n(w.cooldown, 2) || !n(w.fear, 10) || !n(w.feeding, 2) || !n(w.gait, 1) || ![0, 1].includes(w.carried)
      || w.diedAt !== undefined && (!n(w.diedAt) || w.life !== 'defeated')
      || w.provoked && (!point(w.provoked.from) || !n(w.provoked.leash,400))
      || w.targetSwitchIn !== undefined && !n(w.targetSwitchIn, COMBAT_CONFIG.targetSwitchSeconds)
      || w.defendFrom && !point(w.defendFrom)
      || w.settled && w.life !== 'defeated'
      || typeof w.settled !== 'boolean' || !Number.isFinite(w.facing) || w.hurtAt !== undefined && !n(w.hurtAt)
      || w.target && !targetIds.has(w.target) || w.foodTarget && !/^site-\d+$/.test(w.foodTarget)
      || !Array.isArray(w.route) || w.route.length > 1000 || !w.route.every(point)) throw new Error('灰狼存档无效');
    if (w.attack && (!Number.isSafeInteger(w.attack.id) || w.attack.id < 1 || w.attack.id >= nextAttack || attackIds.has(w.attack.id)
      || !Number.isSafeInteger(nextAttack) || !n(w.attack.elapsed, .6) || typeof w.attack.released !== 'boolean' || !targetIds.has(w.attack!.target))) throw new Error('撕咬存档无效');
    if (w.attack) attackIds.add(w.attack.id);
    w.navigation = createRouteState(); w.speed = 0; w.planIn = .2;
  }
  if (raw.phase === 'raid' && (!raw.origin || !raw.wolves.length&&!raw.soldiers.length) || raw.phase === 'peace' && raw.wolves.some(w => w.life === 'active' ? w.mode !== 'gone' : !w.settled)) throw new Error('袭击阶段无效');
  return structuredClone(raw);
}
