import { isBlocked } from './movement.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { findPath } from './pathfinding.ts';
import { inBounds } from './wander.ts';

export interface WorkNeighbour { position: Point; radius: number; destination?: Point }
export function occupiedApproach(point: Point, radius: number, neighbours: readonly WorkNeighbour[]) {
  return neighbours.some(n => isBlocked(point, radius + .08, [
    { kind: 'circle', ...n.position, radius: n.radius },
    ...(n.destination ? [{ kind: 'circle' as const, ...n.destination, radius: n.radius }] : []),
  ]));
}

/** Reserve an approach by the live route's endpoint, without another mutable
 * reservation store. Finishing, cancelling and retargeting release it naturally. */
export function planWorkApproach(start: Point, points: readonly Point[], radius: number, bounds: Bounds,
  solids: readonly Obstacle[], neighbours: readonly WorkNeighbour[]) {
  const ordered = points.filter(p => !occupiedApproach(p, radius, neighbours))
    .sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z));
  for (const point of ordered) {
    const path = findPath(start, point, radius, bounds, solids);
    if (path) return path;
  }
}

/** Commands near one another need distinct arrival positions too. Reserve the
 * route endpoint just like a work approach; do not wait forever for two bodies
 * to occupy the same point. Invalid terrain still rejects the original click. */
export function planMoveDestination(start: Point, point: Point, radius: number, bounds: Bounds,
  solids: readonly Obstacle[], neighbours: readonly WorkNeighbour[]) {
  if (!inBounds(point, radius, bounds) || isBlocked(point, radius, solids)) return;
  if (!occupiedApproach(point, radius, neighbours)) return findPath(start, point, radius, bounds, solids);
  const spacing = 2 * radius + .1;
  for (let ring = 1; ring <= 3; ring++) {
    const points = Array.from({ length: 16 }, (_, i) => ({ x: point.x + Math.cos(i * Math.PI / 8) * spacing * ring,
      z: point.z + Math.sin(i * Math.PI / 8) * spacing * ring }));
    const path = planWorkApproach(start, points, radius, bounds, solids, neighbours);
    if (path) return path;
  }
}
