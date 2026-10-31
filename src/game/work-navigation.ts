import { isBlocked } from './movement.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { findPath } from './pathfinding.ts';

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
