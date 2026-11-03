import {sweepIsBlocked} from './movement.ts';
import type {Point,Bounds,Obstacle} from './movement.ts';
export interface MovingBody { halfLength:number; heading:number }
export const CAVALRY_BODY={radius:.46,halfLength:.64};
export const angleDelta=(a:number,b:number)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
export function bodyEnds(p:Point,b:MovingBody){const x=Math.sin(b.heading)*b.halfLength,z=Math.cos(b.heading)*b.halfLength;return [{x:p.x-x,z:p.z-z},{x:p.x+x,z:p.z+z}] as const;}
export function bodyObstacle(p:Point,radius:number,body?:MovingBody):Obstacle{
  if(!body)return {kind:'circle',...p,radius};
  const [a,b]=bodyEnds(p,body);return {kind:'capsule',x:p.x,z:p.z,a,b,radius};
}
export function bodyAtClear(p:Point,radius:number,b:MovingBody,bounds:Bounds,solids:readonly Obstacle[]){
  const [a,z]=bodyEnds(p,b);
  return [a,z].every(p=>p.x>=bounds.minX+radius&&p.x<=bounds.maxX-radius&&p.z>=bounds.minZ+radius&&p.z<=bounds.maxZ-radius)
    &&!sweepIsBlocked(a,z,radius,solids);
}
export function bodyTurnClear(p:Point,radius:number,b:MovingBody,heading:number,bounds:Bounds,solids:readonly Obstacle[]){
  const angle=angleDelta(b.heading,heading),steps=Math.max(1,Math.ceil(Math.abs(angle)/.12));
  // The added angular margin covers all positions between adjacent samples.
  const padding=b.halfLength*Math.sin(Math.abs(angle)/steps/2);
  for(let i=0;i<=steps;i++)if(!bodyAtClear(p,radius+padding,{...b,heading:b.heading+angle*i/steps},bounds,solids))return false;
  return true;
}
export function bodySegmentClear(from:Point,to:Point,radius:number,b:MovingBody,bounds:Bounds,solids:readonly Obstacle[]){
  if(Math.hypot(to.x-from.x,to.z-from.z)<1e-8)return bodyAtClear(from,radius,b,bounds,solids);
  const heading=Math.atan2(to.x-from.x,to.z-from.z),aligned={...b,heading};
  if(!bodyTurnClear(from,radius,b,heading,bounds,solids)||!bodyAtClear(to,radius,aligned,bounds,solids))return false;
  // Once aligned, the exact swept capsule is one longer capsule.
  return !sweepIsBlocked(bodyEnds(from,aligned)[0],bodyEnds(to,aligned)[1],radius,solids);
}
