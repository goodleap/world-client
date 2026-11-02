import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Palette } from './models.ts';
import { roundedBox as rounded } from './environment-shapes.ts';
import { tiledRoof,blueBanner } from './buildings.ts';
import { GRID_SIZE } from './world-data.ts';
import { TOWER_CONFIG } from './towers.ts';

// Tiny timber bevels need only one curved edge segment at game distance.
const roundedBox=(scene:Scene,name:string,size:[number,number,number],at:[number,number,number],material:StandardMaterial,radius:number)=>rounded(scene,name,size,at,material,radius,1);

/** Reference watchtower: pale stone footing, timber stilts and braces, an open
 * railed shooting deck, orange curved tiles and a blue cloth banner. Batched by
 * the economy template system; every additional tower uses native instances. */
export function createTowerModel(scene:Scene,p:Palette){
  const width=GRID_SIZE*2,half=width/2-.25,deck=TOWER_CONFIG.height;
  const braceHeight=deck-.65,braceLength=Math.hypot(2*half,braceHeight),braceAngle=Math.atan2(2*half,braceHeight);
  for(const x of [-half,half])for(const z of [-half,half]){
    roundedBox(scene,'tower-stone-foot',[.62,.48,.62],[x,.24,z],p.stoneLight,.1);
    roundedBox(scene,'tower-support',[.28,deck-.3,.28],[x,(deck+.3)/2,z],p.timber,.065);
    roundedBox(scene,'tower-roof-post',[.2,3.5,.2],[x,deck+1.7,z],p.timberLight,.05);
  }
  for(const side of [-1,1])for(const diagonal of [-1,1]){
    const brace=roundedBox(scene,'tower-cross-brace',[.17,braceLength,.17],[side*half,1.72,0],p.timberLight,.04);
    brace.rotation.x=diagonal*braceAngle;
  }
  for(const diagonal of [-1,1]){const brace=roundedBox(scene,'tower-back-brace',[.17,braceLength,.17],[0,1.72,half],p.timberLight,.04);brace.rotation.z=diagonal*braceAngle;}
  const boards=7;
  for(let i=0;i<boards;i++)roundedBox(scene,'tower-deck-board',[width-.1,.18,(width-.1)/boards-.025],[0,deck-.09,(i-(boards-1)/2)*(width-.1)/boards],p.timberLight,.045);
  for(const side of [-1,1]){
    roundedBox(scene,'tower-side-rail',[.15,.16,width-.2],[side*(half+.03),deck+.72,0],p.timberLight,.04);
    if(side===1)roundedBox(scene,'tower-back-rail',[width-.2,.16,.15],[0,deck+.72,half+.03],p.timberLight,.04);
    else for(const x of [-1,1])roundedBox(scene,'tower-entrance-rail',[(width-1.2)/2,.16,.15],[x*(width+.8)/4,deck+.72,-half-.03],p.timberLight,.04);
    for(const t of [-.65,0,.65]){
      roundedBox(scene,'tower-side-baluster',[.1,.65,.1],[side*(half+.03),deck+.34,t],p.timber,.03);
      if(side===1||Math.abs(t)>.4)roundedBox(scene,'tower-back-baluster',[.1,.65,.1],[t,deck+.34,side*(half+.03)],p.timber,.03);
    }
  }
  // Visible inclined ladder follows the entrance on the negative Z side.
  for(const x of [-.4,.4]){
    const rail=roundedBox(scene,'tower-ladder-side',[.12,3.35,.12],[x,1.59,-half-.35],p.timberLight,.035);rail.rotation.x=.22;
  }
  for(let i=0;i<9;i++)roundedBox(scene,'tower-ladder-rung',[.86,.12,.14],[0,.3+i*.34,-half-.65+i*.075],p.timber,.03);
  tiledRoof(scene,p,0,0,width-.1,width-.1,6.3,.85,2);
  blueBanner(scene,p,half,0,6.45);
}
