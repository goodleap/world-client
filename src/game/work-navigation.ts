import { isBlocked } from './movement.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { findPath, findPathToGoals, PATH_CELL_SIZE } from './pathfinding.ts';
import { inBounds, segmentIsClear } from './wander.ts';

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

export const MOVE_DESTINATION_RADIUS = 3;

/** Prefer the exact click, then the closest reachable free location in a
 * bounded neighbourhood. Solids, body clearance and live arrival reservations
 * use the same checks as work/navigation; exact work seats are not redirected. */
export function planMoveDestination(start: Point, point: Point, radius: number, bounds: Bounds,
  solids: readonly Obstacle[], neighbours: readonly WorkNeighbour[]) {
  if (![start.x,start.z,point.x,point.z].every(Number.isFinite)) return;
  const valid = (p: Point) => inBounds(p, radius, bounds) && !isBlocked(p, radius, solids) && !occupiedApproach(p, radius, neighbours);
  if (valid(point) && segmentIsClear(start,point,radius,bounds,solids)) return [{x:point.x,z:point.z}];
  const distance = (p: Point) => Math.hypot(p.x-point.x,p.z-point.z);
  const candidates: Point[] = [];
  const cell = PATH_CELL_SIZE, range = MOVE_DESTINATION_RADIUS;
  const minX = Math.max(0,Math.ceil((point.x-range-bounds.minX)/cell)), maxX = Math.floor((Math.min(point.x+range,bounds.maxX)-bounds.minX)/cell);
  const minZ = Math.max(0,Math.ceil((point.z-range-bounds.minZ)/cell)), maxZ = Math.floor((Math.min(point.z+range,bounds.maxZ)-bounds.minZ)/cell);
  for (let z=minZ;z<=maxZ;z++) for (let x=minX;x<=maxX;x++) {
    const p = { x:bounds.minX+x*cell, z:bounds.minZ+z*cell };
    if (distance(p)<=range && valid(p)) candidates.push(p);
  }
  candidates.sort((a,b)=>distance(a)-distance(b) || Math.hypot(a.x-start.x,a.z-start.z)-Math.hypot(b.x-start.x,b.z-start.z));
  // Copy explicitly: engine picking vectors expose x/z through accessors.
  if (valid(point)) candidates.unshift({x:point.x,z:point.z});
  const path = findPathToGoals(start,candidates,radius,bounds,solids);
  if (!path) return;
  const end = path.at(-1)!;
  if (distance(end)<1e-6) return path;
  // Refine the grid endpoint towards the click while keeping a clear swept
  // segment. This leaves feet close to the shore/wall, not half a cell away.
  const from = path.at(-2) ?? start;
  let low=0,high=1;
  for(let i=0;i<10;i++) {
    const t=(low+high)/2, p={x:end.x+(point.x-end.x)*t,z:end.z+(point.z-end.z)*t};
    if (valid(p) && segmentIsClear(end,p,radius,bounds,solids)) low=t;
    else high=t;
  }
  const refined={x:end.x+(point.x-end.x)*low,z:end.z+(point.z-end.z)*low};
  if (segmentIsClear(from,refined,radius,bounds,solids)) path[path.length-1]=refined;
  else if (low>0) path.push(refined); // Keep the approach corner when cutting it would clip the obstacle.
  return path;
}
