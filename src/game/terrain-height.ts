import { GRID_SIZE, LANDSCAPE } from './world-data.ts';
import type { Ray } from '@babylonjs/core/Culling/ray.js';
import { polygonDistance } from './polygon.ts';

/** Compact smooth terraces leave the home exactly flat. Heights affect visual
 * placement only; navigation/combat retain their established XZ distances. */
export function terrainHeight(x:number,z:number) {
  const terrace=(cx:number,cz:number,rx:number,rz:number,h:number)=>{
    const r=Math.hypot((x/GRID_SIZE-cx)/rx,(z/GRID_SIZE-cz)/rz);
    const t=Math.max(0,Math.min(1,(1-r)/.55));return h*t*t*(3-2*t);
  };
  return terrace(-2,27,15,13,2.5)+terrace(23,27,12,11,1.1)+terrace(-9,43,10,6,.9);
}
export function surfaceHeight(x:number,z:number) {
  const base=terrainHeight(x,z);
  for(const b of LANDSCAPE.bridges){
    if(Math.abs(x-b.x)>b.length/2+2||Math.abs(z-b.z)>b.length/2+2)continue;
    const c=Math.cos(b.angle),s=Math.sin(b.angle),along=(x-b.x)*c-(z-b.z)*s,across=(x-b.x)*s+(z-b.z)*c;
    if(Math.abs(along)<=b.length/2&&Math.abs(across)<=b.width/2)return base+.24*Math.cos(along/b.length*Math.PI)**2;
  }
  return base;
}
/** Static mesh/scenery sampling only; never used by the simulation loop. */
export function groundHeight(x:number,z:number) {
  const p={x,z},base=terrainHeight(x,z);
  const water=Math.min(...LANDSCAPE.waterAreas.map(a=>polygonDistance(p,a)));
  if(water<0)return base-1.5;
  if(LANDSCAPE.contains(p))return base;
  const edge=Math.min(water,...LANDSCAPE.playable.map(a=>polygonDistance(p,a)));
  const t=Math.max(0,Math.min(1,edge/3.5));
  return base+t*t*(3-2*t)*1.45;
}
/** Native picking ray intersected with the same smooth heightfield. Fixed
 * iterations suffice for the bounded slopes and the game's top-down camera. */
export function terrainRayDistance(ray:Ray) {
  if(Math.abs(ray.direction.y)<1e-6)return null;
  let distance=-ray.origin.y/ray.direction.y;
  for(let i=0;i<8;i++){
    const x=ray.origin.x+ray.direction.x*distance,z=ray.origin.z+ray.direction.z*distance;
    distance=(surfaceHeight(x,z)-ray.origin.y)/ray.direction.y;
  }
  return distance>0&&Number.isFinite(distance)?distance:null;
}
