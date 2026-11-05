import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { LANDSCAPE, MAP_WIDTH, MAP_DEPTH } from './world-data.ts';
import { polygonDistance } from './polygon.ts';
import { groundHeight, terrainHeight } from './terrain-height.ts';
import { roadEdgeDistance } from './road-layout.ts';
import { TerrainMaterialPlugin } from './terrain-material.ts';

const smooth=(a:number,b:number,value:number)=>{const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);};
/** One native heightfield owns soil, rock and shore. Static vertex weights
 * interpolate across triangles; no material boundary follows triangle edges.
 * The collision/picking heightfield and its resolution remain unchanged. */
export function createLandformMeshes(scene:Scene,grass:StandardMaterial){
  const {geography}=LANDSCAPE;
  const ground=MeshBuilder.CreateGround('landform-ground',{width:MAP_WIDTH,height:MAP_DEPTH,subdivisions:geography.resolution},scene);
  const positions=ground.getVerticesData('position')!,normals:number[]=[],all:number[]=[];
  const shoreDistance=(p:{x:number;z:number})=>Math.min(4,...LANDSCAPE.waterAreas.map(a=>p.x>=a.bounds.minX-4&&p.x<=a.bounds.maxX+4&&p.z>=a.bounds.minZ-4&&p.z<=a.bounds.maxZ+4?polygonDistance(p,a):4));
  for(let i=0;i<positions.length;i+=3)positions[i+1]=groundHeight(positions[i],positions[i+2])+.012;
  const original=ground.getIndices()!;
  for(let i=0;i<original.length;i+=3){
    const ids=[original[i],original[i+1],original[i+2]],v=ids.map(j=>Vector3.FromArray(positions,j*3));
    const p={x:(v[0].x+v[1].x+v[2].x)/3,z:(v[0].z+v[1].z+v[2].z)/3};
    if(geography.inside(p)&&shoreDistance(p)>=-1.5)all.push(...ids);
  }
  VertexData.ComputeNormals(positions,all,normals);
  const paintNormals=normals.slice(),stride=geography.resolution+1;
  // Narrow, steep ramps expose the alternating grid diagonals in their
  // lighting. Smooth only the shading normals over a small static stencil;
  // positions, picking heights and slope/material classification stay exact.
  for(let pass=0;pass<2;pass++){
    const source=normals.slice();
    for(let row=0;row<stride;row++)for(let col=0;col<stride;col++){
      const i=(row*stride+col)*3;
      let nx=0,ny=0,nz=0;
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        const r=row+dz,c=col+dx;if(r<0||r>=stride||c<0||c>=stride)continue;
        const j=(r*stride+c)*3,w=(dx===0?2:1)*(dz===0?2:1);
        nx+=source[j]*w;ny+=source[j+1]*w;nz+=source[j+2]*w;
      }
      const length=Math.hypot(nx,ny,nz)||1;normals[i]=nx/length;normals[i+1]=ny/length;normals[i+2]=nz/length;
    }
  }
  const low=Color3.FromHexString('#838772'),high=Color3.FromHexString('#b7b29b'),colors:number[]=[],weights:number[]=[];
  for(let i=0;i<positions.length;i+=3){
    const x=positions[i],y=positions[i+1],z=positions[i+2],p={x,z},ny=Math.abs(paintNormals[i+1]);
    const road=roadEdgeDistance(p),shore=shoreDistance(p);
    const rock=smooth(.06,.34,1-ny)*smooth(.18,.65,y)*smooth(-.05,.75,road);
    const bank=1-smooth(.35,2.7,shore);
    // Broad, slightly wandering strata follow the real face continuously.
    const band=.48+.12*Math.sin(y*2.1+Math.sin(x*.22+z*.16)*.55)+.07*Math.sin(x*.24-z*.18);
    const stone=Color3.Lerp(low,high,Math.min(1,Math.max(0,band+y*.01)));
    const wet=z<0,sand=Color3.FromHexString(wet?'#94aa8c':'#b9b58c'),inner=Color3.FromHexString('#8fbdb0');
    const shoreColor=Color3.Lerp(inner,sand,smooth(-.3,1,shore));
    const bankRock=smooth(.2,1.2,y-LANDSCAPE.waterLevel(p))*(1-smooth(.65,.9,ny));
    const tint=Color3.Lerp(stone,Color3.Lerp(shoreColor,stone,bankRock),bank);
    const weight=Math.max(rock,bank);
    colors.push(tint.r,tint.g,tint.b,weight);
    // UV2 is a static detail-strength channel, preserved by native batching.
    weights.push(smooth(.05,.65,road)*(1-weight),0);
  }
  ground.setVerticesData('position',positions);ground.setVerticesData('normal',normals);
  ground.setVerticesData('color',colors);ground.setVerticesData('uv2',weights);ground.hasVertexAlpha=false;
  ground.setIndices(all);ground.material=grass;new TerrainMaterialPlugin(grass);ground.subdivide(16);
  const outline=geography.outline.points;
  const side=MeshBuilder.CreateRibbon('landform-outer-bank',{pathArray:[0,1].map(row=>outline.map(p=>new Vector3(p.x,terrainHeight(p.x,p.z)-(row?3:.02),p.z))),closePath:true,sideOrientation:Mesh.DOUBLESIDE},scene);
  const earth=new StandardMaterial('landform-earth',scene);earth.diffuseColor=Color3.FromHexString('#777f56');earth.specularColor=Color3.Black();side.material=earth;
  return ground;
}
