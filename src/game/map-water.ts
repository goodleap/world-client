import clipping from 'polygon-clipping';
import type { Polygon } from 'polygon-clipping';
import { Curve3 } from '@babylonjs/core/Maths/math.path.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import { areas, corridor, smoothPolygon } from './map-regions.ts';
import { insidePolygon, polygonArea } from './polygon.ts';
import type { PolygonArea } from './polygon.ts';
import type { Point } from './movement.ts';

export interface MapBridge extends Point { id:string; angle:number; length:number; width:number; area:PolygonArea }
export function createMapWater(grid:number, roads:readonly (readonly Point[])[]) {
  const points=(pairs:number[][])=>pairs.map(([x,z])=>({x:x*grid,z:z*grid}));
  const lakeShape=smoothPolygon(points([[35,23],[40,25],[44,23],[45,18],[47,14],[45,10],[46,7],[43,3],[40,1],[36,2],[34,5],[31,6],[30,10],[32,13],[31,17],[33,20]]),7);
  const lake=areas(clipping.union(lakeShape))[0];
  const stream=Curve3.CreateCatmullRomSpline(points([[15,31],[18,25],[19,20],[23,16],[24,10],[29,6],[35,8]]).map(p=>new Vector3(p.x,0,p.z)),9,false).getPoints();
  const riverWidth=(p:Point)=>grid*(.95+.16*Math.sin(p.z*.13));
  const ponds=[[[36,-18],[39,-20],[40,-24],[38,-26],[34,-24],[33,-21]],[[40,-30],[45,-28],[46,-32],[43,-37],[40,-37],[38,-34]],[[28,-32],[31,-30],[33,-33],[32,-36],[29,-36]]].map(p=>smoothPolygon(points(p)));
  const water=clipping.union(lakeShape,corridor(stream,riverWidth),...ponds);
  const bridges:MapBridge[]=[],bridgeShapes:Polygon[]=[];
  const cross=(ax:number,az:number,bx:number,bz:number)=>ax*bz-az*bx;
  for(const road of roads)for(let i=1;i<road.length;i++)for(let j=1;j<stream.length;j++) {
    const a=road[i-1],b=road[i],c=stream[j-1],d=stream[j];
    const dx=b.x-a.x,dz=b.z-a.z,sx=d.x-c.x,sz=d.z-c.z,den=cross(dx,dz,sx,sz);
    if(Math.abs(den)<1e-6)continue;
    const t=cross(c.x-a.x,c.z-a.z,sx,sz)/den,u=cross(c.x-a.x,c.z-a.z,dx,dz)/den;
    if(t<0||t>1||u<0||u>1)continue;
    const p={x:a.x+t*dx,z:a.z+t*dz};
    if(insidePolygon(p,lake)||bridges.some(b=>Math.hypot(b.x-p.x,b.z-p.z)<8))continue;
    const distance=Math.hypot(dx,dz),nx=dx/distance,nz=dz/distance;
    const sine=Math.abs(den)/(distance*Math.hypot(sx,sz));
    const length=2*riverWidth(p)/Math.max(.3,sine)+3.2,width=3.6;
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([l,w])=>({x:p.x+nx*l*length/2-nz*w*width/2,z:p.z+nz*l*length/2+nx*w*width/2}));
    bridges.push({...p,id:`bridge-${bridges.length}`,angle:-Math.atan2(nz,nx),length,width,area:polygonArea(corners)});
    bridgeShapes.push([corners.map(q=>[q.x,q.z])]);
  }
  const solids=bridgeShapes.length?clipping.difference(water,...bridgeShapes):water;
  const zone=(minZ:number,maxZ:number):Polygon=>[[[-50*grid,minZ*grid],[30*grid,minZ*grid],[30*grid,maxZ*grid],[-50*grid,maxZ*grid]]];
  const high=clipping.intersection(water,zone(26.8,50)),middle=clipping.intersection(water,zone(17.3,26.8));
  const low=clipping.difference(water,high,middle);
  const reaches=[...areas(high).map(a=>({...a,level:3.4})),...areas(middle).map(a=>({...a,level:1.65})),...areas(low).map(a=>({...a,level:0}))];
  const waterLevel=(p:Point)=>p.x<30*grid?(p.z>26.8*grid?3.4:p.z>17.3*grid?1.65:0):0;
  return {lake,water,waterAreas:areas(water),reaches,waterLevel,waterSolids:areas(solids),waterSolidPolygons:solids,bridges,stream};
}
