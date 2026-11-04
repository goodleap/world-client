import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { roundedBox } from './environment-shapes.ts';
import { LANDSCAPE, MAP_LANDMARKS } from './world-data.ts';
import { surfaceHeight, terrainHeight } from './terrain-height.ts';
import { polygonDistance } from './polygon.ts';
import { seededRandom } from './landscape-layout.ts';

export function createLandscapeProps(scene:Scene) {
  const matte=(name:string,hex:string)=>{const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(hex);m.specularColor=Color3.Black();return m;};
  const wood=matte('map-warm-wood','#9a713f'),light=matte('map-planks','#bd9059'),dark=matte('map-wood-shadow','#755334');
  const stone=matte('map-limestone','#aaa58b'),canvas=matte('map-orange-canvas','#c87844'),recess=matte('map-mine-recess','#3a4031');
  const lily=matte('map-lily-leaves','#659d61'),canvasEdge=matte('map-canvas-edge','#d69b57'),random=seededRandom(781);
  for(const area of LANDSCAPE.waterAreas.filter(a=>a.z<0))for(let i=0;i<22;i++){
    const x=area.x+(random()-.5)*12,z=area.z+(random()-.5)*12;
    if(polygonDistance({x,z},area)>-1)continue;
    const leaf=MeshBuilder.CreateDisc('lily-leaf',{radius:.18+random()*.17,tessellation:18,arc:.9,sideOrientation:Mesh.DOUBLESIDE},scene);
    leaf.rotation.set(Math.PI/2,0,random()*6.28);leaf.position.set(x,terrainHeight(x,z)+.065,z);leaf.material=lily;
  }
  const box=(name:string,x:number,y:number,z:number,w:number,h:number,d:number,mat:StandardMaterial)=>roundedBox(scene,name,[w,h,d],[x,y,z],mat,Math.min(.06,h/3));
  const beam=(name:string,a:Vector3,b:Vector3,r:number,mat:StandardMaterial)=>{const m=MeshBuilder.CreateTube(name,{path:[a,b],radius:r,tessellation:8,cap:Mesh.CAP_ALL},scene);m.material=mat;return m;};
  for(const b of LANDSCAPE.bridges){
    const c=Math.cos(b.angle),s=Math.sin(b.angle);
    const at=(x:number,z:number,h:number)=>{const px=b.x+x*c+z*s,pz=b.z-x*s+z*c;return new Vector3(px,surfaceHeight(px,pz)+h,pz);};
    const count=Math.ceil(b.length/.32);
    for(let i=0;i<count;i++){
      const p=at((i+.5)/count*b.length-b.length/2,0,-.045);
      const m=box('bridge-plank',p.x,p.y,p.z,b.length/count-.018,.1,b.width, i%3?light:wood);m.rotation.y=b.angle;
    }
    for(const side of [-1,1])for(let i=0;i<4;i++){
      const x=(i/3-.5)*b.length,p=at(x,side*(b.width/2+.08),.48);
      box('bridge-post',p.x,p.y,p.z,.18,1.12,.18,wood);
      if(i<3)beam('bridge-handrail',at(x,side*(b.width/2+.08),.89),at(((i+1)/3-.5)*b.length,side*(b.width/2+.08),.89),.075,light);
    }
  }
  for(const p of MAP_LANDMARKS.props){
    const {x,z}=p,y=terrainHeight(x,z);
    if(p.kind==='arch'){
      for(const side of [-1,1])for(let i=0;i<3;i++)box('ruin-pillar',x+side*1.45,y+(i+.5)*.58,z,.68,.55,.86,stone);
      for(let i=0;i<11;i++){const a=(i+.5)*Math.PI/11,m=box('ruin-arch',x+Math.cos(a)*1.45,y+1.74+Math.sin(a)*1.45,z,.46,.65,.86,stone);m.rotation.z=a-Math.PI/2;}
      for(let i=0;i<15;i++){const px=x+(i%3-1)*.8,pz=z-1-Math.floor(i/3)*.9;box('ruin-paver',px,terrainHeight(px,pz)+.02,pz,.7,.06,.7,stone).rotation.y=Math.sin(i)*.12;}
    }else if(p.kind==='wall'){
      for(let i=0;i<6;i++)for(let row=0;row<(i%3?2:1);row++)box('broken-wall',x+(i-2.5)*.7,y+.28+row*.48,z,.68,.45,.72,stone);
    }else if(p.kind==='mine'){
      box('mine-shadow',x,y+1.05,z+.35,2.2,2.1,.3,recess);
      for(const side of [-1,1])box('mine-upright',x+side*1.15,y+1.1,z-.1,.3,2.3,.4,wood);
      box('mine-lintel',x,y+2.18,z-.1,2.95,.37,.5,light);
      for(let i=0;i<7;i++)box('mine-sleeper',x,y+.05,z-.8-i*.42,1.4,.1,.16,dark);
      for(const side of [-1,1])beam('mine-rail',new Vector3(x+side*.45,y+.12,z-.7),new Vector3(x+side*.45,y+.12,z-3.5),.035,stone);
    }else if(p.kind==='tent'){
      const paths=Array.from({length:5},()=>[] as Vector3[]);
      for(let i=0;i<=12;i++)for(let j=0;j<5;j++)paths[j].push(new Vector3(x+(j-2)*.9,y+[.12,1.45,2.6,1.45,.12][j]-Math.sin(i*Math.PI/12)*.1,z-1.65+i*3.3/12));
      const m=MeshBuilder.CreateRibbon('canvas-tent',{pathArray:paths,sideOrientation:Mesh.DOUBLESIDE},scene);m.material=canvas;
      for(const side of [-1,1]){
        const flap=MeshBuilder.CreateRibbon('tent-entrance',{pathArray:[
          [new Vector3(x+side*1.8,y+.12,z-1.66),new Vector3(x+side*.4,y+.12,z-1.66)],
          [new Vector3(x,y+2.58,z-1.66),new Vector3(x+side*.06,y+2.1,z-1.66)],
        ],sideOrientation:Mesh.DOUBLESIDE},scene);flap.material=canvasEdge;
      }
      for(const side of [-1,1])beam('tent-pole',new Vector3(x,y,z+side*1.7),new Vector3(x,y+2.8,z+side*1.7),.07,wood);
      for(const side of [-1,1])box('tent-supplies',x+side*.9,y+.23,z,.55,.46,.8,dark);
    }else if(p.kind==='lookout'){
      for(const dx of [-.85,.85])for(const dz of [-.8,.8])beam('lookout-post',new Vector3(x+dx,y,z+dz),new Vector3(x+dx,y+4.55,z+dz),.11,dark);
      box('lookout-deck',x,y+2.9,z,2.25,.18,2.1,light);
      for(const side of [-1,1])beam('lookout-rail',new Vector3(x+side,y+3.65,z-1),new Vector3(x+side,y+3.65,z+1),.075,light);
      const edge=[[-1.35,-1.3],[1.35,-1.3],[1.35,1.3],[-1.35,1.3],[-1.35,-1.3]];
      const roof=MeshBuilder.CreateRibbon('lookout-canvas',{pathArray:[edge.map(([dx,dz])=>new Vector3(x+dx,y+4.45,z+dz)),edge.map(()=>new Vector3(x,y+5.2,z))],sideOrientation:Mesh.DOUBLESIDE},scene);roof.material=canvas;
      for(let i=0;i<6;i++)beam('ladder',new Vector3(x-.35,y+.35+i*.42,z-1.1),new Vector3(x+.35,y+.35+i*.42,z-1.1),.05,light);
    }else{
      for(let i=0;i<24;i++){
        const px=x-3.8+i*.33,py=terrainHeight(px,z),h=1.3+i%3*.09;
        beam('palisade',new Vector3(px,py,z),new Vector3(px,py+h,z),.14,wood);
        const tip=MeshBuilder.CreateCylinder('palisade-tip',{height:.24,diameterBottom:.28,diameterTop:.03,tessellation:8},scene);tip.position.set(px,py+h+.12,z);tip.material=light;
      }
    }
  }
}
