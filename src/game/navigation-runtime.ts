import type { PathQuery, PlannedPath } from './path-planner.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import type { RouteState, Neighbour } from './route-following.ts';

export interface MotionStep { position:Point; velocity:Point; distance:number; path:Point[]; unreachable:boolean; facing:number|undefined }
export interface NavigationRuntime {
  readonly batched?:boolean;
  plan(query:PathQuery):PlannedPath;
  step(id:string,position:Point,route:Point[],state:RouteState,seconds:number,speed:number,radius:number,bounds:Bounds,solids:readonly Obstacle[],neighbours:readonly Neighbour[]):MotionStep;
}
let installed:NavigationRuntime|undefined;
export const navigationRuntime=()=>installed;
export function installNavigationRuntime(runtime:NavigationRuntime){
  const previous=installed;
  installed=runtime;return ()=>{if(installed===runtime)installed=previous;};
}
