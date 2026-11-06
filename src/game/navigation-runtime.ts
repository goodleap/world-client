import type { PathQuery, PlannedPath } from './path-planner.ts';
import type { Bounds, Obstacle, Point } from './movement.ts';
import type { RouteState } from './route-following.ts';

export interface MotionStep { position:Point; velocity:Point; distance:number; path:Point[]; unreachable:boolean; facing:number|undefined }
export interface NavigationRuntime {
  plan(query:PathQuery):PlannedPath;
  step(id:string,position:Point,route:Point[],state:RouteState,seconds:number,speed:number,radius:number,bounds:Bounds,solids:readonly Obstacle[]):MotionStep;
}
let installed:NavigationRuntime|undefined;
export const navigationRuntime=()=>installed;
export function installNavigationRuntime(runtime:NavigationRuntime){
  if(installed)throw new Error('Navigation runtime already installed');
  installed=runtime;return ()=>{if(installed===runtime)installed=undefined;};
}
