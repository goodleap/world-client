import type { Bounds,Obstacle,Point } from './movement.ts';
import { navigationRuntime } from './navigation-runtime.ts';
import { segmentIsClear } from './wander.ts';
/** Pure-call entry point for navigation checks and regression fixtures. Recast
 * owns every nontrivial path query; there is no grid A* implementation. */
export function findPathToGoals(start:Point,goals:readonly Point[],radius:number,bounds:Bounds,obstacles:readonly Obstacle[]):Point[]|undefined{
  if(goals[0]&&segmentIsClear(start,goals[0],radius,bounds,obstacles))return [{...goals[0]}];
  const native=navigationRuntime();if(!native)throw new Error('Navigation must be initialized before path queries');
  return native.plan({start,goals,radius,bounds,obstacles})??undefined;
}
export const findPath=(start:Point,goal:Point,radius:number,bounds:Bounds,obstacles:readonly Obstacle[])=>findPathToGoals(start,[goal],radius,bounds,obstacles);
