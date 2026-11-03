import type { Bounds, Obstacle, Point } from './movement.ts';
import { occupiedApproach, planMoveDestination, type WorkNeighbour } from './work-navigation.ts';
import { segmentIsClear } from './wander.ts';

export interface NavigationInput { start:Point; goal:Point; radius:number; bounds:Bounds; solids:readonly Obstacle[]; neighbours:readonly WorkNeighbour[]; routeHint?:readonly Point[] }
export function planNavigation(p:NavigationInput){
  // Group members can share the corridor, but each has its own start, body
  // radius and destination. Never reuse a route without exact live checks.
  if(p.routeHint?.length){
    const joined=validateNavigation(p,[...p.routeHint.slice(0,-1),p.goal]);
    if(joined)return joined;
  }
  return planMoveDestination(p.start,p.goal,p.radius,p.bounds,p.solids,p.neighbours);
}
/** A worker snapshot may be out of date. Join from the live position and
 * recheck the entire swept route and destination before accepting the order. */
export function validateNavigation(p:NavigationInput,path:readonly Point[]){
  if(!path.length||path.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.z))||occupiedApproach(path.at(-1)!,p.radius,p.neighbours))return;
  for(let join=path.length-1;join>=0;join--){
    let previous=p.start,valid=true;
    for(let i=join;i<path.length;i++){
      if(!segmentIsClear(previous,path[i],p.radius,p.bounds,p.solids)){valid=false;break;}
      previous=path[i];
    }
    if(!valid)continue;
    return path.slice(join).map(v=>({x:v.x,z:v.z}));
  }
}
