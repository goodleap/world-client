import { WORLD_BOUNDS, OBSTACLES } from './world-data.ts';
import type { Obstacle, Point } from './movement.ts';
import type { WanderSettings } from './wander.ts';

export type ResidentRole = 'farmer' | 'worker' | 'infantry' | 'archer' | 'cavalry' | 'dog' | 'base';
export interface ResidentDefinition {
  id: string; role: ResidentRole; name: string; spawn: Point; home: Point;
  areaRadius: number; bodyRadius: number; speed: number; labelHeight: number;
}

export const RESIDENTS: readonly ResidentDefinition[] = [
  { id: 'farmer', role: 'farmer', name: '农民', spawn: { x: 1.8, z: -2.3 }, home: { x: 1.8, z: -2 }, areaRadius: 3.6, bodyRadius: 0.29, speed: 1.15, labelHeight: 2.35 },
  { id: 'worker', role: 'worker', name: '工人', spawn: { x: -2.3, z: -0.7 }, home: { x: -3, z: 0 }, areaRadius: 3.6, bodyRadius: 0.34, speed: 1.25, labelHeight: 2.2 },
  { id: 'infantry', role: 'infantry', name: '步兵', spawn: { x: 1.9, z: 3.1 }, home: { x: 1, z: 3.3 }, areaRadius: 4.2, bodyRadius: 0.4, speed: 1.1, labelHeight: 2.4 },
  { id: 'archer', role: 'archer', name: '弓兵', spawn: { x: -2.6, z: -7.4 }, home: { x: -2.2, z: -7.2 }, areaRadius: 3.5, bodyRadius: 0.35, speed: 1.35, labelHeight: 2.15 },
  { id: 'cavalry', role: 'cavalry', name: '骑兵', spawn: { x: 6, z: 2.8 }, home: { x: 5.5, z: 3 }, areaRadius: 4.0, bodyRadius: 1.12, speed: 1.6, labelHeight: 2.95 },
  { id: 'dog', role: 'dog', name: '田园犬', spawn: { x: -1.6, z: -5.8 }, home: { x: -0.5, z: -5.5 }, areaRadius: 4.7, bodyRadius: 0.54, speed: 1.55, labelHeight: 1.35 },
  { id: 'base-human', role: 'base', name: '基础人物', spawn: { x: 0, z: -3.8 }, home: { x: 0, z: -3.8 }, areaRadius: 2.5, bodyRadius: 0.34, speed: 1.15, labelHeight: 2.25 },
];

// Residents stay out of the planted beds as well as the same solids used by the player.
export const RESIDENT_OBSTACLES: readonly Obstacle[] = [
  ...OBSTACLES,
  { kind: 'box', x: 4.8, z: -2, halfWidth: 2.35, halfDepth: 2.1 },
];

export function wanderSettings(resident: ResidentDefinition): WanderSettings {
  return { home: resident.home, areaRadius: resident.areaRadius, bodyRadius: resident.bodyRadius, speed: resident.speed, bounds: WORLD_BOUNDS };
}
