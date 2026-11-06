import { navigationRuntime } from './navigation-runtime.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
export interface Neighbour { id: string; position: Point; radius: number; moving: boolean; purposeful: boolean; waiting: boolean; heading?:number; team?:string; yield?:(from:Point,toward:Point)=>boolean }
export interface RouteState { waiting: boolean; waited: number; retryIn: number; replanIn: number; replans: number; searches: number }
export const createRouteState = (): RouteState => ({ waiting: false, waited: 0, retryIn: 0, replanIn: 0, replans: 0, searches: 0 });
export function resetRouteState(state: RouteState) { state.waiting = false; state.waited = 0; state.retryIn = 0; state.replanIn = 0; }
// Presentation-only traces of the latest step; never serialized with route state.
const motionPaths = new WeakMap<RouteState, readonly Point[]>();
export const routeMotion = (state: RouteState) => motionPaths.get(state);

/** Consume the one shared V2 Crowd update. Local avoidance and path searches
 * have no second implementation in the game. */
export function stepRoute(id:string,position:Point,route:Point[],state:RouteState,seconds:number,speed:number,radius:number,
  bounds:Bounds,solids:readonly Obstacle[],neighbours:readonly Neighbour[]){
  const native=navigationRuntime();if(!native)throw new Error('Navigation must be initialized before movement');
  const result=native.step(id,position,route,state,seconds,speed,radius,bounds,solids,neighbours);
  motionPaths.set(state,result.path);return result;
}
