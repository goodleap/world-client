import { BODY_RADIUS } from './body-shape.ts';
import { OUTPOST, ENCOUNTERS } from './combat-config.ts';
import { WORLD_BOUNDS, OBSTACLES, LANDSCAPE } from './world-data.ts';
import { isBlocked, type Obstacle, type Point } from './movement.ts';
import type { WanderSettings } from './wander.ts';

export type ResidentRole = 'farmer' | 'infantry' | 'archer' | 'cavalry' | 'dog';
export type ResidentEffect = 'leader';
export interface ResidentDefinition {
  id: string; role: ResidentRole; name: string; spawn: Point; home: Point;
  areaRadius: number; bodyRadius: number; speed: number; labelHeight: number;
  effects?: readonly ResidentEffect[];
  camp?: string; variant?: 'heavy' | 'patrol';
}

// Runtime human tempo; authored strides and economy clocks stay unchanged.
export const HUMAN_SPEED_MULTIPLIER = 2;

export const RESIDENTS: readonly ResidentDefinition[] = [
  { id: 'farmer', role: 'farmer', name: '农民', spawn: { x: 1.8, z: -2.3 }, home: { x: 1.8, z: -2 }, areaRadius: 3.6, bodyRadius: BODY_RADIUS.farmer, speed: 1.15, labelHeight: 2.35 },
  { id: 'farmer-2', role: 'farmer', name: '农民二', spawn: { x: 0, z: -.8 }, home: { x: 0, z: -.8 }, areaRadius: 3.6, bodyRadius: BODY_RADIUS.farmer, speed: 1.15, labelHeight: 2.35 },
  { id: 'infantry', role: 'infantry', name: '步兵', spawn: { x: 0, z: 1.2 }, home: { x: 0, z: 1.2 }, areaRadius: 4.2, bodyRadius: BODY_RADIUS.infantry, speed: 1.1, labelHeight: 2.4 },
  { id: 'archer', role: 'archer', name: '弓兵', spawn: { x: -2.6, z: -7.4 }, home: { x: -2.2, z: -7.2 }, areaRadius: 3.5, bodyRadius: BODY_RADIUS.archer, speed: 1.35, labelHeight: 2.15 },
  { id: 'cavalry', role: 'cavalry', name: '骑兵', spawn: { x: -4, z: -4 }, home: { x: -4, z: -4 }, areaRadius: 4.0, bodyRadius: BODY_RADIUS.cavalry, speed: 1.6, labelHeight: 2.95 },
  { id: 'dog', role: 'dog', name: '田园犬', spawn: { x: -1.6, z: -5.8 }, home: { x: -0.5, z: -5.5 }, areaRadius: 4.7, bodyRadius: BODY_RADIUS.dog, speed: 1.55, labelHeight: 1.65 },
  { id: 'farmer-leader', role: 'farmer', name: '农民·领头', effects: ['leader'], spawn: { x: 0, z: -3.8 }, home: { x: 0, z: -3.8 }, areaRadius: 3.6, bodyRadius: BODY_RADIUS.farmer, speed: 1.15, labelHeight: 2.35 },
];

// Deterministic camp slots avoid actual terrain/resources and each other.
const campSolids:Obstacle[]=[...OBSTACLES,...[...LANDSCAPE.rocks,...LANDSCAPE.iron].map(p=>({kind:'circle' as const,...p,radius:.85*p.scale})),
  ...LANDSCAPE.forage.map(p=>({kind:'circle' as const,...p,radius:.65}))];
function campSlots(c:typeof ENCOUNTERS[number]):Point[]{
  const count=c.members??0,slots:Point[]=[],choices:Point[]=[];
  for(let z=-4;z<=4;z++)for(let x=-4;x<=4;x++)choices.push({x:c.x+x*1.65,z:c.z+z*1.65});
  choices.sort((a,b)=>Math.hypot(a.x-c.x,a.z-c.z)-Math.hypot(b.x-c.x,b.z-c.z)||b.z-a.z||a.x-b.x);
  for(const p of choices)if(slots.length<count&&!isBlocked(p,.4,campSolids)&&p.x>WORLD_BOUNDS.minX+1&&p.x<WORLD_BOUNDS.maxX-1&&p.z>WORLD_BOUNDS.minZ+1&&p.z<WORLD_BOUNDS.maxZ-1)slots.push(p);
  if(slots.length<count)throw new Error(`营地 ${c.id} 没有足够安全出生点`);
  return slots.sort((a,b)=>b.z-a.z||a.x-b.x);
}
const campSpawns=new Map(ENCOUNTERS.filter(c=>c.members).map(c=>[c.id,campSlots(c)]));
const campArcher=(c:typeof ENCOUNTERS[number],i:number)=>!!c.members&&i>=c.members-Math.ceil(c.members*.3);

