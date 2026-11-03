import {bodyObstacle,bodyAtClear,bodySegmentClear,bodyTurnClear,angleDelta,type MovingBody} from './body-shape.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import { isBlocked } from './movement.ts';
import { findPath } from './pathfinding.ts';
import { segmentIsClear } from './wander.ts';

export interface Neighbour { id: string; position: Point; radius: number; moving: boolean; purposeful: boolean; waiting: boolean; body?:MovingBody; heading?:number; team?:string; yield?:(from:Point,toward:Point)=>boolean }
export interface RouteState { waiting: boolean; waited: number; retryIn: number; replanIn: number; replans: number; searches: number }
export const createRouteState = (): RouteState => ({ waiting: false, waited: 0, retryIn: 0, replanIn: 0, replans: 0, searches: 0 });
export function resetRouteState(state: RouteState) { state.waiting = false; state.waited = 0; state.retryIn = 0; state.replanIn = 0; }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Most crowd encounters need only a swept local sidestep. A bounded local A*
 * handles corners; full map searches are reserved for changed solid obstacles.
 * Recast crowd would require replacing per-role land rules and route ownership
 * with a navmesh. This follower shares the current collision/planning geometry. */
export function stepRoute(id: string, position: Point, route: Point[], state: RouteState, seconds: number,
  speed: number, radius: number, bounds: Bounds, solids: readonly Obstacle[], neighbours: readonly Neighbour[], body?:MovingBody) {
  const dt = Math.max(0, Math.min(seconds, .05));
  const stopped = (unreachable = false) => ({ position, velocity: { x: 0, z: 0 }, unreachable, facing:body?.heading });
  if (!dt || !route.length || speed <= 0) return stopped();
  while(route.length&&distance(position,route[0])<1e-8)route.shift();
  if(!route.length)return stopped();
  state.replanIn = Math.max(0, state.replanIn - dt);
  const wait = (duration = .35) => { state.waiting = true; state.waited += dt; state.retryIn = duration; return stopped(); };
  const circles = neighbours.map(other => bodyObstacle(other.position,other.radius,other.body));
  const clear=(a:Point,b:Point,r:number,limits:Bounds,items:readonly Obstacle[])=>body?bodySegmentClear(a,b,r,{...body,heading:distance(a,position)<1e-7?body.heading:Math.atan2(b.x-a.x,b.z-a.z)},limits,items):segmentIsClear(a,b,r,limits,items);
  const obstacles = [...solids, ...circles];
  const move = (next: Point) => {
    state.waiting = false; state.waited = 0; state.retryIn = 0;
    // A corner is safe from the planned waypoint, not from a nearby point that
    // cuts across the inflated obstacle on the following leg.
    if (distance(next, route[0]) < 1e-8) route.shift();
    return { position: next, velocity: { x: (next.x - position.x) / dt, z: (next.z - position.z) / dt }, unreachable: false, facing:body?Math.atan2(next.x-position.x,next.z-position.z):undefined };
  };
  const towards = (goal: Point, length: number): Point => {
    const fraction = Math.min(1, length / (distance(goal, position) || 1));
    return { x: position.x + (goal.x - position.x) * fraction, z: position.z + (goal.z - position.z) * fraction };
  };

  // An already overlapping start cannot pass the ordinary swept-circle test.
  // Recover at the current movement speed, increasing every existing separation and never
  // crossing a solid or introducing a new overlap. No teleport or collision skip.
  const overlapping = neighbours.filter((_,i) => body?!bodyAtClear(position,radius,body,bounds,[circles[i]]):isBlocked(position,radius,[circles[i]]));
  if (overlapping.length) {
    let x = 0, z = 0;
    for (const n of overlapping) {
      const d = distance(position, n.position);
      x += d > 1e-6 ? (position.x - n.position.x) / d : id < n.id ? -1 : 1;
      z += d > 1e-6 ? (position.z - n.position.z) / d : 0;
    }
    const angle = Math.atan2(z, x);
    for (const turn of [0, .5, -.5, 1, -1, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const next = { x: position.x + Math.cos(angle + turn) * speed * dt, z: position.z + Math.sin(angle + turn) * speed * dt };
      if (!clear(position, next, radius, bounds, solids)) continue;
      const safe = neighbours.every((n, i) => {
        if (!overlapping.includes(n)) return clear(position, next, radius, bounds, [circles[i]]);
        const dx = next.x - position.x, dz = next.z - position.z;
        return distance(next, n.position) > distance(position, n.position) + 1e-7
          && dx * (position.x - n.position.x) + dz * (position.z - n.position.z) >= -1e-8;
      });
      if (safe) return move(next);
    }
    return wait();
  }
  if (state.retryIn > 0) { state.retryIn = Math.max(0, state.retryIn - dt); state.waited += dt; return stopped(); }
  const lookahead = towards(route[0], Math.max(speed * dt, Math.min(.85, speed * .18 + .12)));
  if (!clear(position, lookahead, radius, bounds, obstacles)) {
    const blockers = neighbours.filter((_, i) => !clear(position, lookahead, radius, bounds, [circles[i]]))
      .sort((a, b) => distance(position, a.position) - distance(position, b.position));
    if (!state.waiting && blockers.some(other => other.moving)) return wait();
    if (state.replanIn > 0) return wait(Math.min(.35, state.replanIn));
    // Stagger attempts, independent of render rate or the residents' update order.
    state.replanIn = .65 + [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5 * .06;
    const destination = route.at(-1)!;
    const idle=blockers.find(n=>!n.moving&&!n.purposeful&&n.yield);
    if(idle?.yield?.(position,route[0]))return wait(.2);
    // A same-direction queue keeps its lane through a bottleneck. Slots spread
    // naturally again once the leader clears the passage.
    const heading=Math.atan2(route[0].x-position.x,route[0].z-position.z);
    if(blockers.some(n=>n.moving&&n.purposeful&&n.heading!==undefined&&Math.cos(n.heading-heading)>.7))return wait(.15);
    const occupiedGoal = neighbours.find(n => distance(destination, n.position) < radius + n.radius);
    if (occupiedGoal && !occupiedGoal.moving && !occupiedGoal.purposeful) return wait();
    const solidBlocked = !clear(position, lookahead, radius, bounds, solids);
    let detour: Point[] | undefined;
    if (blockers.length) {
      const goal = route[0], length = distance(position, goal) || 1;
      const forward = { x: (goal.x - position.x) / length, z: (goal.z - position.z) / length };
      const tailAfter = (point: Point) => {
        for (let i = route.length - 1; i > 0; i--) if (clear(point, route[i], radius, bounds, solids)) return route.slice(i);
        return route;
      };
      // Keep right when meeting head-on. Opposite headings choose opposite
      // world-space sides. Commit both waypoints to avoid left/right oscillation.
      const blocker = blockers[0];
      for (const extra of [0, .5, 1]) {
        for (const side of [1, -1]) {
          const clearance = radius + blocker.radius + .18 + extra;
          const offset = (ahead: number): Point => ({
            x: blocker.position.x + forward.z * clearance * side + forward.x * clearance * ahead,
            z: blocker.position.z - forward.x * clearance * side + forward.z * clearance * ahead,
          });
          const before = offset(-.8), after = offset(.8);
          if (clear(position, before, radius, bounds, obstacles) && clear(before, after, radius, bounds, obstacles)) {
            detour = [before, after, ...tailAfter(after)]; break;
          }
        }
        if (detour) break;
      }
      // A narrow passage may fit two people only after both move sideways.
      // Commit a partial yield first; the normal sweep still guards the forward
      // leg until the other person has made space. Never enter their collider.
      if (!detour && blocker.purposeful) for (const fraction of [.5, .3, .15]) {
        for (const side of [1, -1]) {
          const clearance = radius + blocker.radius + .18, amount = clearance * fraction * side;
          const aside = { x: position.x + forward.z * amount, z: position.z - forward.x * amount };
          const ahead = Math.max(2 * clearance, distance(position, blocker.position) + clearance);
          const pass = { x: aside.x + forward.x * ahead, z: aside.z + forward.z * ahead };
          if (clear(position, aside, radius, bounds, obstacles) && clear(aside, pass, radius, bounds, solids)) {
            detour = [aside, pass, ...tailAfter(pass)]; break;
          }
        }
        if (detour) break;
      }
    }
    if (!detour && solidBlocked) {
      state.searches++;
      detour = findPath(position, destination, radius, bounds, solids,.5,body);
      if (!detour) return stopped(true);
    } else if (!detour && !occupiedGoal) {
      // At most 33 x 33 cells, instead of allocating/searching the 100-cell map
      // every time a person crosses a route. Failed attempts retain the command.
      const local: Bounds = { minX: Math.max(bounds.minX, position.x - 8), maxX: Math.min(bounds.maxX, position.x + 8),
        minZ: Math.max(bounds.minZ, position.z - 8), maxZ: Math.min(bounds.maxZ, position.z + 8) };
      // A person may stand on an intermediate corner. Rejoin a later leg,
      // otherwise repeatedly searching toward that occupied corner can never
      // succeed even though the final destination is free and reachable.
      const candidates = [...new Set([route.length - 1, route.length - 2, route.length - 3, 0])].filter(i => i >= 0);
      for (const i of candidates) {
        const anchor = towards(route[i], 4);
        if (isBlocked(anchor, radius, obstacles)) continue;
        state.searches++;
        const prefix = findPath(position, anchor, radius, local, obstacles,.5,body);
        if (prefix) {
          detour = [...prefix, ...route.slice(distance(anchor, route[i]) < 1e-8 ? i + 1 : i)];
          break;
        }
      }
    }
    if (!detour) return wait();
    route.splice(0, route.length, ...detour); state.replans++;
  }
  if(body){
    const target=Math.atan2(route[0].x-position.x,route[0].z-position.z),delta=angleDelta(body.heading,target);
    if(Math.abs(delta)>.04){
      const heading=body.heading+Math.max(-4*dt,Math.min(4*dt,delta));
      if(!bodyTurnClear(position,radius,body,heading,bounds,obstacles))return wait();
      state.waiting=false;state.retryIn=0;return {...stopped(),facing:heading};
    }
  }
  const next = towards(route[0], speed * dt);
  if (!clear(position, next, radius, bounds, obstacles)) return wait();
  return move(next);
}

/** Idle units make a small, collision-checked move without abandoning work. */
export function yieldPoint(position:Point,from:Point,toward:Point,radius:number,bounds:Bounds,solids:readonly Obstacle[],neighbours:readonly Neighbour[],body?:MovingBody){
  const angle=Math.atan2(toward.x-from.x,toward.z-from.z),obstacles=[...solids,...neighbours.map(n=>bodyObstacle(n.position,n.radius,n.body))];
  for(const amount of [1.2,2,3])for(const turn of [Math.PI/2,-Math.PI/2,Math.PI]){
    const p={x:position.x+Math.sin(angle+turn)*amount,z:position.z+Math.cos(angle+turn)*amount};
    if(body?bodySegmentClear(position,p,radius,body,bounds,obstacles):segmentIsClear(position,p,radius,bounds,obstacles))return p;
  }
}
