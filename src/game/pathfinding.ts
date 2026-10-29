import { isBlocked } from './movement.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { inBounds, segmentIsClear } from './wander.ts';

/** Grid is only used for planning; the resulting waypoints are continuous world coordinates. */
export function findPath(start: Point, goal: Point, radius: number, bounds: Bounds, obstacles: readonly Obstacle[], cell = 0.5): Point[] | undefined {
  if (!inBounds(goal, radius, bounds) || isBlocked(goal, radius, obstacles)) return undefined;
  if (segmentIsClear(start, goal, radius, bounds, obstacles)) return [goal];
  const width = Math.floor((bounds.maxX - bounds.minX) / cell) + 1;
  const height = Math.floor((bounds.maxZ - bounds.minZ) / cell) + 1;
  const point = (id: number): Point => ({ x: bounds.minX + (id % width) * cell, z: bounds.minZ + Math.floor(id / width) * cell });
  const idOf = (p: Point) => Math.round((p.z - bounds.minZ) / cell) * width + Math.round((p.x - bounds.minX) / cell);
  const startId = idOf(start), endId = idOf(goal), total = width * height;
  if (startId < 0 || startId >= total || endId < 0 || endId >= total) return undefined;
  const scores = new Float64Array(total); scores.fill(Infinity); scores[startId] = 0;
  const parent = new Int32Array(total); parent.fill(-1);
  const closed = new Uint8Array(total); const open = new Set<number>([startId]);
  const heuristic = (id: number) => Math.hypot(point(id).x - goal.x, point(id).z - goal.z);
  while (open.size) {
    let current = -1, best = Infinity;
    for (const id of open) { const score = scores[id] + heuristic(id); if (score < best) { best = score; current = id; } }
    open.delete(current); closed[current] = 1;
    const here = current === startId ? start : point(current);
    if (segmentIsClear(here, goal, radius, bounds, obstacles)) {
      const chain: Point[] = [goal];
      for (let id = current; id !== startId && id >= 0; id = parent[id]) chain.push(point(id));
      chain.reverse();
      const path: Point[] = []; let anchor = start;
      for (let i = 0; i < chain.length;) {
        let furthest = i;
        while (furthest + 1 < chain.length && segmentIsClear(anchor, chain[furthest + 1], radius, bounds, obstacles)) furthest++;
        anchor = chain[furthest]; path.push(anchor); i = furthest + 1;
      }
      return path;
    }
    const x = current % width, z = Math.floor(current / width);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
      const next = nz * width + nx;
      if (closed[next]) continue;
      const dest = point(next);
      if (!segmentIsClear(here, dest, radius, bounds, obstacles)) continue;
      const score = scores[current] + Math.hypot(dest.x - here.x, dest.z - here.z);
      if (score < scores[next]) { scores[next] = score; parent[next] = current; open.add(next); }
    }
  }
  return undefined;
}
