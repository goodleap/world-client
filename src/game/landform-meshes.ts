import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { LANDSCAPE, MAP_WIDTH, MAP_DEPTH } from './world-data.ts';
import { BIOME_COLORS } from './biomes.ts';
import { polygonDistance } from './polygon.ts';
import { groundHeight, terrainHeight } from './terrain-height.ts';

/** Native terrain geometry is shared by soil and exposed rock. Each triangle
 * belongs to exactly one material; there are no overlapping cliff/ground skins. */
export function createLandformMeshes(scene:Scene,grass:StandardMaterial){
  const {geography}=LANDSCAPE;
  const ground=MeshBuilder.CreateGround('landform-ground',{width:MAP_WIDTH,height:MAP_DEPTH,subdivisions:geography.resolution},scene);
  const positions=ground.getVerticesData('position')!,normals:number[]=[],soil:number[]=[],rockIndices:number[]=[],bankIndices:number[]=[],all:number[]=[];
  const shoreDistance=(p:{x:number;z:number})=>Math.min(4,...LANDSCAPE.waterAreas.map(a=>p.x>=a.bounds.minX-4&&p.x<=a.bounds.maxX+4&&p.z>=a.bounds.minZ-4&&p.z<=a.bounds.maxZ+4?polygonDistance(p,a):4));
  for(let i=0;i<positions.length;i+=3)positions[i+1]=groundHeight(positions[i],positions[i+2])+.012;
  const original=ground.getIndices()!;
  for(let i=0;i<original.length;i+=3){
    const ids=[original[i],original[i+1],original[i+2]],v=ids.map(j=>Vector3.FromArray(positions,j*3));
    const p={x:(v[0].x+v[1].x+v[2].x)/3,z:(v[0].z+v[1].z+v[2].z)/3};
    const distance=shoreDistance(p);
    if(!geography.inside(p)||distance< -1.5)continue;
    const normal=Vector3.Cross(v[1].subtract(v[0]),v[2].subtract(v[0])).normalize();
    const exposed=Math.abs(normal.y)<.73&&Math.max(...v.map(p=>p.y))>.35&&geography.roadDistance(p)>1.7;
    (distance<2?bankIndices:exposed?rockIndices:soil).push(...ids);all.push(...ids);
  }
  VertexData.ComputeNormals(positions,all,normals);
  ground.setVerticesData('position',positions);ground.setVerticesData('normal',normals);ground.setIndices(soil);ground.material=grass;
  // Native submeshes let the camera cull terrain strips without changing the
  // shared surface or adding a second terrain representation.
  ground.subdivide(16);
  const low=Color3.FromHexString('#7b8274'),high=Color3.FromHexString('#b7b29b'),colors:number[]=[];
  for(let i=0;i<positions.length;i+=3){
    const x=positions[i],y=positions[i+1],z=positions[i+2];
    const band=.43+.13*Math.sin(y*3.1+Math.sin(x*.22+z*.16)*.45)+.1*Math.sin(x*.24-z*.18);
    const c=Color3.Lerp(low,high,Math.min(1,Math.max(0,band+y*.012)));
    const region=LANDSCAPE.regions.reduce((a,b)=>Math.hypot(a.x-x,a.z-z)<Math.hypot(b.x-x,b.z-z)?a:b);
    const moss=Color3.FromHexString(BIOME_COLORS[region.biome]);
    const blend=Math.min(1,Math.max(0,(Math.abs(normals[i+1])-.6)/.28));
    const tint=Color3.Lerp(c,moss,blend);colors.push(tint.r,tint.g,tint.b,1);
  }
  const rock=new Mesh('landform-exposed-rock',scene),data=new VertexData();
  data.positions=positions;data.normals=normals;data.colors=colors;data.indices=rockIndices;data.applyToMesh(rock);rock.subdivide(12);
  const material=new StandardMaterial('landform-rock',scene);material.diffuseColor=Color3.White();material.specularColor=Color3.Black();rock.material=material;
  // Shore, grass and exposed rock own disjoint triangles of the same native
  // heightfield. A separate interpolated bank skin cut through steep ground.
  const bank=new Mesh('landform-shore',scene),bankData=new VertexData(),lookup=new Map<number,number>();
  const bankPositions:number[]=[],bankNormals:number[]=[],bankColors:number[]=[],bankFaces:number[]=[];
  for(const id of bankIndices){
    let mapped=lookup.get(id);
    if(mapped===undefined){
      mapped=lookup.size;lookup.set(id,mapped);const i=id*3,x=positions[i],z=positions[i+2],d=shoreDistance({x,z});
      bankPositions.push(x,positions[i+1],z);bankNormals.push(normals[i],normals[i+1],normals[i+2]);
      const wet=z<0,outer=Color3.FromHexString(wet?'#82986d':'#94a76b'),sand=Color3.FromHexString(wet?'#94aa8c':'#c4bc96'),inner=Color3.FromHexString('#8fbdb0');
      const tint=d>1?Color3.Lerp(sand,outer,Math.min(1,(d-1)/1.2)):Color3.Lerp(inner,sand,Math.max(0,d));
      const cliff=Math.abs(normals[i+1])<.8?Math.min(1,Math.max(0,positions[i+1]-LANDSCAPE.waterLevel({x,z})-.4)):0;
      const result=Color3.Lerp(tint,Color3.FromArray(colors,id*4),cliff);
      bankColors.push(result.r,result.g,result.b,1);
    }
    bankFaces.push(mapped);
  }
  bankData.positions=bankPositions;bankData.normals=bankNormals;bankData.colors=bankColors;bankData.indices=bankFaces;bankData.applyToMesh(bank);
  const shore=new StandardMaterial('landform-shore',scene);shore.diffuseColor=Color3.White();shore.specularColor=Color3.Black();bank.material=shore;
  const outline=geography.outline.points;
  const side=MeshBuilder.CreateRibbon('landform-outer-bank',{pathArray:[0,1].map(row=>outline.map(p=>new Vector3(p.x,terrainHeight(p.x,p.z)-(row?3:.02),p.z))),closePath:true,sideOrientation:Mesh.DOUBLESIDE},scene);
  const earth=new StandardMaterial('landform-earth',scene);earth.diffuseColor=Color3.FromHexString('#777f56');earth.specularColor=Color3.Black();side.material=earth;
  return ground;
}
