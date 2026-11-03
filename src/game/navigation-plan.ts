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
  const clear=(a:Point,b:Point)=>segmentIsClear(a,b,p.radius,p.bounds,p.solids);
  let join=path.length-1;while(join>=0&&!clear(p.start,path[join]))join--;
  if(join<0)return;
  for(let i=join+1;i<path.length;i++)if(!clear(path[i-1],path[i]))return;
  return path.slice(join).map(v=>({x:v.x,z:v.z}));
}
