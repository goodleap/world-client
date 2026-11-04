import { Curve3 } from '@babylonjs/core/Maths/math.path.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import clipping from 'polygon-clipping';
import type { MultiPolygon, Polygon, Pair } from 'polygon-clipping';
import { polygonArea, insidePolygon } from './polygon.ts';
import type { PolygonArea } from './polygon.ts';
import type { Point } from './movement.ts';

export const MAP_CONFIG = { columns: 100, rows: 100, seed: 20261104 } as const;
export type Biome = 'home' | 'meadow' | 'orchard' | 'woodland' | 'conifers' | 'rock' | 'highland' | 'ruins' | 'creek' | 'lake' | 'wetland' | 'camp';
const outlines = {
  clearing: [[-.95,-.65],[-.45,-1],[.4,-.94],[.9,-.5],[1,.3],[.55,.86],[-.25,1],[-.95,.5]],
  meadow: [[-1,-.45],[-.6,-.93],[.1,-.9],[.8,-.6],[.96,.2],[.45,.8],[-.4,.9],[-.85,.5]],
  grove: [[-.94,-.5],[-.5,-.85],[.15,-.72],[.8,-.96],[.95,-.25],[.55,.3],[.85,.75],[.05,.95],[-.7,.65]],
  valley: [[-.7,-1],[-.05,-.83],[.4,-.4],[.87,-.2],[.65,.5],[.95,.93],[.2,.85],[-.5,.3],[-.87,.45],[-.75,-.3]],
  terrace: [[-1,-.25],[-.65,-.88],[.15,-.8],[.8,-.5],[1,.05],[.55,.7],[-.1,.94],[-.7,.6]],
  shore: [[-.85,-.9],[-.2,-1],[.55,-.7],[.95,-.1],[.65,.65],[.05,.96],[-.55,.6],[-.25,.05]],
} as const;
interface RegionDefinition { id:string; name:string; x:number; z:number; rx:number; rz:number; biome:Biome; shape:keyof typeof outlines; camp?:string }
export const REGION_LAYOUT: readonly RegionDefinition[] = [
  {id:'home',name:'家园',x:0,z:0,rx:15.5,rz:12.5,biome:'home',shape:'clearing'},
  {id:'meadow',name:'花野',x:-16,z:-25,rx:12,rz:9.5,biome:'meadow',shape:'meadow'},
  {id:'orchard',name:'果林',x:15,z:-24,rx:11,rz:10,biome:'orchard',shape:'grove'},
  {id:'woodland',name:'阔叶林',x:-25,z:2,rx:11,rz:10,biome:'woodland',shape:'grove'},
  {id:'conifers',name:'针叶林',x:-28,z:26,rx:12,rz:10,biome:'conifers',shape:'grove'},
  {id:'stone-hollow',name:'岩谷',x:-39,z:12,rx:7.5,rz:11,biome:'rock',shape:'valley'},
  {id:'quarry',name:'矿场',x:-36,z:-12,rx:10,rz:8.5,biome:'rock',shape:'terrace',camp:'quarry'},
  {id:'highland',name:'高地',x:-2,z:27,rx:13,rz:10,biome:'highland',shape:'terrace'},
  {id:'ruins',name:'古遗迹',x:23,z:27,rx:10,rz:9,biome:'ruins',shape:'clearing'},
  {id:'pass',name:'山口',x:-9,z:43,rx:9,rz:5.5,biome:'rock',shape:'valley',camp:'pass'},
  {id:'frontier',name:'边境营地',x:15,z:42,rx:10,rz:6,biome:'camp',shape:'terrace'},
  {id:'creek',name:'溪谷',x:19,z:10,rx:10,rz:9,biome:'creek',shape:'valley'},
  {id:'lake-bay',name:'湖湾',x:36,z:-6,rx:11,rz:9,biome:'lake',shape:'shore'},
  {id:'wetland',name:'湿地',x:35,z:-28,rx:10,rz:11,biome:'wetland',shape:'shore'},
];
export const ROUTE_LAYOUT = [
  [[0,0],[-10,1],[-18,-1],[-25,2]], [[-25,2],[-21,13],[-24,20],[-28,26]],
  [[-28,26],[-18,28],[-12,24],[-2,27]], [[-2,27],[7,20],[14,18],[19,10]],
  [[19,10],[12,6],[8,0],[0,0]], [[0,0],[-6,-13],[-10,-19],[-16,-25]],
  [[-16,-25],[-3,-28],[6,-26],[15,-24]], [[15,-24],[13,-15],[13,-4],[8,0],[0,0]],
  [[15,-24],[24,-25],[28,-30],[35,-28]], [[35,-28],[39,-18],[36,-6]],
  [[36,-6],[32,-1],[27,3],[19,10]], [[-25,2],[-34,3],[-39,12]],
  [[-39,12],[-42,0],[-39,-7],[-36,-12]], [[-36,-12],[-27,-20],[-16,-25]],
  [[-28,26],[-21,34],[-16,40],[-9,43]], [[-9,43],[-2,35],[-2,27]],
  [[-9,43],[4,44],[15,42]], [[15,42],[24,36],[23,27]],
  [[-2,27],[10,29],[16,26],[23,27]], [[23,27],[29,19],[25,14],[19,10]],
] as const;
export function areas(polygons: MultiPolygon): PolygonArea[] {
  return polygons.map(rings => ({ ...polygonArea(rings[0].slice(0,-1).map(([x,z])=>({x,z}))),
    holes:rings.slice(1).map(ring=>polygonArea(ring.slice(0,-1).map(([x,z])=>({x,z})))) }));
}
export function smoothPolygon(points:readonly Point[], samples=5):Polygon {
  return [Curve3.CreateCatmullRomSpline(points.map(p=>new Vector3(p.x,0,p.z)),samples,true).getPoints().slice(0,-1).map(p=>[p.x,p.z] as Pair)];
}
export function corridor(path:readonly Point[], width:(p:Point)=>number):MultiPolygon {
  const strips:Polygon[]=[];
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],d=Math.hypot(b.x-a.x,b.z-a.z);
    if(d<1e-6)continue;
    const nx=(b.z-a.z)/d,nz=(a.x-b.x)/d,wa=width(a),wb=width(b);
    strips.push([[[a.x+nx*wa,a.z+nz*wa],[b.x+nx*wb,b.z+nz*wb],[b.x-nx*wb,b.z-nz*wb],[a.x-nx*wa,a.z-nz*wa]]]);
    for(const p of [a,b])strips.push([Array.from({length:12},(_,j):Pair=>[p.x+Math.cos(j*Math.PI/6)*width(p),p.z+Math.sin(j*Math.PI/6)*width(p)])]);
  }
  return clipping.union(strips[0],...strips.slice(1));
}
export function createRegions(grid:number,paths:readonly (readonly Point[])[],water:MultiPolygon=[],waterSolids:MultiPolygon=water) {
  const shapes=REGION_LAYOUT.map(r=>smoothPolygon(outlines[r.shape].map(([x,z])=>({x:(r.x+x*r.rx)*grid,z:(r.z+z*r.rz)*grid}))));
  const regions=REGION_LAYOUT.map((r,i)=>({...r,x:r.x*grid,z:r.z*grid,area:areas(clipping.union(shapes[i]))[0]}));
  const strips=paths.map(p=>corridor(p,q=>grid*(1.85+.22*Math.sin(q.x*.06+q.z*.09))));
  const land=clipping.union(shapes[0],...shapes.slice(1),...strips);
  const width=MAP_CONFIG.columns*grid,depth=MAP_CONFIG.rows*grid;
  const rect=(x:number,z:number,w:number,h:number):Polygon=>[[[x,z],[x+w,z],[x+w,z+h],[x,z+h]]];
  const blocked=clipping.difference(rect(-width/2,-depth/2,width,depth),clipping.union(land,water));
  const obstacles:PolygonArea[]=[],tile=grid*10;
  for(let z=-depth/2;z<depth/2;z+=tile)for(let x=-width/2;x<width/2;x+=tile) {
    obstacles.push(...areas(clipping.intersection(blocked,rect(x,z,Math.min(tile,width/2-x),Math.min(tile,depth/2-z)))));
  }
  const playable=areas(clipping.difference(land,waterSolids));
  return {regions,land,blocked,obstacles,playable,contains:(p:Point)=>playable.some(a=>insidePolygon(p,a))};
}
export const pathDistanceSquared=(p:Point,a:Point,b:Point)=>{
  const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));
  return (p.x-a.x-dx*t)**2+(p.z-a.z-dz*t)**2;
};
