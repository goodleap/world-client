import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { ModelLibrary } from './models.ts';
import type { AssetName, XYZ } from './models.ts';
import { terrain, matte, block, beam, random, riverX } from './terrain.ts';

export const samples={
  oak:{title:'阔叶树 · 造型样板',description:'确认原型：独立球团、错落层次、可见分叉',height:3.3,target:[0,1,0],assets:['oak']},
  trees:{title:'球团树冠 · 三档尺寸',description:'从左到右：小 1 格 · 中 1.5 格 · 大 2 格。每块浅色地面代表 1 格。',height:4.5,target:[0,1.1,0],assets:['oak-small','oak','oak-large']},
  colors:{title:'树木 · 区域配色',description:'嫩绿、叶绿、冷绿、金黄、橙红、粉色；共享球团形体与哑光材质',height:4.8,target:[0,1.2,0],assets:['oak','pine']},
  forest:{title:'01 · 阔叶林与林缘',description:'主树、幼树与灌木形成高低层次，树下由落叶、根系和碎石衔接',height:17.6,target:[0,.6,.1],assets:['oak','sapling','bush','grass','flowers','stone']},
  conifers:{title:'02 · 针叶林与山麓',description:'下垂枝层、冷暖绿对比，搭配苔石和低矮林下植物',height:17.6,target:[0,.8,.1],assets:['pine','bush','grass','stone']},
  orchard:{title:'03 · 花野与果林',description:'低矮果树、花树、成簇野花与暖色土路，保留开阔活动空间',height:17.6,target:[0,.4,.1],assets:['fruit','blossom','bush','grass','flowers','stone']},
  creek:{title:'04 · 溪谷与木桥',description:'弯曲浅溪、沙砾岸、木桥与树石组合，检查水陆自然衔接',height:17.6,target:[0,.5,.1],assets:['oak','sapling','pine','bush','grass','reeds','flowers','stone','cliff']},
  wetland:{title:'05 · 湿地与湖岸',description:'宽浅水面、湿土过渡、芦苇、浮叶与零散岸石',height:17.6,target:[0,.35,.1],assets:['sapling','bush','grass','reeds','flowers','stone']},
  quarry:{title:'06 · 岩谷、矿场与山口',description:'错落岩层、坡脚碎石、稀疏植被与矿洞木支架',height:17.6,target:[0,.8,.1],assets:['pine','bush','grass','stone','cliff']},
  ruins:{title:'07 · 高地古遗迹',description:'风化石拱、断墙、石板与植被侵入，保留可辨认的通路',height:17.6,target:[0,.8,.1],assets:['oak','sapling','bush','grass','flowers','stone']},
  camp:{title:'08 · 边境营地',description:'暖橙布帐、木栅和哨台，与周围林石保持同一材质风格',height:17.6,target:[0,.8,.1],assets:['pine','bush','grass','stone']},
} satisfies Record<string,{title:string;description:string;height:number;target:number[];assets:AssetName[]}>;
export type SampleName=keyof typeof samples;

