import type { Bounds, Obstacle, Point } from './movement.ts';

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
export const POND = { ...gridPoint(91, 40), radius: 7 * GRID_SIZE };
export const ROADS = [
  [[44, 0], [45, 15], [49, 30], [50, 49], [45, 61], [28, 77], [7, 82]],
  [[15, 26], [30, 35], [44, 49], [56, 49], [66, 35], [72, 22], [91, 18]],
  [[50, 49], [58, 53], [69, 61], [77, 82], [80, 100]],
] .map(path => path.map(([x, z]) => gridPoint(x, z)));
const grove = (count: number, cx: number, cy: number, rx: number, ry: number, seed: number) => Array.from({ length: count }, (_, i) => {
  const angle = i * 2.39996 + seed, radius = Math.sqrt((i + .5) / count);
  return { ...gridPoint(cx + Math.cos(angle) * rx * radius, cy + Math.sin(angle) * ry * radius), scale: 1.2 + (i % 4) * .18, tone: i % 3 };
});
export const TREES = [
  { ...gridPoint(44, 49), scale: 1, tone: 0 }, { ...gridPoint(43, 53), scale: 1.1, tone: 1 },
  ...grove(65, 17, 18, 15, 17, 1), ...grove(24, 16, 89, 14, 8, 2),
  ...grove(15, 87, 88, 10, 9, 3), ...grove(16, 73, 6, 23, 4, 4),
  ...grove(10, 29, 58, 12, 14, 5),
];
export const FENCES: readonly Point[] = [];
export interface Landmark { id: string; name: string; label: string; description: string; x: number; z: number; range: number }
export const LANDMARKS: readonly Landmark[] = [];
export const OBSTACLES: readonly Obstacle[] = [
  ...BUILDINGS.map((b): Obstacle => ({ kind: 'box', x: b.x, z: b.z, halfWidth: b.width / 2 + .08, halfDepth: b.depth / 2 + .08 })),
  ...TREES.map((t): Obstacle => ({ kind: 'circle', x: t.x, z: t.z, radius: .5 * t.scale })),
  { kind: 'circle', ...POND },
];
export type LandType = 'grass' | 'path' | 'garden' | 'water' | 'building';
export interface LandCell extends Point { type: LandType }
export function createLandGrid(): LandCell[] {
  const cells: LandCell[] = [];
  for (let row = 0; row < MAP_CELLS; row++) for (let column = 0; column < MAP_CELLS; column++) {
    const p = gridPoint(column + .5, row + .5);
    let type: LandType = 'grass';
    if (column >= 51 && column < 55 && row >= 52 && row < 55) type = 'garden';
    if (Math.hypot(p.x - POND.x, p.z - POND.z) < POND.radius) type = 'water';
    if (BUILDINGS.some(b => Math.abs(p.x - b.x) < b.width / 2 && Math.abs(p.z - b.z) < b.depth / 2)) type = 'building';
    cells.push({ ...p, type });
  }
  return cells;
}
