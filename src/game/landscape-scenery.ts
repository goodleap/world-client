import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import type { EnvironmentLibrary, EnvironmentAsset } from './environment-library.ts';
import { LANDSCAPE, MAP_WIDTH, MAP_DEPTH, MAP_LANDMARKS } from './world-data.ts';
import { groundHeight, terrainHeight } from './terrain-height.ts';
import { seededRandom } from './landscape-layout.ts';
import { polygonDistance, insidePolygon } from './polygon.ts';

/** Immutable scenery lives inside the authored woodland/water solids. Small
 * ground cover is passable; full-size rocks and trunks never straddle a road. */
export function createLandscapeScenery(_scene:Scene,shadows:ShadowGenerator,library:EnvironmentLibrary) {
  const random=seededRandom(9037);let sequence=0;
  const place=(asset:EnvironmentAsset,x:number,z:number,scale:number,angle:number,y=groundHeight(x,z))=>{
    const mesh=library.source(asset).createInstance(`map-scenery-${asset}-${sequence++}`);
    mesh.position.set(x,y,z);mesh.scaling.setAll(scale);mesh.rotation.y=angle;
    mesh.isPickable=false;mesh.receiveShadows=true;mesh.freezeWorldMatrix();
    if(asset!=='grass'&&asset!=='flowers'&&asset!=='reeds')shadows.addShadowCaster(mesh,false);
    return mesh;
  };
  for(const tree of LANDSCAPE.sceneryTrees)place(tree.species,tree.x,tree.z,tree.scale,tree.rotation);
  for(const prop of MAP_LANDMARKS.props)if(prop.kind==='mine')place('cliff',prop.x,prop.z+1.7,.95,Math.PI,terrainHeight(prop.x,prop.z)-.1);
  // A low, irregular shrub/root layer meets the walkable edge before tall
  // crowns. This removes the former uniformly extruded vertical green wall.
  for(let z=-MAP_DEPTH/2+2;z<MAP_DEPTH/2-2;z+=3.1)for(let x=-MAP_WIDTH/2+2;x<MAP_WIDTH/2-2;x+=3.1){
    const p={x:x+(random()-.5),z:z+(random()-.5)};
    if(LANDSCAPE.contains(p)||LANDSCAPE.waterAreas.some(a=>polygonDistance(p,a)<1.8))continue;
    const d=Math.min(...LANDSCAPE.playable.map(a=>polygonDistance(p,a)));
    if(d<1||d>4.8)continue;
    const region=LANDSCAPE.regions.reduce((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)<Math.hypot(b.x-p.x,b.z-p.z)?a:b);
    const rocky=region.biome==='rock'||region.biome==='highland'||region.biome==='ruins';
    if(rocky&&d>3&&random()<.65)place('cliff',p.x,p.z,.8+random()*.3,Math.PI+(random()-.5)*.8);
    else place(rocky&&random()<.5?'stone':'bush',p.x,p.z,.65+random()*.35,random()*Math.PI*2);
  }
  for(const area of LANDSCAPE.waterAreas){
    let distance=0;
    for(let i=0;i<area.points.length;i++){
      const p=area.points[i],q=area.points[(i+1)%area.points.length];distance+=Math.hypot(q.x-p.x,q.z-p.z);
      if(distance<2.4)continue;distance=0;
      if(LANDSCAPE.bridges.some(b=>Math.hypot(p.x-b.x,p.z-b.z)<b.length/2+2))continue;
      const dx=q.x-p.x,dz=q.z-p.z,len=Math.hypot(dx,dz)||1;
      let side=1;
      if(!insidePolygon({x:p.x-dz/len*.4,z:p.z+dx/len*.4},area))side=-1;
      const x=p.x-dz/len*.38*side,z=p.z+dx/len*.38*side;
      place(random()<.55?'reeds':'stone',x,z,.3+random()*.4,random()*6.28,terrainHeight(x,z)-.06);
    }
  }
}