/** Same shared infantry/archer assets; allegiance is gameplay data. */
export const ENEMIES: readonly ResidentDefinition[] = [
  { id: 'enemy-guard', role: 'infantry', camp: 'quarry', name: '矿谷守卫', spawn: { x: OUTPOST.x + 2, z: OUTPOST.z + 1 }, home: { x: OUTPOST.x + 2, z: OUTPOST.z + 1 }, areaRadius: 0, bodyRadius: BODY_RADIUS.infantry, speed: 1.1, labelHeight: 2.4 },
  { id: 'enemy-sentry', role: 'infantry', camp: 'quarry', name: '矿谷哨兵', spawn: { x: OUTPOST.x - 2, z: OUTPOST.z + 1 }, home: { x: OUTPOST.x - 2, z: OUTPOST.z + 1 }, areaRadius: 0, bodyRadius: BODY_RADIUS.infantry, speed: 1.1, labelHeight: 2.4 },
  { id: 'enemy-archer', role: 'archer', camp: 'quarry', name: '矿谷弓手', spawn: { x: OUTPOST.x, z: OUTPOST.z - 2 }, home: { x: OUTPOST.x, z: OUTPOST.z - 2 }, areaRadius: 0, bodyRadius: BODY_RADIUS.infantry, speed: 1, labelHeight: 2.15 },
  ...ENCOUNTERS.filter(c => c.id !== 'quarry').flatMap(c => Array.from({ length: c.members ?? (c.id === 'pass' ? 3 : 2) }, (_, i): ResidentDefinition => ({
    id: `enemy-${c.id}-${i}`, role: c.members ? campArcher(c,i)?'archer':'infantry' : c.id === 'pass' && i > 0 ? 'archer' : 'infantry', camp: c.id,
    variant: (c.members?i<(c.members>=12?2:1):c.id === 'pass' && i === 0) ? 'heavy' : c.id === 'patrol' ? 'patrol' : undefined,
    name: c.members?`${c.name.replace(/营地|据点|营寨/,'')}${i<(c.members>=12?2:1)?'重卫':campArcher(c,i)?'弓手':'守卫'}`:c.id === 'pass' ? i === 0 ? '山口重卫' : '山口弓手' : c.id === 'patrol' ? '巡逻兵' : c.name,
    spawn: c.members?{...campSpawns.get(c.id)![i]}:{ x: c.x + (i - 1) * (c.id === 'patrol' ? .7 : 2), z: c.z + (i ? -2 : 1) },
    home: c.members?{...campSpawns.get(c.id)![i]}:{ x: c.x + (i - 1) * (c.id === 'patrol' ? .7 : 2), z: c.z + (i ? -2 : 1) },
    areaRadius: 0, bodyRadius: BODY_RADIUS.infantry, speed: 1, labelHeight: 2.4,
  }))),
];

/** Leadership is an additional effect; the ordinary role still owns work,
 * equipment, animation and movement capabilities. */
export const roleLeader = (role: ResidentRole) => RESIDENTS.find(resident => resident.role === role && resident.effects?.includes('leader'));
export function unitRole(id: string): ResidentRole | undefined {
  const fixed = RESIDENTS.find(r => r.id === id) ?? ENEMIES.find(r => r.id === id);
  if (fixed) return fixed.role;
  return /^(?:recruit|enemy-raid)-(farmer|infantry|archer|cavalry|dog)-\d+(?:-\d+)?$/.exec(id)?.[1] as ResidentRole | undefined;
}
export const canResidentWork = (id: string) => !id.startsWith('enemy-') && unitRole(id) === 'farmer';
/** Personal fire supplies may be carried by every friendly human, not animals. */
export const canResidentSupply = (id: string) => !id.startsWith('enemy-') && !!unitRole(id) && unitRole(id) !== 'dog';

export function newResident(role: ResidentRole, id: string, spawn: Point): ResidentDefinition {
  const template = RESIDENTS.find(r => r.role === role)!;
  const names = { farmer: '农民', infantry: '步兵', archer: '弓兵', cavalry: '骑兵', dog: '田园犬' };
  return { ...template, effects: undefined, id, name: `${names[role]}${id.split('-').at(-1)}`,
    spawn: { ...spawn }, home: { ...spawn } };
}

// Residents stay out of the planted beds as well as the same solids used by the player.
export const RESIDENT_OBSTACLES: readonly Obstacle[] = [
  ...OBSTACLES,
  { kind: 'box', x: 5.07, z: -5.91, halfWidth: 3.38, halfDepth: 2.54 },
];

export function wanderSettings(resident: ResidentDefinition): WanderSettings {
  return {
    home: resident.home, areaRadius: resident.areaRadius, bodyRadius: resident.bodyRadius,
    speed: resident.speed * (resident.role === 'dog' ? 1 : HUMAN_SPEED_MULTIPLIER), bounds: WORLD_BOUNDS,
  };
}
