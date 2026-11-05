import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import type { EnvironmentLibrary, EnvironmentAsset } from './environment-library.ts';
import { LANDSCAPE } from './world-data.ts';
import { groundHeight, terrainHeight } from './terrain-height.ts';
import { seededRandom } from './landscape-layout.ts';
import { polygonDistance, insidePolygon } from './polygon.ts';

/** Immutable rocks and ground cover follow the authored landforms and shores. Small
 * ground cover is passable; full-size rocks and trunks never straddle a road. */
export function createLandscapeScenery(_scene:Scene,shadows:ShadowGenerator,library:EnvironmentLibrary) {
  const random=seededRandom(9037);let sequence=0;
  const place=(asset:EnvironmentAsset,x:number,z:number,scale:number|[number,number,number],angle:number,y=groundHeight(x,z))=>{
    const mesh=library.source(asset).createInstance(`map-scenery-${asset}-${sequence++}`);
    mesh.position.set(x,y,z);if(typeof scale==='number')mesh.scaling.setAll(scale);else mesh.scaling.set(...scale);mesh.rotation.y=angle;
    mesh.isPickable=false;mesh.receiveShadows=true;mesh.freezeWorldMatrix();
    if(asset!=='reeds')shadows.addShadowCaster(mesh,false);
    return mesh;
  };
  // The rock model keeps its ledges but has a low, rounded upper rim. Match
  // that rim to the actual terrace and overlap variable-width pieces instead
  // of repeating deep notches above the grass. The native terrain joins behind.
  const cliffRandom=seededRandom(18319);
  for(const form of LANDSCAPE.geography.forms.filter(f=>f.kind!=='basin')){
    const line=form.area.points;let carried=0;
    for(let i=0;i<line.length;i++){
      const a=line[i],b=line[(i+1)%line.length],length=Math.hypot(b.x-a.x,b.z-a.z);
      let nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
      if(insidePolygon({x:a.x+nx*.3,z:a.z+nz*.3},form.area)){nx=-nx;nz=-nz;}
      let d=carried;
      for(;d<length;){
        const x=a.x+(b.x-a.x)*d/length,z=a.z+(b.z-a.z)*d/length,p={x,z};
        const width=.9+cliffRandom()*.3,depth=.65+cliffRandom()*.15,reach=Math.max(2,form.edge*.85);
        const base=terrainHeight(x+nx*reach,z+nz*reach),top=terrainHeight(x-nx*reach,z-nz*reach);
        d+=width*(4.1+cliffRandom()*.3);
        if(top-base<1.4||LANDSCAPE.geography.roadDistance(p)<6||LANDSCAPE.waterAreas.some(a=>polygonDistance(p,a)<2))continue;
        place('cliff',x,z,[width,(top-base)/3.5,depth],Math.atan2(nx,nz),base-.16);
      }
      carried=d-length;
    }
  }
  // Low non-resource leaves and pebbles are baked into the ground paint.
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
        if(polygonDistance({x,z},area)<-1.2)place('stone',x,z,[.85+random()*.4,.28+random()*.18,.8+random()*.3],random()*6.28,LANDSCAPE.waterLevel({x,z})-.18);
      }
    }
  }
}
