import { WORLD_BOUNDS, OBSTACLES } from './world-data.ts';
import type { Obstacle, Point } from './movement.ts';
import type { WanderSettings } from './wander.ts';

export type ResidentRole = 'farmer' | 'infantry' | 'archer' | 'cavalry' | 'dog' | 'base';
export interface ResidentDefinition {
  id: string; role: ResidentRole; name: string; spawn: Point; home: Point;
  areaRadius: number; bodyRadius: number; speed: number; labelHeight: number;
}

// Runtime human tempo; authored strides and economy clocks stay unchanged.
export const HUMAN_SPEED_MULTIPLIER = 2;
// Preserve the existing command-to-wander speed relationship.
export const COMMAND_RUN_SPEED_MULTIPLIER = 1.5;

export const RESIDENTS: readonly ResidentDefinition[] = [
  { id: 'farmer', role: 'farmer', name: '农民', spawn: { x: 1.8, z: -2.3 }, home: { x: 1.8, z: -2 }, areaRadius: 3.6, bodyRadius: 0.29, speed: 1.15, labelHeight: 2.35 },
  { id: 'infantry', role: 'infantry', name: '步兵', spawn: { x: 0, z: 1.2 }, home: { x: 0, z: 1.2 }, areaRadius: 4.2, bodyRadius: 0.4, speed: 1.1, labelHeight: 2.4 },
  { id: 'archer', role: 'archer', name: '弓兵', spawn: { x: -2.6, z: -7.4 }, home: { x: -2.2, z: -7.2 }, areaRadius: 3.5, bodyRadius: 0.35, speed: 1.35, labelHeight: 2.15 },
  { id: 'cavalry', role: 'cavalry', name: '骑兵', spawn: { x: -4, z: -4 }, home: { x: -4, z: -4 }, areaRadius: 4.0, bodyRadius: 1.12, speed: 1.6, labelHeight: 2.95 },
  { id: 'dog', role: 'dog', name: '田园犬', spawn: { x: -1.6, z: -5.8 }, home: { x: -0.5, z: -5.5 }, areaRadius: 4.7, bodyRadius: 0.54, speed: 1.55, labelHeight: 1.35 },
  { id: 'base-human', role: 'base', name: '管家', spawn: { x: 0, z: -3.8 }, home: { x: 0, z: -3.8 }, areaRadius: 2.5, bodyRadius: 0.34, speed: 1.15, labelHeight: 2.25 },
];

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
