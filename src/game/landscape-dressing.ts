import { insidePolygon, polygonDistance } from './polygon.ts';
import { isBlocked } from './movement.ts';
import type { Point, Obstacle } from './movement.ts';
import type { createLandforms } from './map-landforms.ts';
import type { PolygonArea } from './polygon.ts';

type Node=Point&{scale:number;rotation:number};
export type GroundDecoration=Point&{asset:'bush'|'stone';scale:[number,number,number];rotation:number};

/** Place loose, approachable objects in the economy once. Structural scenery
 * remains terrain; rejected resource positions get only low ground cover. */
export function createResourceDressing(
  geography:ReturnType<typeof createLandforms>,water:readonly PolygonArea[],
  contains:(p:Point)=>boolean,solids:readonly Obstacle[],occupied:readonly (Point&{radius:number})[],
  random:()=>number,
){
  const rocks:Node[]=[],forage:Node[]=[],decorations:GroundDecoration[]=[];
  const blockers:Obstacle[]=[...solids,...occupied.map(p=>({kind:'circle' as const,...p}))];
  function place(asset:'bush'|'stone',p:Point,visualScale:number){
    const scale=visualScale/(asset==='bush'?.7:.63),radius=scale*(asset==='bush'?.65:.85),rotation=random()*Math.PI*2;
    const y=geography.heightAt(p.x,p.z);
    const flat=Array.from({length:8},(_,i)=>({x:p.x+Math.cos(i*Math.PI/4)*(radius+.55),z:p.z+Math.sin(i*Math.PI/4)*(radius+.55)}))
      .every(q=>Math.abs(geography.heightAt(q.x,q.z)-y)<.35);
    const usable=contains(p)&&flat&&geography.roadDistance(p)>radius+2.1
      &&water.every(a=>polygonDistance(p,a)>radius+.9)&&!isBlocked(p,radius+.65,blockers);
    if(usable){
      (asset==='bush'?forage:rocks).push({...p,scale,rotation});blockers.push({kind:'circle',...p,radius});
    }else if(geography.inside(p)&&geography.roadDistance(p)>2.8&&water.every(a=>polygonDistance(p,a)>.6)){
      // Flat small ground cover cannot be mistaken for a full harvestable bush
      // or boulder. Never retain a second, unselectable copy of a resource.
      const s=.28+random()*.14;
      decorations.push({...p,asset,scale:[s,s*(asset==='bush'?.42:.32),s],rotation});
    }
  }
  for(const patch of geography.forests)for(const p of patch.area.points){
    const a=random()*Math.PI*2,q={x:p.x+Math.cos(a)*1.4,z:p.z+Math.sin(a)*1.4};
    if(!insidePolygon(q,patch.area))continue;
    place(random()<.2?'stone':'bush',q,.65+random()*.45);
  }
  // Sparse loose resources at the foot of cliffs; the cliff itself is fixed.
  for(const form of geography.forms.filter(f=>f.kind!=='basin'))for(let i=0;i<form.area.points.length;i+=3){
    const p=form.area.points[i],q=form.area.points[(i+1)%form.area.points.length],length=Math.hypot(q.x-p.x,q.z-p.z)||1;
    let nx=-(q.z-p.z)/length,nz=(q.x-p.x)/length;
    if(insidePolygon({x:p.x+nx*.3,z:p.z+nz*.3},form.area)){nx=-nx;nz=-nz;}
    const reach=Math.max(3.4,form.edge*.75);
    place(random()<.55?'stone':'bush',{x:p.x+nx*reach,z:p.z+nz*reach},.6+random()*.4);
  }
  return {rocks,forage,decorations};
}
