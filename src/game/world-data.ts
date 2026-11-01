import type { Bounds, Obstacle, Point } from './movement.ts';
import { createLandscapeLayout } from './landscape-layout.ts';
import { insidePolygon } from './polygon.ts';

// Fixed measurement of the shared base human's neutral standing mesh (no tools).
// One design unit = 1.1256098747253418 engine units; never recomputed per pose.
export const HUMAN_WIDTH = 1.1256098747253418;
export const GRID_SIZE = HUMAN_WIDTH * 1.5;
export const MAP_CELLS = 100;
export const MAP_SIZE = MAP_CELLS * GRID_SIZE;
export const gridPoint = (column: number, row: number): Point => ({ x: (column - 50) * GRID_SIZE, z: (50 - row) * GRID_SIZE });
export const WORLD_BOUNDS: Bounds = { minX: -MAP_SIZE / 2, maxX: MAP_SIZE / 2, minZ: -MAP_SIZE / 2, maxZ: MAP_SIZE / 2 };
export const SPAWN: Point = gridPoint(50, 50);
export const WALK_SPEED = 3.7;
export const PLAYER_RADIUS = 0.28;
export const BUILDINGS = [
  { id: 'cottage', ...gridPoint(48, 47), width: 2 * GRID_SIZE, depth: 2 * GRID_SIZE, height: 2.65, roof: 'terracotta' },
  { id: 'warehouse', ...gridPoint(52.5, 47), width: 3 * GRID_SIZE, depth: 2 * GRID_SIZE, height: 2.9, roof: 'terracotta' },
] as const;
export const WAREHOUSE = BUILDINGS[1];
export const HOME = BUILDINGS[0];
export const WAREHOUSE_DOOR = { x: WAREHOUSE.x, z: WAREHOUSE.z - WAREHOUSE.depth / 2 - .75 };
export const LANDSCAPE = createLandscapeLayout(gridPoint, GRID_SIZE);
export const WATER_OBSTACLE: Obstacle = { kind: 'polygon', ...LANDSCAPE.lake };
export const ROADS = LANDSCAPE.roadControls;
export const TREES = LANDSCAPE.trees;
export const FENCES: readonly Point[] = [];
export interface Landmark { id: string; name: string; label: string; description: string; x: number; z: number; range: number }
export const LANDMARKS: readonly Landmark[] = [];
export const OBSTACLES: readonly Obstacle[] = [
  ...BUILDINGS.map((b): Obstacle => ({ kind: 'box', x: b.x, z: b.z, halfWidth: b.width / 2 + .08, halfDepth: b.depth / 2 + .08 })),
  ...TREES.map((t): Obstacle => ({ kind: 'circle', x: t.x, z: t.z, radius: .5 * t.scale })),
  WATER_OBSTACLE,
];
export type LandType = 'grass' | 'path' | 'garden' | 'water' | 'building';
export interface LandCell extends Point { type: LandType }
export function createLandGrid(): LandCell[] {
  const cells: LandCell[] = [];
  for (let row = 0; row < MAP_CELLS; row++) for (let column = 0; column < MAP_CELLS; column++) {
    const p = gridPoint(column + .5, row + .5);
    let type: LandType = 'grass';
    if (column >= 51 && column < 55 && row >= 52 && row < 55) type = 'garden';
    if (insidePolygon(p, LANDSCAPE.lake)) type = 'water';
    if (BUILDINGS.some(b => Math.abs(p.x - b.x) < b.width / 2 && Math.abs(p.z - b.z) < b.depth / 2)) type = 'building';
    cells.push({ ...p, type });
  }
  return cells;
}
