import clipping from 'polygon-clipping';
import type { Polygon, MultiPolygon } from 'polygon-clipping';
import { Curve3 } from '@babylonjs/core/Maths/math.path.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import { polygonArea, polygonDistance, insidePolygon } from './polygon.ts';
import type { PolygonArea } from './polygon.ts';
import type { Point } from './movement.ts';

type Pair=readonly [number,number];
export interface Landform { id:string; kind:'terrace'|'ridge'|'basin'; height:number; edge:number; area:PolygonArea }
export interface ForestPatch { id:string; species:'oak'|'pine'|'sapling'|'fruit'|'blossom'; area:PolygonArea; spacing:number }
const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
const ring=(pairs:readonly Pair[],grid:number,samples=5)=>Curve3.CreateCatmullRomSpline(pairs.map(([x,z])=>new Vector3(x*grid,0,z*grid)),samples,true).getPoints().slice(0,-1).map(p=>({x:p.x,z:p.z}));
const polygon=(points:readonly Point[]):Polygon=>[points.map(p=>[p.x,p.z])];
function strips(path:readonly Point[],halfWidth:number):Polygon[]{
  return path.slice(1).map((b,i)=>{const a=path[i],n=Math.hypot(b.x-a.x,b.z-a.z)||1,dx=(b.z-a.z)/n*halfWidth,dz=(a.x-b.x)/n*halfWidth;
    return [[[a.x+dx,a.z+dz],[b.x+dx,b.z+dz],[b.x-dx,b.z-dz],[a.x-dx,a.z-dz]]];});
}
function contourBand(points:readonly Point[],halfWidth:number):MultiPolygon {
  const pieces=strips([...points,points[0]],halfWidth);return clipping.union(pieces[0],...pieces.slice(1));
}

/** Geography is authored first: stepped tablelands, a sunken western valley,
 * enclosing ridges and a northern mountain pass. Roads cut explicit approaches
 * through these forms; they no longer define the shape of every clearing. */
