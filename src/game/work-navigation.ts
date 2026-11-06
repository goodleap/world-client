import { isBlocked } from './movement.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { planPaths, planMoveInBackground } from './path-planner.ts';
import { inBounds, segmentIsClear } from './wander.ts';

export interface WorkNeighbour { position: Point; radius: number; destination?: Point }
export function occupiedApproach(point: Point, radius: number, neighbours: readonly WorkNeighbour[]) {
  // Destination reservations are a spacing rule; no temporary colliders or
  // spatial-index query is needed for each individual pair of circular bodies.
  return neighbours.some(n=>{
    const clearance=radius+n.radius+.08;
    return Math.hypot(point.x-n.position.x,point.z-n.position.z)<clearance
      ||!!n.destination&&Math.hypot(point.x-n.destination.x,point.z-n.destination.z)<clearance;
  });
}

/** Reserve an approach by the live route's endpoint, without another mutable
 * reservation store. Finishing, cancelling and retargeting release it naturally. */
export function planWorkApproach(start: Point, points: readonly Point[], radius: number, bounds: Bounds,
  solids: readonly Obstacle[], neighbours: readonly WorkNeighbour[]) {
  const ordered = points.filter(p => !occupiedApproach(p, radius, neighbours))
    .sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z));
  return planPaths(start,ordered,radius,bounds,solids);
}

export const MOVE_DESTINATION_RADIUS = 6;

/** Prefer the exact click, then the closest reachable free location in a
 * bounded neighbourhood. Solids, body clearance and live arrival reservations
 * use the same checks as work/navigation; exact work seats are not redirected. */
export function planMoveDestination(start: Point, point: Point, radius: number, bounds: Bounds,
  solids: readonly Obstacle[], neighbours: readonly WorkNeighbour[]) {
  if (![start.x,start.z,point.x,point.z].every(Number.isFinite)) return;
  const valid = (p: Point) => inBounds(p, radius, bounds) && !isBlocked(p, radius, solids) && !occupiedApproach(p, radius, neighbours);
  if (valid(point) && segmentIsClear(start, point, radius, bounds, solids)) return [{x:point.x,z:point.z}];
  const deferred=planMoveInBackground(start,point,radius,bounds,solids,neighbours);
  if(deferred!==false)return deferred;
  return undefined;
}
