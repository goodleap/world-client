import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Palette } from './models.ts';
import { roundedBox as rounded } from './environment-shapes.ts';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TOWER_SHAPE } from './tower-shape.ts';

// Tiny timber bevels need only one curved edge segment at game distance.
const roundedBox=(scene:Scene,name:string,size:[number,number,number],at:[number,number,number],material:StandardMaterial,radius:number)=>rounded(scene,name,size,at,material,radius,1);

/** Compact, roofless timber watchtower. Sloping supports give it a trapezoidal
 * silhouette. Batched by material; additional towers use native instances. */
export function createTowerModel(scene:Scene,p:Palette){
  const {baseHalf:base,topHalf:top,deck,deckWidth:width}=TOWER_SHAPE;
  type V=[number,number,number];
  const beam=(name:string,a:V,b:V,size:number,material:StandardMaterial)=>{
    const from=Vector3.FromArray(a),to=Vector3.FromArray(b),direction=to.subtract(from);
    const mesh=roundedBox(scene,name,[size,direction.length(),size],from.add(to).scale(.5).asArray() as V,material,size*.2);
    mesh.rotationQuaternion=Quaternion.FromUnitVectorsToRef(Vector3.Up(),direction.normalize(),new Quaternion());
  };
  for(const x of [-1,1])for(const z of [-1,1]){
    roundedBox(scene,'tower-stone-foot',[.48,.32,.48],[x*base,.16,z*base],p.stoneLight,.08);
    beam('tower-support',[x*base,.26,z*base],[x*top,deck-.1,z*top],.23,p.timber);
    beam('tower-rail-post',[x*.9,deck,z*.9],[x*.9,deck+.55,z*.9],.13,p.timber);
  }
  for(const side of [-1,1])for(const diagonal of [-1,1]){
    beam('tower-side-brace',[side*.98,.55,diagonal*.93],[side*.8,deck-.3,-diagonal*.8],.13,p.timberLight);
  }
  for(const diagonal of [-1,1])beam('tower-back-brace',[diagonal*.93,.55,.98],[-diagonal*.8,deck-.3,.8],.13,p.timberLight);
  const boards=6;
  for(let i=0;i<boards;i++)roundedBox(scene,'tower-deck-board',[width,.16,width/boards-.018],[0,deck-.08,(i-(boards-1)/2)*width/boards],p.timberLight,.035);
  for(const side of [-1,1]){
    roundedBox(scene,'tower-side-rail',[.14,.16,width],[side*.9,deck+.55,0],p.timberLight,.035);
    roundedBox(scene,'tower-side-baluster',[.1,.5,.1],[side*.9,deck+.25,0],p.timber,.025);
    roundedBox(scene,'tower-front-rail',[.46,.16,.14],[side*.73,deck+.55,-.9],p.timberLight,.035);
  }
  roundedBox(scene,'tower-back-rail',[width,.16,.14],[0,deck+.55,.9],p.timberLight,.035);
  roundedBox(scene,'tower-back-baluster',[.1,.5,.1],[0,deck+.25,.9],p.timber,.025);
  // Ladder remains within the smaller reserved footprint, with an open entrance.
  for(const x of [-.36,.36])beam('tower-ladder-side',[x,.1,-1.2],[x,deck+.08,-.9],.11,p.timberLight);
  for(let i=0;i<7;i++){
    const y=.25+i*.3,z=-1.2+(y-.1)/(deck-.02)*.3;
    roundedBox(scene,'tower-ladder-rung',[.8,.11,.13],[0,y,z],p.timber,.025);
  }
}