export async function buildSample(name:SampleName,scene:Scene,shadows:ShadowGenerator){
  const info=samples[name],library=new ModelLibrary(scene,shadows);
  await library.load(info.assets);
  if(name==='oak'){library.place('oak');const cell=MeshBuilder.CreateGround('one-cell-scale',{width:1,height:1},scene);cell.position.y=.006;cell.material=matte(scene,'one-cell-reference','#d9c89f');cell.receiveShadows=true;return info;}
  if(name==='trees'){
    for(const [i,asset] of (['oak-small','oak','oak-large'] as const).entries()){
      const x=(i-1)*2.25;library.place(asset,[x,0,0]);
      const cell=MeshBuilder.CreateGround('one-cell-scale',{width:1,height:1},scene);cell.position.set(x,.006,0);cell.material=matte(scene,`cell-${i}`,'#d9c89f');cell.receiveShadows=true;
    }
    return info;
  }
  if(name==='colors'){
    for(const [i,color] of (['lime','leaf','pine','gold','orange','pink'] as const).entries())library.place(i===2?'pine':'oak',[(i-2.5)*1.9,0,0],1,0,color);
    return info;
  }
  const style=name==='creek'?'river':name==='wetland'?'marsh':name==='quarry'?'rock':name==='orchard'?'meadow':name==='ruins'?'ruins':name==='camp'?'camp':'forest';
  const ground=terrain(scene,style),rng=random(8417);
  const place=(asset:AssetName,x:number,z:number,scale:number|XYZ=1,angle=0,y?:number)=>library.place(asset,[x,y??ground(x,z),z],scale,angle);
  const stone=(x:number,z:number,scale:number|XYZ=1,angle=0,y?:number)=>place('stone',x,z,scale,angle,y);
  const grass=(x:number,z:number,scale=.9)=>place('grass',x,z,scale,rng()*6.28);
  const bush=(x:number,z:number,scale=1)=>place('bush',x,z,scale,rng()*6.28);
  const flowers=(x:number,z:number,scale=1)=>place('flowers',x,z,scale,rng()*6.28);
  const stones=(x:number,z:number,n:number,radius:number)=>{for(let i=0;i<n;i++){const a=rng()*6.28,r=rng()*radius;stone(x+Math.cos(a)*r,z+Math.sin(a)*r,[.15+rng()*.35,.13+rng()*.3,.18+rng()*.4],rng()*6.28);}};
  const grassClump=(x:number,z:number,n=8)=>{for(let i=0;i<n;i++)grass(x+(rng()-.5)*2,z+(rng()-.5)*1.6,.55+rng()*.6);};
  const wood=matte(scene,'cut warm wood','#9a713f'),woodLight=matte(scene,'sunlit planks','#bd9059'),woodDark=matte(scene,'dark structural wood','#755334');
  const rockmat=matte(scene,'weathered limestone','#aaa58b');

  function fence(x:number,z:number,length:number){
    const count=Math.ceil(length/1.2);
    for(let i=0;i<=count;i++){
      const px=x+i*length/count,y=ground(px,z);
      block(scene,shadows,'fence post',[px,y+.56,z],[.17,1.14,.18],wood,.04);
    }
    for(const h of [.37,.79])beam(scene,shadows,'fence rail',[x,ground(x,z)+h,z],[x+length,ground(x+length,z)+h,z],.065,woodLight);
  }
  function cliff(x:number,z:number,span=6,openingX?:number){
    place('cliff',x+span/2,z,[span/5.5,1.05,1.05],Math.PI-.05);
    for(let i=0;i<5;i++){
      const px=x+i*span/4,pz=z+Math.sin(i*1.9)*.4;
      if(openingX===undefined||Math.abs(px+.4-openingX)>1.6)stone(px+.4,pz-.85,[.75,.7,.8],rng()*6.28);
      if(i%2===0){bush(px-.6,pz-1.2,.7);grassClump(px+.2,pz-1.3,4);}
      if(openingX===undefined||Math.abs(px-openingX)>2)stones(px,pz-1.6,5,1);
    }
  }
  function bridge(){
    const z=-1,start=-.6,end=4.5,count=17;
    for(let i=0;i<count;i++){
      const x=start+(i+.5)*(end-start)/count,y=.4+Math.sin((i+.5)/count*Math.PI)*.23;
      const plank=block(scene,shadows,'bridge plank',[x,y,z],[(end-start)/count-.025,.14,2],i%3===0?wood:woodLight,.035);plank.rotation.y=Math.sin(i*2.1)*.015;
    }
    for(const side of [-1,1]){
      for(let i=0;i<4;i++){
        const x=start+i*(end-start)/3,y=.4+Math.sin(i/3*Math.PI)*.23;
        block(scene,shadows,'bridge post',[x,y+.49,z+side*1.02],[.18,1.15,.18],wood,.04);
        if(i<3){const xx=start+(i+1)*(end-start)/3,yy=.4+Math.sin((i+1)/3*Math.PI)*.23;
          beam(scene,shadows,'bridge handrail',[x,y+.85,z+side*1.02],[xx,yy+.85,z+side*1.02],.075,woodLight);
        }
      }
      beam(scene,shadows,'bridge underbeam',[start,.29,z+side*.7],[end,.29,z+side*.7],.12,woodDark);
    }
    stone(-.65,z,[.65,.3,1.1],.25);stone(4.55,z,[.65,.3,1.1],-.15);
  }
  function arch(x:number,z:number,scale=1){
    const y=ground(x,z);
    for(const side of [-1,1])for(let i=0;i<3;i++)block(scene,shadows,'arch pillar',[x+side*1.18*scale,y+(i+.5)*.48*scale,z],[.54*scale,.46*scale,.66*scale],rockmat,.06*scale);
    for(let i=0;i<9;i++){
      const a=(i+.5)*Math.PI/9;
      const b=block(scene,shadows,'arch voussoir',[x+Math.cos(a)*1.18*scale,y+(1.44+Math.sin(a)*1.18)*scale,z],[.43*scale,.54*scale,.67*scale],rockmat,.055*scale);b.rotation.z=a-Math.PI/2;
    }
  }

  if(name==='forest'){
    place('oak',-5,1,1.15,.2);place('oak',1.3,4.5,.95,1.8);place('sapling',5.3,2,1.1,-.2);place('sapling',-1,-1.2,.74,.6);
    for(const [x,z]of[[-7,2],[-4,3.6],[-1.2,4.7],[2.9,4.3],[5.8,3.5],[-6,-1.2]]){bush(x,z,1);grassClump(x,z);}
    for(const [x,z]of[[-6,-.5],[3,4],[6.4,1.8]]){stone(x,z,[.9,.7,.8],rng()*6);stones(x,z,9,1.7);}
    for(const [x,z]of[[-4,-3],[-1,-3],[4,-3.7],[5,-2]]){flowers(x,z,.9);grassClump(x,z);}
  }else if(name==='conifers'){
    for(const [x,z,s,a]of[[-5.7,3.1,1.12,.2],[-2,4.4,.95,1.1],[2.6,3.8,1.05,2],[5.6,2.6,.8,3.1],[-5.4,-.7,.7,.6]])place('pine',x,z,s,a);
    for(const [x,z]of[[-6,2.1],[-.6,3.3],[4.9,2.1],[-3,-1.4],[5,-3.2]]){stone(x,z,[.8,.65,.95],rng()*6);bush(x+.7,z-.6,.7);grassClump(x,z);stones(x,z,8,1.5);}
  }else if(name==='orchard'){
    place('blossom',-5.8,2.8,1.5,.4);place('blossom',-6,-1.3,.78,1.9);
    for(const [x,z,s,a]of[[-1,3.7,1.05,.1],[2.5,3.6,1.18,1.7],[5.8,3.8,1.05,2.9],[5.9,-1.7,1,.8]])place('fruit',x,z,s,a);
    for(let i=0;i<20;i++){const x=-6.5+rng()*5,z=-4.5+rng()*4;flowers(x,z,.8+rng()*.6);if(i%2===0)grassClump(x,z,3);}
    fence(.8,5.4,6.6);fence(3.5,-3.5,3.3);
    for(const [x,z]of[[-4,4.5],[4.1,-3.5],[1.3,2.8]]){bush(x,z,.65);stones(x,z,5,1);}
  }else if(name==='creek'){
    place('oak',-5.4,1.6,1.06,.4);place('pine',-.8,4.7,.85,1.3);place('pine',6.3,4.1,.82,1.8);place('sapling',-.9,1.2,.85,.7);
    bridge();
    for(let i=0;i<14;i++){
      const z=-6.3+i*.95;if(z>-2.3&&z<.4)continue;
      for(const side of [-1,1]){const x=riverX(z)+side*(1.9+rng()*.5);if(rng()>.28)stone(x,z,[.3+rng()*.4,.2+rng()*.4,.35+rng()*.4],rng()*6);if(i%3===0)place('reeds',x+side*.35,z,.65+rng()*.2,rng()*6);}
    }
    for(const [x,z]of[[-6,-1.2],[-5,3.3],[-2,3.4],[6.2,2.1],[5.8,-4]]){bush(x,z,.8);grassClump(x,z);flowers(x+.7,z-.5,.8);}
    cliff(-7.1,4.6,3.1);
  }else if(name==='wetland'){
    place('sapling',-5.6,3.7,1.2,.7);place('sapling',6,4.7,1.05,1.2);
    for(let i=0;i<17;i++){
      const z=-6.2+rng()*12.4,side=i%2?1:-1,x=riverX(z)+side*(2.9+rng()*.7);
      if(Math.abs(x)>8)continue;
      place('reeds',x,z,.65+rng()*.48,rng()*6);grass(x+side*.3,z-.3);if(i%3===0)stone(x,z,[.5,.4,.7],rng()*6);
    }
    const pad=matte(scene,'lily leaves','#659d61');
    for(let i=0;i<15;i++){
      const z=-5.9+rng()*11.8,x=riverX(z)+(rng()-.5)*3.9;
      const leaf=MeshBuilder.CreateDisc('floating lily leaf',{radius:.15+rng()*.14,tessellation:22,arc:.9,sideOrientation:Mesh.DOUBLESIDE},scene);leaf.rotation.x=Math.PI/2;leaf.rotation.z=rng()*6;leaf.position.set(x,.047,z);leaf.material=pad;
    }
    for(const [x,z]of[[-6,-3],[-5,1],[-3.5,4]]){bush(x,z,.85);flowers(x+.5,z,.9);grassClump(x,z);}
  }else if(name==='quarry'){
    cliff(-7,3.9,5.3,-4.4);cliff(3.7,3.8,3.3);
    place('pine',-6.2,5.4,.62,1.1);place('pine',6.7,5.2,.67,.3);
    const x=-4.4,z=2.15,y=ground(x,z),dark=matte(scene,'mine recess','#3a4031');
    block(scene,shadows,'mine shadow',[x,y+1.05,z+.1],[1.75,2.1,.2],dark,.04);
    for(const side of [-1,1])block(scene,shadows,'mine upright',[x+side*.98,y+1.05,z-.1],[.3,2.3,.32],wood,.05);
    block(scene,shadows,'mine lintel',[x,y+2.13,z-.1],[2.65,.37,.42],woodLight,.06);
    for(let i=0;i<7;i++)block(scene,shadows,'mine rail sleeper',[x,y+.06,z-1-i*.4],[1.32,.12,.17],woodDark,.025);
    for(const side of [-1,1])beam(scene,shadows,'mine rail',[x+side*.41,y+.14,z-.7],[x+side*.41,y+.14,z-3.7],.035,rockmat);
    for(const [px,pz]of[[-7,-.7],[5.6,1.3],[6,-3.3],[2.8,4.9]]){stones(px,pz,13,1.6);grassClump(px,pz,5);}
  }else if(name==='ruins'){
    arch(-.7,2.4,1.25);arch(4.5,3.5,.82);
    place('oak',-6.5,3.8,.9,.3);place('sapling',6.7,4.4,.85,1.3);
    for(let i=0;i<6;i++){
      const x=2+i*.69,z=5.1;for(let j=0;j<(i%3===0?1:2);j++)block(scene,shadows,'broken wall',[x,ground(x,z)+.27+j*.45,z],[.66,.43,.55],rockmat,.06);
    }
    for(let i=0;i<13;i++){
      const x=-1.1+(i%3-1)*.7+Math.sin(i)*.1,z=.9-Math.floor(i/3)*.7;
      const p=block(scene,shadows,'worn paving',[x,ground(x,z)+.025,z],[.62,.1,.57],rockmat,.045);p.rotation.y=Math.sin(i)*.12;
    }
    for(const [x,z]of[[-2.3,2.6],[1,2.8],[5.4,3.7],[-4.2,3.8],[4.3,-2.6]]){bush(x,z,.8);grassClump(x,z);flowers(x-.4,z-.5,.85);stones(x,z,7,1.2);}
    for(const [x,z]of[[2.3,3.4],[3,2.2],[2.8,-2]]){const m=block(scene,shadows,'fallen arch stone',[x,ground(x,z)+.2,z],[.62,.4,.8],rockmat,.07);m.rotation.y=rng()*4;}
  }else if(name==='camp'){
    const canvas=matte(scene,'orange canvas','#c87844'),canvasLight=matte(scene,'warm canvas edge','#d69b57');
    const tx=-2.2,tz=2.2,y=ground(tx,tz);
    const paths=[[],[],[],[],[]] as Vector3[][];
    for(let i=0;i<=12;i++){
      const z=tz-1.65+i*3.3/12,bow=Math.sin(i/12*Math.PI)*.12;
      paths[0].push(new Vector3(tx-1.8,y+.12,z));paths[1].push(new Vector3(tx-.87,y+1.45-bow,z));paths[2].push(new Vector3(tx,y+2.6-bow,z));paths[3].push(new Vector3(tx+.87,y+1.45-bow,z));paths[4].push(new Vector3(tx+1.8,y+.12,z));
    }
    const tent=MeshBuilder.CreateRibbon('tent canvas',{pathArray:paths,sideOrientation:Mesh.DOUBLESIDE},scene);tent.material=canvas;tent.receiveShadows=true;shadows.addShadowCaster(tent);
    const front=MeshBuilder.CreateRibbon('open tent front',{pathArray:[[new Vector3(tx-1.8,y+.12,tz-1.65),new Vector3(tx-.4,y+.12,tz-1.65)],[new Vector3(tx,y+2.58,tz-1.65),new Vector3(tx-.06,y+2.1,tz-1.65)]],sideOrientation:Mesh.DOUBLESIDE},scene);front.material=canvasLight;shadows.addShadowCaster(front);
    const front2=front.clone('second entrance flap');front2.scaling.x=-1;front2.position.x=tx*2;
    for(const z of [tz-1.7,tz+1.7])beam(scene,shadows,'tent pole',[tx,y,z],[tx,y+2.8,z],.07,wood);
    for(const side of [-1,1])for(const sz of [-1,1]){
      const px=tx+side*2.3,pz=tz+sz*2;beam(scene,shadows,'guy rope',[tx+side*1.7,y+.3,tz+sz*1.55],[px,y+.12,pz],.016,woodLight);
      beam(scene,shadows,'tent peg',[px,y,pz],[px,y+.24,pz],.045,woodDark);
    }
    for(let i=0;i<40;i++){
      const x=-7.1+i*.35,z=5.2+Math.sin(i*.7)*.08,h=1.4+(i%3)*.1;
      beam(scene,shadows,'palisade',[x,ground(x,z),z],[x,ground(x,z)+h,z],.14,wood);
      const tip=MeshBuilder.CreateCylinder('palisade point',{height:.25,diameterBottom:.28,diameterTop:.025,tessellation:8},scene);tip.position.set(x,ground(x,z)+h+.125,z);tip.material=woodLight;shadows.addShadowCaster(tip);
    }
    fence(-7.2,4,2.1);fence(5,3.8,2.2);
    const x=4.4,z=2.5;
    for(const dx of [-.85,.85])for(const dz of [-.8,.8])beam(scene,shadows,'lookout support',[x+dx,ground(x,z),z+dz],[x+dx,3.35,z+dz],.13,woodDark);
    block(scene,shadows,'lookout deck',[x,3.15,z],[2.25,.18,2.1],woodLight,.04);
    for(const dx of [-1,1]){
      beam(scene,shadows,'lookout diagonal',[x+dx*.85,.3,z-.8],[x-dx*.85,2.95,z-.8],.08,wood);
      beam(scene,shadows,'lookout rail',[x+dx,3.9,z-1],[x+dx,3.9,z+1],.065,woodLight);
    }
    for(const dx of [-1,1])for(const dz of [-1,1])beam(scene,shadows,'lookout roof post',[x+dx,3.15,z+dz],[x+dx,4.6,z+dz],.065,wood);
    beam(scene,shadows,'lookout rear rail',[x-1,3.9,z+1],[x+1,3.9,z+1],.065,woodLight);
    const roofPaths=[[],[]] as Vector3[][];
    for(const [dx,dz]of[[-1.35,-1.3],[1.35,-1.3],[1.35,1.3],[-1.35,1.3],[-1.35,-1.3]]){
      roofPaths[0].push(new Vector3(x+dx,4.55,z+dz));roofPaths[1].push(new Vector3(x,5.35,z));
    }
    const roof=MeshBuilder.CreateRibbon('lookout canvas roof',{pathArray:roofPaths,sideOrientation:Mesh.DOUBLESIDE},scene);roof.material=canvas;roof.receiveShadows=true;shadows.addShadowCaster(roof);
    for(let i=0;i<6;i++)beam(scene,shadows,'ladder rung',[x-.4,.4+i*.44,z-1.6],[x+.4,.4+i*.44,z-1.6],.05,woodLight);
    for(const dx of [-.45,.45])beam(scene,shadows,'ladder upright',[x+dx,.2,z-1.6],[x+dx,3.2,z-1.6],.055,wood);
    place('pine',-7.2,4.5,.8,.4);place('pine',7.1,4.9,.85,1.2);
    for(const [px,pz]of[[-6,-1],[6,-2],[.7,4.1]]){bush(px,pz,.7);grassClump(px,pz);stones(px,pz,5,1.1);}
  }
  return info;
}
