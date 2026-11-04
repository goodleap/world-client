import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import type { XYZ } from './models.ts';

export function random(seed:number){return()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};}
export function matte(scene:Scene,name:string,hex:string){const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(hex);m.specularColor=Color3.Black();return m;}

/** Height, shoreline and ground color come from one surface description. The
 * sample uses a native ground mesh and a baked diffuse canvas, no live shader. */
export type GroundStyle='forest'|'meadow'|'river'|'marsh'|'rock'|'ruins'|'camp';
export const riverX=(z:number)=>2.1+Math.sin(z*.38)*1.2;
export function groundHeight(x:number,z:number,style:GroundStyle){
  let height=.2+Math.sin(x*.35+z*.2)*.09+Math.sin(z*.7)*.04;
  if(style==='ruins')height+=Math.max(0,Math.min(1,(z+.4)/2.2))*1.3;
  if(style==='river'||style==='marsh'){
    const d=Math.abs(x-riverX(z)),width=style==='marsh'?2.6:1.4;
    height-=.65*Math.max(0,Math.min(1,(width+.6-d)/.9));
  }
  return height;
}
export function terrain(scene:Scene,style:GroundStyle){
  const width=18,depth=14,size=1024;
  const surface=MeshBuilder.CreateGround(`ground:${style}`,{width,height:depth,subdivisions:96},scene);
  const positions=surface.getVerticesData(VertexBuffer.PositionKind)!;
  for(let i=0;i<positions.length;i+=3)positions[i+1]=groundHeight(positions[i],positions[i+2],style);
  surface.updateVerticesData(VertexBuffer.PositionKind,positions);
  const normals:number[]=[];VertexData.ComputeNormals(positions,surface.getIndices()!,normals);surface.updateVerticesData(VertexBuffer.NormalKind,normals);
  const tex=new DynamicTexture(`painted-ground:${style}`,{width:size,height:size},scene,false);
  const ctx=tex.getContext() as CanvasRenderingContext2D,rng=random(5632);
  const grass=style==='rock'?'#a29a62':style==='marsh'?'#78914e':'#82a448';
  ctx.fillStyle=grass;ctx.fillRect(0,0,size,size);
  // Soft patches break up the base color without a noisy repeated tiled image.
  for(let i=0;i<100;i++){
    const x=rng()*size,y=rng()*size,r=30+rng()*110;
    const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,i%3===0?'#b9b55a55':'#52773844');g.addColorStop(1,'#77964500');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,2*r,2*r);
  }
  const px=(x:number)=>(x/width+.5)*size,pz=(z:number)=>(.5-z/depth)*size;
  const path=(lineWidth:number,stroke:string)=>{
    ctx.beginPath();ctx.moveTo(px(-10),pz(-3.8));ctx.bezierCurveTo(px(-5),pz(-4.2),px(-4),pz(-.4),px(.2),pz(-1));ctx.bezierCurveTo(px(4),pz(-1.5),px(5),pz(1.5),px(9),pz(2.5));
    ctx.lineWidth=lineWidth;ctx.strokeStyle=stroke;ctx.lineCap='round';ctx.stroke();
  };
  if(style!=='marsh'){
    path(138,'#a1a057');path(123,'#bfab68');path(109,'#ccb078');path(94,'#d6b580');
  }
  if(style==='forest'){
    for(const [x,z]of[[-5,2],[-1,3.3],[4,4]]){
      const g=ctx.createRadialGradient(px(x),pz(z),5,px(x),pz(z),180);g.addColorStop(0,'#736b3caa');g.addColorStop(.55,'#7d7d3d55');g.addColorStop(1,'#7d7d3d00');ctx.fillStyle=g;ctx.fillRect(px(x)-180,pz(z)-180,360,360);
    }
  }
  if(style==='river'||style==='marsh'){
    for(const [extra,shade]of [[1.1,'#a9a16b'],[.8,'#c4b888'],[.55,'#b6a978'],[.2,'#76867b']] as const){
      ctx.beginPath();for(let i=0;i<=64;i++){const z=-7+i*14/64,x=riverX(z);if(!i)ctx.moveTo(px(x),pz(z));else ctx.lineTo(px(x),pz(z));}ctx.strokeStyle=shade;ctx.lineWidth=((style==='marsh'?2.6:1.4)+extra)*2/width*size;ctx.stroke();
    }
  }
  const pixels=ctx.getImageData(0,0,size,size);
  // Sparse grouped strokes are baked once. Stones and plants carry the relief.
  for(let i=0;i<13500;i++){
    const x=rng()*size,y=rng()*size,index=(Math.floor(y)*size+Math.floor(x))*4;
    const isGrass=pixels.data[index+1]>pixels.data[index]*1.04;
    ctx.globalAlpha=.15+rng()*.2;ctx.strokeStyle=isGrass?(i%3===0?'#dae289':'#54782f'):(i%2?'#f2d6a0':'#ad8e60');
    ctx.lineWidth=isGrass?1.1:1.8;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(rng()-.5)*4,y-2-rng()*4);ctx.stroke();
  }
  ctx.globalAlpha=1;tex.update(true);
  const material=matte(scene,`ground:${style}`,'#ffffff');material.diffuseTexture=tex;
  surface.material=material;surface.receiveShadows=true;
  // A shallow earth edge identifies this as an isolated model sample.
  const edge=MeshBuilder.CreateBox('sample earth underside',{width:18,height:.26,depth:14},scene);edge.position.y=-.15;edge.material=matte(scene,'earth edge','#756545');edge.receiveShadows=true;
  if(style==='river'||style==='marsh'){
    const paths=Array.from({length:9},()=>[] as Vector3[]);const half=style==='marsh'?2.84:1.65;
    for(let i=0;i<=96;i++){const z=-7+i*14/96;for(let j=0;j<paths.length;j++)paths[j].push(new Vector3(riverX(z)+(j/8*2-1)*half,.035,z));}
    const water=MeshBuilder.CreateRibbon('quiet shallow water',{pathArray:paths,sideOrientation:Mesh.DOUBLESIDE},scene);
    const wmat=matte(scene,'turquoise water',style==='marsh'?'#5b9891':'#409d9e');water.material=wmat;water.receiveShadows=true;
    const colors:number[]=[],points=water.getVerticesData(VertexBuffer.PositionKind)!;
    for(let i=0;i<points.length;i+=3){const edge=Math.abs(points[i]-riverX(points[i+2]))/half,t=.88+.08*Math.sin(points[i+2]*.6);colors.push(t+edge*.2,t+edge*.13,1-edge*.06,1);}water.setVerticesData(VertexBuffer.ColorKind,colors);
    const foam=matte(scene,'small water ribbons','#a8d1bd');
    for(let i=0;i<36;i++){
      const z=-6.7+rng()*13.4,x=riverX(z)+(rng()-.5)*half*1.5;
      const length=.3+rng()*.75;
      const path=Array.from({length:9},(_,j)=>new Vector3(x+(j/8-.5)*length,.043,z+Math.sin(j/8*Math.PI)*.05));
      const line=MeshBuilder.CreateTube('soft water ripple',{path,radius:.007,tessellation:5},scene);line.material=foam;
    }
  }
  return (x:number,z:number)=>groundHeight(x,z,style);
}

