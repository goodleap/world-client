import { OUTPOST, ENCOUNTERS } from './combat-config.ts';
import { WORLD_BOUNDS, OBSTACLES } from './world-data.ts';
import type { Obstacle, Point } from './movement.ts';
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
// Preserve the existing command-to-wander speed relationship.
export const COMMAND_RUN_SPEED_MULTIPLIER = 1.5;

export const RESIDENTS: readonly ResidentDefinition[] = [
  { id: 'farmer', role: 'farmer', name: '农民', spawn: { x: 1.8, z: -2.3 }, home: { x: 1.8, z: -2 }, areaRadius: 3.6, bodyRadius: 0.29, speed: 1.15, labelHeight: 2.35 },
  { id: 'farmer-2', role: 'farmer', name: '农民二', spawn: { x: 0, z: -.8 }, home: { x: 0, z: -.8 }, areaRadius: 3.6, bodyRadius: .29, speed: 1.15, labelHeight: 2.35 },
  { id: 'infantry', role: 'infantry', name: '步兵', spawn: { x: 0, z: 1.2 }, home: { x: 0, z: 1.2 }, areaRadius: 4.2, bodyRadius: 0.4, speed: 1.1, labelHeight: 2.4 },
  { id: 'archer', role: 'archer', name: '弓兵', spawn: { x: -2.6, z: -7.4 }, home: { x: -2.2, z: -7.2 }, areaRadius: 3.5, bodyRadius: 0.35, speed: 1.35, labelHeight: 2.15 },
  { id: 'cavalry', role: 'cavalry', name: '骑兵', spawn: { x: -4, z: -4 }, home: { x: -4, z: -4 }, areaRadius: 4.0, bodyRadius: 1.12, speed: 1.6, labelHeight: 2.95 },
  { id: 'dog', role: 'dog', name: '田园犬', spawn: { x: -1.6, z: -5.8 }, home: { x: -0.5, z: -5.5 }, areaRadius: 4.7, bodyRadius: 0.54, speed: 1.55, labelHeight: 1.35 },
  { id: 'farmer-leader', role: 'farmer', name: '农民·领头', effects: ['leader'], spawn: { x: 0, z: -3.8 }, home: { x: 0, z: -3.8 }, areaRadius: 3.6, bodyRadius: .29, speed: 1.15, labelHeight: 2.35 },
];

/** Same shared infantry/archer assets; allegiance is gameplay data. */
export const ENEMIES: readonly ResidentDefinition[] = [
  { id: 'enemy-guard', role: 'infantry', camp: 'quarry', name: '矿谷守卫', spawn: { x: OUTPOST.x + 2, z: OUTPOST.z + 1 }, home: { x: OUTPOST.x + 2, z: OUTPOST.z + 1 }, areaRadius: 0, bodyRadius: .4, speed: 1.1, labelHeight: 2.4 },
  { id: 'enemy-sentry', role: 'infantry', camp: 'quarry', name: '矿谷哨兵', spawn: { x: OUTPOST.x - 2, z: OUTPOST.z + 1 }, home: { x: OUTPOST.x - 2, z: OUTPOST.z + 1 }, areaRadius: 0, bodyRadius: .4, speed: 1.1, labelHeight: 2.4 },
  { id: 'enemy-archer', role: 'archer', camp: 'quarry', name: '矿谷弓手', spawn: { x: OUTPOST.x, z: OUTPOST.z - 2 }, home: { x: OUTPOST.x, z: OUTPOST.z - 2 }, areaRadius: 0, bodyRadius: .4, speed: 1, labelHeight: 2.15 },
  ...ENCOUNTERS.filter(c => c.id !== 'quarry').flatMap(c => Array.from({ length: c.id === 'pass' ? 3 : 2 }, (_, i): ResidentDefinition => ({
    id: `enemy-${c.id}-${i}`, role: c.id === 'pass' && i > 0 ? 'archer' : 'infantry', camp: c.id,
    variant: c.id === 'pass' && i === 0 ? 'heavy' : c.id === 'patrol' ? 'patrol' : undefined,
    name: c.id === 'pass' ? i === 0 ? '山口重卫' : '山口弓手' : '巡逻兵',
    spawn: { x: c.x + (i - 1) * (c.id === 'patrol' ? .7 : 2), z: c.z + (i ? -2 : 1) }, home: { x: c.x + (i - 1) * (c.id === 'patrol' ? .7 : 2), z: c.z + (i ? -2 : 1) },
    areaRadius: 0, bodyRadius: .4, speed: 1, labelHeight: 2.4,
  }))),
];

/** Leadership is an additional effect; the ordinary role still owns work,
 * equipment, animation and movement capabilities. */
export const roleLeader = (role: ResidentRole) => RESIDENTS.find(resident => resident.role === role && resident.effects?.includes('leader'));
export const canResidentWork = (id: string) => RESIDENTS.some(resident => resident.id === id && resident.role === 'farmer');
/** Personal fire supplies may be carried by every friendly human, not animals. */
export const canResidentSupply = (id: string) => RESIDENTS.some(resident => resident.id === id && resident.role !== 'dog');

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
