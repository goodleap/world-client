import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';

type Position={x:number;y:number;z:number};
/** Two pooled native meshes. Sample AnimationGroup with the simulation's visual
 * clock so the ring, sparkles and text also agree on slow or paused frames. */
export function createLevelFeedback(scene:Scene,host:HTMLElement){
  const slots:ReturnType<typeof create>[]=[];
  let shown=0;
  function create(){
    const name=`level-up-${slots.length}`,root=new TransformNode(name,scene);
    const material=new StandardMaterial(name+'-gold',scene);
    material.disableLighting=true;material.emissiveColor=Color3.FromHexString('#ffe28b');material.backFaceCulling=false;
    const ring=MeshBuilder.CreateTorus(name+'-ring',{diameter:1,thickness:.055,tessellation:32},scene);
    ring.parent=root;ring.material=material;ring.isPickable=false;
    const pieces=Array.from({length:7},(_,i)=>{
      const mesh=MeshBuilder.CreateDisc(name+'-spark',{radius:i%2?.065:.09,tessellation:4},scene);
      mesh.position.set(Math.sin(i*2.4)*.65,.25+(i%3)*.3,0);mesh.rotation.z=Math.PI/4;
      return mesh;
    });
    const sparks=Mesh.MergeMeshes(pieces,true)!;sparks.parent=root;sparks.material=material;
    sparks.billboardMode=Mesh.BILLBOARDMODE_ALL;sparks.isPickable=false;
    const group=new AnimationGroup(name,scene);
    const scale=new Animation('expand','scaling',60,Animation.ANIMATIONTYPE_VECTOR3,Animation.ANIMATIONLOOPMODE_CONSTANT);
    scale.setKeys([{frame:0,value:Vector3.One().scale(.6)},{frame:60,value:Vector3.One().scale(2.3)}]);
    const rise=new Animation('rise','position.y',60,Animation.ANIMATIONTYPE_FLOAT,Animation.ANIMATIONLOOPMODE_CONSTANT);
    rise.setKeys([{frame:0,value:.2},{frame:60,value:2.2}]);
    const fade=new Animation('fade','alpha',60,Animation.ANIMATIONTYPE_FLOAT,Animation.ANIMATIONLOOPMODE_CONSTANT);
    fade.setKeys([{frame:0,value:0},{frame:5,value:1},{frame:32,value:1},{frame:60,value:0}]);
    group.addTargetedAnimation(scale,ring);group.addTargetedAnimation(rise,sparks);group.addTargetedAnimation(fade,material);
    const label=document.createElement('span');label.className='level-number';label.hidden=true;host.append(label);
    root.setEnabled(false);
    return {root,ring,sparks,material,group,label,id:'',start:0,active:false,frame:-1};
  }
  return {
    show(id:string,level:number,time:number,point:Position){
      let slot=slots.find(s=>!s.active);
      if(!slot&&slots.length<8){slot=create();slots.push(slot);}
      slot??=slots.reduce((a,b)=>a.start<b.start?a:b);
      slot.group.stop();slot.id=id;slot.start=time;slot.active=true;shown++;
      slot.frame=-1;slot.root.position.set(point.x,point.y+.06,point.z);slot.root.setEnabled(true);
      slot.ring.scaling.setAll(.6);slot.sparks.position.y=.2;slot.material.alpha=0;
      slot.label.textContent=`Lv. ${level}`;slot.label.hidden=false;
      slot.group.start(false,1,0,60);slot.group.pause();
    },
    update(time:number,position:(id:string)=>Position|undefined,project:(point:Position)=>{x:number;y:number;visible:boolean}){
      const labels:{x:number;y:number}[]=[];
      for(const s of slots){
        if(!s.active)continue;
        const elapsed=Math.max(0,time-s.start),point=position(s.id);
        if(elapsed>=1||!point){s.group.stop();s.root.setEnabled(false);s.label.hidden=true;s.active=false;continue;}
        const frame=elapsed*60;if(frame!==s.frame){s.group.goToFrame(frame);s.frame=frame;}
        s.root.position.set(point.x,point.y+.06,point.z);
        const p=project({...point,y:point.y+3});s.label.hidden=!p.visible;
        let y=p.y-40-elapsed*22;
        for(const other of labels.filter(o=>Math.abs(o.x-p.x)<100).sort((a,b)=>b.y-a.y))if(Math.abs(y-other.y)<23)y=other.y-23;
        if(p.visible)labels.push({x:p.x,y});
        s.label.style.transform=`translate(${p.x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
        s.label.style.opacity=String(Math.min(1,(1-elapsed)/.3));
      }
    },
    snapshot:()=>({shown,active:slots.filter(s=>s.active).length,allocated:slots.length}),
    dispose(){for(const s of slots){s.group.dispose();s.root.dispose();s.material.dispose();s.label.remove();}slots.length=0;},
  };
}
