import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import { Curve3 } from '@babylonjs/core/Maths/math.path.js';
import { GRID_SIZE, MAP_SIZE, ROADS } from './world-data.ts';
import type { Point } from './movement.ts';

// Rendering and land placement share the same native curves and road width.
export const ROAD_HALF_WIDTH = 20 / 1024 * MAP_SIZE / 2;
export const ROAD_PATHS = ROADS.map(road => {
  const point = (p: Point) => new Vector3(p.x, 0, p.z);
  const points = [point(road[0])];
  for (let i = 1; i < road.length; i++) {
    const control = point(road[i - 1]), end = Vector3.Center(control, point(road[i]));
    const start = points.at(-1)!;
    const samples = Math.max(4, Math.ceil((Vector3.Distance(start, control) + Vector3.Distance(control, end)) / GRID_SIZE));
    points.push(...Curve3.CreateQuadraticBezier(start, control, end, samples).getPoints().slice(1));
  }
  points.push(point(road.at(-1)!));
  return points;
});

export function nearRoad(point: Point, clearance: number) {
  const distanceSquared = (ROAD_HALF_WIDTH + clearance) ** 2;
  return ROAD_PATHS.some(path => path.some((a, i) => {
    if (!i) return false;
    const b = path[i - 1], dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared)) : 0;
    return (point.x - a.x - t * dx) ** 2 + (point.z - a.z - t * dz) ** 2 < distanceSquared;
  }));
}
