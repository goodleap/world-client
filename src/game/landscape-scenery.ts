import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import type { EnvironmentLibrary, EnvironmentAsset } from './environment-library.ts';
import { LANDSCAPE } from './world-data.ts';
import { groundHeight, terrainHeight } from './terrain-height.ts';
import { seededRandom } from './landscape-layout.ts';
import { polygonDistance, insidePolygon } from './polygon.ts';

/** Immutable scenery lives inside the authored woodland/water solids. Small
 * ground cover is passable; full-size rocks and trunks never straddle a road. */
export function createLandscapeScenery(_scene:Scene,shadows:ShadowGenerator,library:EnvironmentLibrary) {
  const random=seededRandom(9037);let sequence=0;
  const place=(asset:EnvironmentAsset,x:number,z:number,scale:number|[number,number,number],angle:number,y=groundHeight(x,z))=>{
    const mesh=library.source(asset).createInstance(`map-scenery-${asset}-${sequence++}`);
    mesh.position.set(x,y,z);if(typeof scale==='number')mesh.scaling.setAll(scale);else mesh.scaling.set(...scale);mesh.rotation.y=angle;
    mesh.isPickable=false;mesh.receiveShadows=true;mesh.freezeWorldMatrix();
    if(asset!=='grass'&&asset!=='flowers'&&asset!=='reeds')shadows.addShadowCaster(mesh,false);
    return mesh;
  };
  for(const tree of LANDSCAPE.sceneryTrees)place(tree.species,tree.x,tree.z,tree.scale,tree.rotation);
  // The approved layered cliff model is set into the real terrace faces.
  // It follows the whole rim, with explicit breaks at the road approaches.
  for(const form of LANDSCAPE.geography.forms.filter(f=>f.kind!=='basin')){
    const line=form.area.points;
    let carried=0;
    for(let i=0;i<line.length;i++){
      const a=line[i],b=line[(i+1)%line.length],length=Math.hypot(b.x-a.x,b.z-a.z);
      let nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
      if(insidePolygon({x:a.x+nx*.3,z:a.z+nz*.3},form.area)){nx=-nx;nz=-nz;}
      for(let d=carried;d<length;d+=4.7){
        const x=a.x+(b.x-a.x)*d/length,z=a.z+(b.z-a.z)*d/length,p={x,z};
        if(LANDSCAPE.geography.roadDistance(p)<5.3||LANDSCAPE.waterAreas.some(a=>polygonDistance(p,a)<1.6))continue;
        const reach=Math.max(2,form.edge*.85),base=terrainHeight(x+nx*reach,z+nz*reach),top=terrainHeight(x-nx*reach,z-nz*reach);
        if(top-base<1.4)continue;
        place('cliff',x,z,[.93+random()*.13,(top-base+.22)/3.7,.65+random()*.12],Math.atan2(nx,nz),base-.12);
        if(random()<.45)place('bush',x+nx*1.2,z+nz*1.2,.65+random()*.35,random()*6.28,base-.05);
        if(random()<.35)place('stone',x-nx*.6,z-nz*.6,[.4+random()*.4,.25+random()*.3,.45+random()*.3],random()*6.28,top-.12);
      }
      carried=(carried-length)%4.7;if(carried<0)carried+=4.7;
    }
  }
  // Bushes, smaller trees and stones make a continuous but uneven forest edge.
  for(const patch of LANDSCAPE.geography.forests){
    const line=patch.area.points;
    for(let i=0;i<line.length;i++){
      const p=line[i];
      if(LANDSCAPE.geography.roadDistance(p)<3.5||LANDSCAPE.waterAreas.some(a=>polygonDistance(p,a)<1.5))continue;
      const d=1.4,a=random()*Math.PI*2,x=p.x+Math.cos(a)*d,z=p.z+Math.sin(a)*d;
      if(!insidePolygon({x,z},patch.area))continue;
      const slope=Math.abs(terrainHeight(x+1,z)-terrainHeight(x-1,z))+Math.abs(terrainHeight(x,z+1)-terrainHeight(x,z-1));
      if(slope>1.5)continue;
      place(i%5===0?'stone':'bush',x,z,.65+random()*.45,random()*6.28);
    }
  }
  // Shore groups alternate reed pockets, gravel bars and larger creek stones;
  // there is no evenly spaced decorative ring around the water.
  for(const area of LANDSCAPE.waterAreas){
    let distance=0;
    for(let i=0;i<area.points.length;i++){
      const p=area.points[i],q=area.points[(i+1)%area.points.length];distance+=Math.hypot(q.x-p.x,q.z-p.z);
      if(distance<2.0)continue;distance=0;
      if(LANDSCAPE.bridges.some(b=>Math.hypot(p.x-b.x,p.z-b.z)<b.length/2+1.7))continue;
      const pocket=Math.sin(p.x*.24+p.z*.19)+.55*Math.cos(p.z*.36-p.x*.11);
      if(pocket<-.2)continue;
      const dx=q.x-p.x,dz=q.z-p.z,len=Math.hypot(dx,dz)||1;
      let nx=-dz/len,nz=dx/len;
      if(!insidePolygon({x:p.x+nx*.3,z:p.z+nz*.3},area)){nx=-nx;nz=-nz;}
      const wet=area.z<0,reed=wet||pocket>.7;
      for(let j=0;j<(reed?5:2);j++){
        const along=(random()-.5)*3.3,depth=.4+random()*.8;
        const x=p.x+dx/len*along+nx*depth,z=p.z+dz/len*along+nz*depth;
        if(polygonDistance({x,z},area)>-.2)continue;
        place(reed?'reeds':'stone',x,z,reed?.7+random()*.5:.2+random()*.3,random()*6.28,LANDSCAPE.waterLevel({x,z})-.08);
      }
      if(!wet&&pocket>1.1&&random()<.65){
        const x=p.x+nx*1.4,z=p.z+nz*1.4;
        if(polygonDistance({x,z},area)<-1.2)place('stone',x,z,[.85+random()*.4,.65+random()*.5,.8+random()*.3],random()*6.28,LANDSCAPE.waterLevel({x,z})-.18);
      }
    }
  }
}
