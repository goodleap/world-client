import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Palette } from './models.ts';
import type { Point } from './movement.ts';
import { GRID_SIZE } from './world-data.ts';
import { ellipsoid } from './environment-shapes.ts';

const neighbours = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]] as const;
export const farmGridKey = (p: Point) => `${Math.round(p.x / GRID_SIZE * 2)}:${Math.round(p.z / GRID_SIZE * 2)}`;
export function farmNeighbourMask(p: Point, tilled: ReadonlySet<string>) {
  return neighbours.reduce((mask, [x,z], i) => mask | (tilled.has(farmGridKey({x:p.x+x*GRID_SIZE,z:p.z+z*GRID_SIZE})) ? 1<<i : 0), 0);
}

type Boundary = { vertical: boolean; at: number; from: number; to: number };
const outlines = new Map<number, Boundary[]>();
function boundary(mask: number) {
  const cached=outlines.get(mask);if(cached)return cached;
  const cells=[[0,0],...neighbours.filter((_,i)=>mask & 1<<i)];
  const occupied=new Set(cells.map(([x,z])=>`${x}:${z}`));
  const lines=new Map<string,{vertical:boolean;at:number;ranges:number[][]}>();
  for(const [x,z] of cells)for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]){
    if(occupied.has(`${x+dx}:${z+dz}`))continue;
    const vertical=!!dx,at=vertical?x*2+dx:z*2+dz,along=vertical?z:x,key=`${vertical}:${at}`;
    let line=lines.get(key);if(!line){line={vertical,at,ranges:[]};lines.set(key,line);}
    line.ranges.push([along*2-1,along*2+1]);
  }
  const edges:Boundary[]=[];
  for(const line of lines.values()){
    const merged:number[][]=[];
    for(const range of line.ranges.sort((a,b)=>a[0]-b[0])){
      const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);
    }
    for(const [from,to] of merged)edges.push({vertical:line.vertical,at:line.at*GRID_SIZE/2,from:from*GRID_SIZE/2,to:to*GRID_SIZE/2});
  }
  outlines.set(mask,edges);return edges;
}

/** Only exposed perimeter segments shape the shoulder. Collinear edges merge,
 * so adjacent tiles do not leave a notch in an otherwise straight outer edge. */
function surface(edges: readonly Boundary[], x: number, z: number) {
  const band=.60;let influence=0;
  for(const edge of edges){
    const across=edge.vertical?x:z,along=edge.vertical?z:x;
    const distance=Math.hypot(across-edge.at,Math.max(edge.from-along,0,along-edge.to));
    influence+=Math.max(0,1-distance/band)**2;
  }
  const distance=band*(1-Math.sqrt(influence));
  const t=Math.max(0,Math.min(1,(distance-.025)/.26));
  return -.018+.205*(t*t*(3-2*t));
}

/** Native ground tessellation, analytic smooth normals and shared materials.
 * Adjacency variants preserve per-cell picking/work without visible grass seams. */
export function createFarmModel(scene: Scene, palette: Palette, mask=0) {
  let earth=scene.getMaterialByName('farm-earth') as StandardMaterial|null;
  if(!earth){earth=new StandardMaterial('farm-earth',scene);earth.diffuseColor=Color3.White();earth.specularColor=Color3.Black();}
  const edges=boundary(mask);
  const soil=MeshBuilder.CreateGround('farm-soil',{width:GRID_SIZE,height:GRID_SIZE,subdivisions:64},scene);
  const positions=soil.getVerticesData(VertexBuffer.PositionKind)!,normals:number[]=[],colors:number[]=[];
  const low=Color3.FromHexString('#a96335'),high=Color3.FromHexString('#cf8b4e'),epsilon=.0005;
  for(let i=0;i<positions.length;i+=3){
    // Concentrate the native grid on curved shoulders, retaining a broad top.
    const x=Math.sin(positions[i]/GRID_SIZE*Math.PI)*GRID_SIZE/2,z=Math.sin(positions[i+2]/GRID_SIZE*Math.PI)*GRID_SIZE/2;
    const y=surface(edges,x,z);positions[i]=x;positions[i+1]=y;positions[i+2]=z;
    const nx=(surface(edges,x-epsilon,z)-surface(edges,x+epsilon,z))/(2*epsilon);
    const nz=(surface(edges,x,z-epsilon)-surface(edges,x,z+epsilon))/(2*epsilon),length=Math.hypot(nx,1,nz);
    normals.push(nx/length,1/length,nz/length);
    const tint=Color3.Lerp(low,high,(y+.018)/.205);
    const edge=Math.max(0,1-(y+.018)/.065),blended=Color3.Lerp(tint,palette.grass.diffuseColor,edge);
    colors.push(blended.r,blended.g,blended.b,1);
  }
  soil.setVerticesData(VertexBuffer.PositionKind,positions);
  soil.setVerticesData(VertexBuffer.NormalKind,normals);
  soil.setVerticesData(VertexBuffer.ColorKind,colors);soil.material=earth;
  for(const [x,z,size] of [[-.39,.21,.025],[.38,-.33,.032],[.44,.35,.022]]){
    const grain=ellipsoid(scene,'farm-soil-grain',[size*1.6,size*.6,size],[x,surface(edges,x,z)+size*.12,z],earth,6);
    const tint=Color3.FromHexString('#c4864c');
    grain.setVerticesData(VertexBuffer.ColorKind,Array.from({length:grain.getTotalVertices()},()=>[tint.r,tint.g,tint.b,1]).flat());
  }
  return soil;
}
