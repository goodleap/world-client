import clipping from 'polygon-clipping';
import type { MultiPolygon, Polygon, Pair } from 'polygon-clipping';
import { polygonArea, insidePolygon } from './polygon.ts';
import type { PolygonArea } from './polygon.ts';
import type { Point } from './movement.ts';

/** This map is a trial composition, not a permanent size or region count. */
export const MAP_CONFIG = { columns: 100, rows: 100, seed: 20261102 } as const;
export const REGION_LAYOUT = [
  { id: 'home', name: '家园空地', x: 0, z: 0, rx: 13.5, rz: 12, build: true },
  { id: 'woodland', name: '林间营地', x: -28, z: 15, rx: 10, rz: 9, build: true },
  { id: 'orchard', name: '北林果丛', x: -22, z: 35, rx: 10, rz: 8, build: false },
  { id: 'quarry', name: '西南矿谷', x: -22, z: -25, rx: 10, rz: 9, build: true, camp: 'quarry' },
  { id: 'meadow', name: '东岸草甸', x: 27, z: -6, rx: 11, rz: 9, build: true },
  { id: 'lowland', name: '南部沃地', x: 13, z: -33, rx: 12, rz: 7.5, build: true },
  { id: 'pass', name: '北部山口', x: 15, z: 37, rx: 10, rz: 7, build: true, camp: 'pass' },
  { id: 'stone-hollow', name: '西林石坳', x: -40, z: -6, rx: 7, rz: 6, build: false },
  { id: 'east-grove', name: '东南林地', x: 39, z: -32, rx: 7, rz: 6, build: true },
] as const;
export const ROUTE_LAYOUT = [
  [[0, 0], [-10, 4], [-18, 5], [-23, 13], [-28, 15]],
  [[-28, 15], [-31, 24], [-22, 35]],
  [[-22, 35], [-8, 33], [3, 36], [15, 37]],
  [[15, 37], [30, 34], [39, 25], [39, 10], [27, -6]],
  [[27, -6], [16, -2], [0, 0]],
  [[0, 0], [-5, -10], [-10, -20], [-22, -25]],
  [[-22, -25], [-13, -29], [0, -32], [13, -33]],
  [[13, -33], [25, -27], [30, -18], [27, -6]],
  [[-28, 15], [-37, 6], [-40, -6]],
  [[27, -6], [37, -17], [39, -32]],
] as const;
const ellipse = (cx: number, cz: number, rx: number, rz: number, phase = 0): Polygon => [Array.from({ length: 48 }, (_, i): Pair => {
  const a = i * Math.PI / 24, ripple = 1 + .055 * Math.sin(a * 3 + phase) + .045 * Math.cos(a * 5 - phase);
  return [cx + Math.cos(a) * rx * ripple, cz + Math.sin(a) * rz * ripple];
})];
export function areas(polygons: MultiPolygon): PolygonArea[] {
  return polygons.map(rings => ({ ...polygonArea(rings[0].slice(0, -1).map(([x, z]) => ({ x, z }))),
    holes: rings.slice(1).map(ring => polygonArea(ring.slice(0, -1).map(([x, z]) => ({ x, z })))) }));
}
export function createRegions(grid: number, paths: readonly (readonly Point[])[]) {
  const shapes = REGION_LAYOUT.map((r, i) => ellipse(r.x * grid, r.z * grid, r.rx * grid, r.rz * grid, i));
  const regions = REGION_LAYOUT.map((r, i) => ({ ...r, x: r.x * grid, z: r.z * grid, area: areas(clipping.union(shapes[i]))[0] }));
  const strips: Polygon[] = [];
  const half = 2 * grid; // Two cavalry can pass; all structures reserve this corridor.
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 1e-6) continue;
      const nx = (b.z - a.z) / d * half, nz = (a.x - b.x) / d * half;
      strips.push([[[a.x + nx, a.z + nz], [b.x + nx, b.z + nz], [b.x - nx, b.z - nz], [a.x - nx, a.z - nz]]]);
      // Native curves have short segments; discs close their rounded joins.
      strips.push(ellipse(b.x, b.z, half, half));
    }
  }
  const land = clipping.union(shapes[0], ...shapes.slice(1), ...strips);
  const width = MAP_CONFIG.columns * grid, depth = MAP_CONFIG.rows * grid;
  const rect = (x: number, z: number, w: number, h: number): Polygon => [[[x, z], [x + w, z], [x + w, z + h], [x, z + h]]];
  const perimeter = rect(-width / 2, -depth / 2, width, depth);
  const blocked = clipping.difference(perimeter, land);
  // Tile static solids for fast broad-phase rejection in the existing swept planner.
  const obstacles: PolygonArea[] = [], tile = grid * 12;
  for (let z = -depth / 2; z < depth / 2; z += tile) for (let x = -width / 2; x < width / 2; x += tile) {
    obstacles.push(...areas(clipping.intersection(blocked, rect(x, z, Math.min(tile, width / 2 - x), Math.min(tile, depth / 2 - z)))));
  }
  const playable = areas(land);
  return { regions, land, blocked, obstacles, playable, contains: (p: Point) => playable.some(a => insidePolygon(p, a)) };
}
export const pathDistanceSquared = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return (p.x - a.x - dx * t) ** 2 + (p.z - a.z - dz * t) ** 2;
};