export function beam(scene:Scene,shadows:ShadowGenerator,name:string,from:XYZ,to:XYZ,radius:number,material:StandardMaterial){
  const p=Vector3.FromArray(from),q=Vector3.FromArray(to);
  const m=MeshBuilder.CreateTube(name,{path:[p,q],radius,tessellation:10,cap:Mesh.CAP_ALL},scene);m.material=material;m.receiveShadows=true;shadows.addShadowCaster(m);return m;
}

export function block(scene:Scene,shadows:ShadowGenerator,name:string,at:XYZ,size:XYZ,material:StandardMaterial,r=.07){
  // Analytic rounded edges, using native vertex buffers and material lighting.
  const half=size.map(v=>v/2),verts:number[]=[],normals:number[]=[],indices:number[]=[];
  r=Math.min(r,...half);
  for(let axis=0;axis<3;axis++){
    const u=(axis+1)%3,v=(axis+2)%3;
    const samples=(h:number)=>[-h,-h+r*.3,-h+r,h-r,h-r*.3,h];
    const us=samples(half[u]),vs=samples(half[v]);
    for(const sign of [-1,1]){
      const first=verts.length/3;
      for(const y of vs)for(const x of us){
        const p=[0,0,0];p[axis]=sign*half[axis];p[u]=x;p[v]=y;
        const inner=p.map((n,i)=>Math.max(-half[i]+r,Math.min(half[i]-r,n)));
        const n=new Vector3(p[0]-inner[0],p[1]-inner[1],p[2]-inner[2]).normalize();
        verts.push(inner[0]+n.x*r,inner[1]+n.y*r,inner[2]+n.z*r);normals.push(n.x,n.y,n.z);
      }
      for(let y=0;y<vs.length-1;y++)for(let x=0;x<us.length-1;x++){
        const a=first+y*us.length+x,b=a+1,c=a+us.length,d=c+1;indices.push(...(sign>0?[a,c,b,b,c,d]:[a,b,c,b,d,c]));
      }
    }
  }
  const data=new VertexData();data.positions=verts;data.normals=normals;data.indices=indices;
  const mesh=new Mesh(name,scene);data.applyToMesh(mesh);mesh.position.set(...at);mesh.material=material;mesh.receiveShadows=true;shadows.addShadowCaster(mesh);return mesh;
}
