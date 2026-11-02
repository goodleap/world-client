import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import {towerPlatform} from './towers.ts';
import type { TowerState } from './towers.ts';
import { TOWER_CONFIG } from './towers.ts';
import { UNIT_SELECTION_COLOR } from './selection-colors.ts';
export function createTowerRange(scene:Scene){
  const points=Array.from({length:65},(_,i)=>new Vector3(Math.cos(i*Math.PI/32)*TOWER_CONFIG.range,.1,Math.sin(i*Math.PI/32)*TOWER_CONFIG.range));
  const mesh=MeshBuilder.CreateLines('tower-range',{points},scene);mesh.color=Color3.FromHexString(UNIT_SELECTION_COLOR);mesh.alpha=.65;mesh.isPickable=false;mesh.setEnabled(false);
  return {update(tower?:TowerState){mesh.setEnabled(!!tower?.hp);if(tower){const p=tower.phase==='occupied'?towerPlatform(tower):tower;mesh.position.set(p.x,0,p.z);}}};
}
