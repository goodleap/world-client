import { createMapLandmarks } from './map-landmarks.ts';
import { MAP_DEVELOPMENT } from './opening-profile.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { createLandscapeLayout } from './landscape-layout.ts';
import { treeCollisionRadius } from './tree-profile.ts';
import { MAP_CONFIG } from './map-regions.ts';
import { insidePolygon } from './polygon.ts';

// Fixed measurement of the shared base human's neutral standing mesh (no tools).
// One design unit = 1.1256098747253418 engine units; never recomputed per pose.
export const HUMAN_WIDTH = 1.1256098747253418;
export const GRID_SIZE = HUMAN_WIDTH * 1.5;
export const MAP_CELLS = MAP_CONFIG.columns;
export const MAP_ROWS = MAP_CONFIG.rows;
export const MAP_WIDTH = MAP_CELLS * GRID_SIZE;
export const MAP_DEPTH = MAP_ROWS * GRID_SIZE;
export const MAP_SIZE = Math.max(MAP_WIDTH, MAP_DEPTH);
export const gridPoint = (column: number, row: number): Point => ({ x: (column - MAP_CELLS / 2) * GRID_SIZE, z: (MAP_ROWS / 2 - row) * GRID_SIZE });
export const WORLD_BOUNDS: Bounds = { minX: -MAP_WIDTH / 2, maxX: MAP_WIDTH / 2, minZ: -MAP_DEPTH / 2, maxZ: MAP_DEPTH / 2 };
export const SPAWN: Point = gridPoint(MAP_CELLS / 2, MAP_ROWS / 2);
export const WALK_SPEED = 3.7;
export const PLAYER_RADIUS = 0.28;
export const STANDARD_BUILDINGS = [
  { id: 'cottage', ...gridPoint(MAP_CELLS / 2 - 2, MAP_ROWS / 2 - 3), width: 2 * GRID_SIZE, depth: 2 * GRID_SIZE, height: 2.65, roof: 'terracotta' },
  { id: 'warehouse', ...gridPoint(MAP_CELLS / 2 + 2.5, MAP_ROWS / 2 - 3), width: 3 * GRID_SIZE, depth: 2 * GRID_SIZE, height: 2.9, roof: 'terracotta' },
  // The current map opening places the center on the grass west of the fork.
  // Keep the optional standard opening's cottage/warehouse footprint intact.
  { id: 'home-center', ...gridPoint(MAP_CELLS / 2 + (MAP_DEVELOPMENT ? -.5 : 6.5), MAP_ROWS / 2 - 4.5), width: 3 * GRID_SIZE, depth: 3 * GRID_SIZE, height: 3.1, roof: 'terracotta' },
] as const;
export const BUILDINGS = STANDARD_BUILDINGS.filter(b=>!MAP_DEVELOPMENT||b.id==='home-center');
export const WAREHOUSE = STANDARD_BUILDINGS[1];
export const HOME = STANDARD_BUILDINGS[0];
export const HOME_CENTER = STANDARD_BUILDINGS[2];
export const WAREHOUSE_DOOR = { x: WAREHOUSE.x, z: WAREHOUSE.z - WAREHOUSE.depth / 2 - .75 };
export const MAP_LANDMARKS = createMapLandmarks(GRID_SIZE);
export const LANDSCAPE = createLandscapeLayout(gridPoint, GRID_SIZE);
export const WATER_OBSTACLES: Obstacle[] = LANDSCAPE.waterSolids.map(area => ({kind:'polygon',...area}));
export const ROADS = LANDSCAPE.roadControls;
export const TREES = LANDSCAPE.trees;
export const FENCES: readonly Point[] = [];
export interface Landmark { id: string; name: string; label: string; description: string; x: number; z: number; range: number }
export const LANDMARKS: readonly Landmark[] = [];
export const OBSTACLES: readonly Obstacle[] = [
  ...BUILDINGS.map((b): Obstacle => ({ kind: 'box', x: b.x, z: b.z, halfWidth: b.width / 2 + .08, halfDepth: b.depth / 2 + .08 })),
  ...TREES.map((t): Obstacle => ({ kind: 'circle', x: t.x, z: t.z, radius: treeCollisionRadius(t,GRID_SIZE) })),
  ...LANDSCAPE.obstacles.map((area): Obstacle => ({ kind: 'polygon', ...area })),
  ...WATER_OBSTACLES,
  ...MAP_LANDMARKS.obstacles,
];
export type LandType = 'grass' | 'path' | 'garden' | 'water' | 'building' | 'wildland';
export interface LandCell extends Point { type: LandType }
export function createLandGrid(): LandCell[] {
  const cells: LandCell[] = [];
  for (let row = 0; row < MAP_ROWS; row++) for (let column = 0; column < MAP_CELLS; column++) {
    const p = gridPoint(column + .5, row + .5);
    let type: LandType = LANDSCAPE.contains(p) ? 'grass' : 'wildland';
    if (!MAP_DEVELOPMENT && column >= MAP_CELLS / 2 + 1 && column < MAP_CELLS / 2 + 5 && row >= MAP_ROWS / 2 + 2 && row < MAP_ROWS / 2 + 5) type = 'garden';
    if (LANDSCAPE.waterSolids.some(a => insidePolygon(p, a))) type = 'water';
    if (BUILDINGS.some(b => Math.abs(p.x - b.x) < b.width / 2 && Math.abs(p.z - b.z) < b.depth / 2)) type = 'building';
    cells.push({ ...p, type });
  }
  return cells;
}
