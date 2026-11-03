import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { createPalette } from '../src/game/models.ts';
import { createDaylight } from '../src/game/lighting.ts';
import { createFarmModel, farmGridKey, farmNeighbourMask } from '../src/game/farm-model.ts';
import { GRID_SIZE } from '../src/game/world-data.ts';

const canvas = document.querySelector('canvas')!, engine = new Engine(canvas, true), scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#bbc994ff');
const camera = new ArcRotateCamera('review', -Math.PI / 2, .76, 15, new Vector3(0, .08, 0), scene);
camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
const palette = createPalette(scene); createDaylight(scene);
const layout=new URLSearchParams(location.search).get('layout')??'single';
const cells=(layout==='row'?[[0,0],[1,0]]:layout==='block'?[[0,0],[1,0],[0,1],[1,1]]:layout==='l'?[[0,0],[1,0],[0,1]]:[[0,0]])
  .map(([x,z])=>({x:x*GRID_SIZE,z:z*GRID_SIZE}));
const tilled=new Set(cells.map(farmGridKey));
const meshes=cells.map(p=>{const first=scene.meshes.length,soil=createFarmModel(scene,palette,farmNeighbourMask(p,tilled));
  for(const m of scene.meshes.slice(first)){m.position.x+=p.x;m.position.z+=p.z;}return soil;});
const soil=meshes[0];camera.target.x=Math.max(...cells.map(p=>p.x))/2;camera.target.z=Math.max(...cells.map(p=>p.z))/2;
const ground = MeshBuilder.CreateGround('ground', { width: 10, height: 10 }, scene);
ground.position.y = .012; ground.material = palette.grass;
function view(name = 'game', size = 2.8) {
  engine.resize(); camera.alpha = name === 'side' ? 0 : -Math.PI / 2;
  camera.beta = name === 'side' ? 1.36 : name === 'top' ? .08 : .76;
  camera.orthoTop = size / 2; camera.orthoBottom = -size / 2;
  camera.orthoRight = size / 2 * engine.getAspectRatio(camera); camera.orthoLeft = -camera.orthoRight;
  scene.render();
}
view(); await scene.whenReadyAsync(); view();
Object.assign(window, { farmReview: { view, scene, engine, soil } });
