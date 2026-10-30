import type { Bounds, Obstacle, Point } from './movement.ts';
import { findPath } from './pathfinding.ts';
import { segmentIsClear } from './wander.ts';

export interface Neighbour { id: string; position: Point; radius: number; moving: boolean; purposeful: boolean; waiting: boolean }
export interface RouteState { waiting: boolean; retryIn: number; replans: number }
export const createRouteState = (): RouteState => ({ waiting: false, retryIn: 0, replans: 0 });
export function resetRouteState(state: RouteState) { state.waiting = false; state.retryIn = 0; }

/** Coordinate existing routes around temporary occupants. Commit a detour until
 * it is obstructed; never slide alternately on x/z or restart Run every frame.
 * Recast's crowd requires a navmesh/agent-owned movement. This small adapter
 * preserves the existing per-role land rules, live obstacles and work targets. */
export function stepRoute(id: string, position: Point, route: Point[], state: RouteState, seconds: number,
  speed: number, radius: number, bounds: Bounds, solids: readonly Obstacle[], neighbours: readonly Neighbour[]) {
  const dt = Math.max(0, Math.min(seconds, .05));
  const stopped = (unreachable = false) => ({ position, velocity: { x: 0, z: 0 }, unreachable });
  if (!dt || !route.length) return stopped();
  const wait = () => { state.waiting = true; state.retryIn = .35; return stopped(); };
  if (state.retryIn > 0) { state.retryIn = Math.max(0, state.retryIn - dt); return stopped(); }
  const circles = neighbours.map((other): Obstacle => ({ kind: 'circle', ...other.position, radius: other.radius }));
  const obstacles = [...solids, ...circles];
  const towards = (goal: Point, distance: number): Point => {
    const dx = goal.x - position.x, dz = goal.z - position.z, length = Math.hypot(dx, dz);
    const fraction = Math.min(1, distance / (length || 1));
    return { x: position.x + dx * fraction, z: position.z + dz * fraction };
  };
  // Look ahead far enough to stop before contact and leave room for a detour.
  const lookahead = towards(route[0], Math.max(speed * dt, Math.min(.75, speed * .18 + .12)));
  if (!segmentIsClear(position, lookahead, radius, bounds, obstacles)) {
    const blockers = neighbours.filter(other => !segmentIsClear(position, lookahead, radius, bounds,
      [{ kind: 'circle', ...other.position, radius: other.radius }]));
    // Crossing traffic gets time to pass. In a face-to-face standoff the stable
    // ID order lets one detour while the other waits; neither command is lost.
    if ((!state.waiting && blockers.some(other => other.moving)) ||
      blockers.some(other => other.purposeful && other.waiting && other.id < id)) return wait();
    const planning: Obstacle[] = [...solids, ...neighbours.map((other): Obstacle => ({
      kind: 'circle', ...other.position,
      radius: other.radius + Math.max(0, Math.min(.1, Math.hypot(other.position.x - position.x, other.position.z - position.z) - radius - other.radius - .01)),
    }))];
    const destination = route[route.length - 1];
    const detour = findPath(position, destination, radius, bounds, planning);
    if (!detour) {
      // Only a genuinely impassable map invalidates work travel. Another unit
      // occupying the destination temporarily must not cancel the instruction.
      if (!findPath(position, destination, radius, bounds, solids)) return stopped(true);
      return wait();
    }
    route.splice(0, route.length, ...detour); state.replans++;
  }
  const next = towards(route[0], speed * dt);
  if (!segmentIsClear(position, next, radius, bounds, obstacles)) return wait();
  resetRouteState(state);
  if (Math.hypot(next.x - route[0].x, next.z - route[0].z) < .025) route.shift();
  return { position: next, velocity: { x: (next.x - position.x) / dt, z: (next.z - position.z) / dt }, unreachable: false };
}
