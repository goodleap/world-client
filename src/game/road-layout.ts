import { GRID_SIZE, MAP_SIZE, ROADS } from './world-data.ts';
import type { Point } from './movement.ts';
import { createCurvedRoadPaths } from './landscape-layout.ts';

// Rendering and land placement share the same native curves and road width.
export const ROAD_HALF_WIDTH = 20 / 1024 * MAP_SIZE / 2;
/** Low-frequency width changes and a wider village junction, in world units. */
export function roadHalfWidthAt(p: Point) {
  return 1.15 + .20 * Math.sin(p.x * .16 + p.z * .11) + .12 * Math.cos(p.z * .27)
    + .65 * Math.exp(-(p.x * p.x + (p.z - GRID_SIZE) ** 2) / 55);
}
export const ROAD_PATHS = createCurvedRoadPaths(ROADS, GRID_SIZE, GRID_SIZE / 4);

export function nearRoad(point: Point, clearance: number) {
  return ROAD_PATHS.some(path => path.some((a, i) => {
    if (!i) return false;
    const b = path[i - 1], dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared)) : 0;
    const p = { x: a.x + t * dx, z: a.z + t * dz };
    return (point.x - p.x) ** 2 + (point.z - p.z) ** 2 < (roadHalfWidthAt(p) + clearance) ** 2;
  }));
}