export function createLandforms(grid:number,paths:readonly (readonly Point[])[]) {
  const outline=polygonArea(ring([[-47,-33],[-39,-44],[-22,-47],[-7,-44],[8,-46],[24,-44],[39,-37],[47,-23],[48,-5],[47,14],[44,30],[34,43],[15,47],[-3,46],[-20,48],[-37,41],[-47,25],[-46,6],[-49,-13]],grid));
  const forms:Landform[]=[];
  const add=(id:string,kind:Landform['kind'],height:number,edge:number,p:readonly Pair[])=>forms.push({id,kind,height,edge:edge*grid,area:polygonArea(ring(p,grid))});
  add('highland-foot','terrace',3.3,.7,[[-19,14],[-20,25],[-16,34],[-7,37],[5,34],[13,27],[12,18],[4,12],[-8,11]]);
  add('highland-crown','terrace',4.5,.55,[[-14,18],[-15,26],[-10,32],[-2,33],[6,29],[8,23],[4,17],[-5,16]]);
  add('ruin-shelf','terrace',5.2,.65,[[21,21],[19,28],[23,34],[32,34],[37,28],[34,21],[28,19]]);
  add('quarry-floor','basin',-1.8,2.7,[[-43,-17],[-45,-7],[-39,-3],[-31,-6],[-29,-13],[-36,-20]]);
  add('ravine-floor','basin',-1.5,2,[[-33,-3],[-35,6],[-34,17],[-29,23],[-26,16],[-28,5]]);
  add('quarry-back','ridge',10.8,1.6,[[-47,-11],[-47,1],[-42,7],[-37,7],[-35,2],[-39,-2],[-40,-9]]);
  add('western-ridge','ridge',12.4,1.8,[[-46,9],[-46,24],[-40,31],[-35,27],[-37,20],[-37,12],[-40,8]]);
  add('valley-east-wall','ridge',8.7,1.2,[[-26,5],[-23,8],[-21,17],[-24,21],[-27,17],[-28,9]]);
  add('northwestern-range','ridge',17,2.5,[[-41,33],[-34,44],[-23,47],[-15,44],[-17,39],[-25,36],[-31,31]]);
  add('pass-east-range','ridge',18.5,2.3,[[-4,40],[3,46],[17,47],[24,43],[20,39],[12,38],[6,40],[1,37]]);
  add('northeastern-range','ridge',14.5,2.4,[[30,37],[36,43],[44,34],[45,25],[41,23],[38,29]]);
  add('orchard-shoulder','terrace',2.4,.75,[[7,-17],[15,-14],[24,-17],[27,-24],[21,-29],[13,-28],[8,-23]]);
  const forests:ForestPatch[]=[];
  const forest=(id:string,species:ForestPatch['species'],spacing:number,p:readonly Pair[])=>forests.push({id,species,spacing,area:polygonArea(ring(p,grid))});
  forest('west-woods','oak',4.4,[[-44,-29],[-44,-20],[-38,-18],[-33,-23],[-32,-32],[-39,-36]]);
  forest('home-west','oak',4.8,[[-30,-7],[-30,1],[-24,5],[-19,3],[-17,-5],[-23,-10]]);
  forest('northern-pines','pine',3.8,[[-37,21],[-36,33],[-29,38],[-22,34],[-24,27],[-30,22]]);
  forest('ruin-woods','oak',4.6,[[34,15],[36,24],[42,26],[45,19],[43,10],[39,8]]);
  forest('south-border','oak',4.7,[[-27,-43],[-20,-39],[-12,-41],[-7,-45],[-18,-47]]);
  forest('east-wetland','sapling',4.9,[[39,-38],[44,-30],[46,-22],[43,-17],[40,-22],[37,-32]]);
  forest('creek-grove','oak',4.5,[[8,2],[10,10],[17,12],[20,8],[17,3],[13,0]]);
  // Corridors through actual solid landforms are visible cuts/ramps. Rounded
  // joints make the physical openings agree with the rendered approaches.
  const roadPieces=paths.flatMap(p=>strips(p,3.05));
  for(const path of paths)for(const p of path)roadPieces.push([Array.from({length:12},(_,i)=>[p.x+Math.cos(i*Math.PI/6)*3.05,p.z+Math.sin(i*Math.PI/6)*3.05])]);
  const approaches=clipping.union(roadPieces[0],...roadPieces.slice(1));
  const solids:MultiPolygon[]=[];
  for(const f of forms)if(f.kind!=='basin')solids.push(clipping.difference(f.kind==='ridge'?[polygon(f.area.points)]:contourBand(f.area.points,1.5),approaches));
  for(const f of forests)solids.push(clipping.difference(polygon(f.area.points),approaches));
  const landSolid=clipping.union(solids[0],...solids.slice(1));
  const naturalGround=(x:number,z:number)=>{
    const p={x,z};let y=0;
    for(const f of forms){
      if(x<f.area.bounds.minX-f.edge||x>f.area.bounds.maxX+f.edge||z<f.area.bounds.minZ-f.edge||z>f.area.bounds.maxZ+f.edge)continue;
      const d=polygonDistance(p,f.area),edge=f.edge;
      if(d>edge)continue;
      const t=smooth((edge*.45-d)/edge);
      let h=f.height;
      if(f.kind==='ridge')h*=.76+.13*Math.sin(x*.21+z*.13)+.11*Math.sin(z*.38-x*.09);
      y+=h*t;
    }
    // A stepped stream descends through the eastern foothills. The same
    // elevation field shapes its banks; water is published in level reaches.
    const east=smooth((x/grid-9)/4)*(1-smooth((x/grid-37)/7));
    y+=east*(1.65*smooth((z/grid-12)/5.3)+1.75*smooth((z/grid-22)/4.8));
    return y;
  };
  const roadSegments=paths.flatMap(path=>{
    const heights=path.map(p=>naturalGround(p.x,p.z));
    const filtered=heights.map((_,i)=>{let y=0,w=0;for(let j=Math.max(0,i-3);j<=Math.min(path.length-1,i+3);j++){const a=4-Math.abs(j-i);y+=heights[j]*a;w+=a;}return y/w;});
    return path.slice(1).map((b,i)=>({a:path[i],b,ya:filtered[i],yb:filtered[i+1]}));
  });
  const authoredHeight=(x:number,z:number)=>{
    let y=naturalGround(x,z),nearest=20,height=y;
    for(const {a,b,ya,yb} of roadSegments){
      if(x<Math.min(a.x,b.x)-4.5||x>Math.max(a.x,b.x)+4.5||z<Math.min(a.z,b.z)-4.5||z>Math.max(a.z,b.z)+4.5)continue;
      const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));
      const d=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);if(d<nearest){nearest=d;height=ya+(yb-ya)*t;}
    }
    if(nearest<4.5)y+=(height-y)*(1-smooth((nearest-1.7)/2.8));
    return y;
  };
  // Static native terrain uses this same grid. Runtime movement/picking sample
  // four cached heights, avoiding polygon-distance work for every actor/frame.
  const resolution=320,width=100*grid,step=width/resolution,heights=new Float32Array((resolution+1)**2);
  for(let row=0;row<=resolution;row++)for(let col=0;col<=resolution;col++)heights[row*(resolution+1)+col]=authoredHeight(col*step-width/2,row*step-width/2);
  const heightAt=(x:number,z:number)=>{
    const fx=Math.max(0,Math.min(resolution-.00001,(x+width/2)/step)),fz=Math.max(0,Math.min(resolution-.00001,(z+width/2)/step));
    const col=Math.floor(fx),row=Math.floor(fz),tx=fx-col,tz=fz-row,i=row*(resolution+1)+col;
    const a=heights[i],b=heights[i+1],c=heights[i+resolution+1],d=heights[i+resolution+2];
    return tx+tz<=1?a+(b-a)*tx+(c-a)*tz:d+(c-d)*(1-tx)+(b-d)*(1-tz);
  };
  const roadDistance=(p:Point)=>{let nearest=Infinity;for(const {a,b} of roadSegments){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));nearest=Math.min(nearest,Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz));}return nearest;};
  return {outline,forms,forests,landSolid,heightAt,resolution,roadDistance,inside:(p:Point)=>insidePolygon(p,outline)};
}
