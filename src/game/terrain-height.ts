import { LANDSCAPE } from './world-data.ts';
import type { Ray } from '@babylonjs/core/Culling/ray.js';
import { polygonDistance } from './polygon.ts';

/** Native terrain-triangle interpolation from the cached authored heightfield. */
export function terrainHeight(x:number,z:number) {
  return LANDSCAPE.geography.heightAt(x,z);
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
  if(water<0)return LANDSCAPE.waterLevel(p)-1.8;
  return base;

}
/** Find the first surface crossing, including steep terraces. A bracketed ray
 * test cannot oscillate between the foot and top of a cliff like plane iteration. */
export function terrainRayDistance(ray:Ray) {
  if(Math.abs(ray.direction.y)<1e-6)return null;
  const a=(25-ray.origin.y)/ray.direction.y,b=(-5-ray.origin.y)/ray.direction.y;
  const start=Math.max(0,Math.min(a,b)),end=Math.max(a,b);
  if(!Number.isFinite(end)||end<=start)return null;
  const above=(t:number)=>ray.origin.y+ray.direction.y*t-surfaceHeight(ray.origin.x+ray.direction.x*t,ray.origin.z+ray.direction.z*t);
  let previous=start,sign=above(start);
  for(let i=1;i<=64;i++){
    const t=start+(end-start)*i/64,value=above(t);
    if(sign>=0&&value<=0){let lo=previous,hi=t;for(let j=0;j<16;j++){const mid=(lo+hi)/2;if(above(mid)>0)lo=mid;else hi=mid;}return (lo+hi)/2;}
    previous=t;sign=value;
  }
  return null;
}
