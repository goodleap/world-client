import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { createPalette } from '../src/game/models.ts';
import { createCampfireView } from '../src/game/campfire-view.ts';
import { newCampfire } from '../src/game/campfire.ts';
import { createBuildingDoors } from '../src/game/building-doors.ts';
import { referenceHouse } from '../src/game/buildings.ts';
const query = new URLSearchParams(location.search), door = query.has('door');
const engine = new Engine(document.querySelector('canvas')!, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine); scene.clearColor = Color4.FromHexString('#555e45ff');
const camera = new ArcRotateCamera('review', query.has('side') ? -.2 : -Math.PI / 2, query.has('side') ? 1.12 : .76, 20, new Vector3(0, door ? 1 : .45, 0), scene);
camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
const aspect = innerWidth / innerHeight, zoom = door ? 4.5 : query.has('mobile') ? 5 : 2.3;
camera.orthoTop = zoom; camera.orthoBottom = -zoom; camera.orthoLeft = -zoom * aspect; camera.orthoRight = zoom * aspect;
const ambient = new HemisphericLight('sky', Vector3.Up(), scene); ambient.intensity = query.has('night') ? .18 : .75;
const sun = new DirectionalLight('sun', new Vector3(-.5, -1, .8), scene); sun.intensity = query.has('night') ? .08 : .5;
const p = createPalette(scene), ground = MeshBuilder.CreateGround('ground', { width: 80, height: 80 }, scene); ground.material = p.grass;
if (door) {
 const b = { id: 'warehouse', x: 0, z: 0, width: 5.4, depth: 3.6, height: 2.9, roof: 'terracotta' };
 referenceHouse(scene, p, b, false); const doors = createBuildingDoors(scene, p); doors.add(b, true);
 if (query.has('open')) { doors.useWarehouse(); doors.update(.4); }
} else {
 const fires = createCampfireView(scene, p); fires.add({ id: 'review', x: 0, z: 0 });
 const f = newCampfire('review'); f.enabled = query.get('state') !== 'off'; f.wood = 6; f.cook = query.get('state') === 'cooking' ? 2 : 0;
 fires.update([f], 1, { x: 0, z: 0 });
}
document.querySelector('#note')!.textContent = door ? query.has('open') ? '仓库 · 开门' : '仓库 · 关门' : `火堆 · ${({off:'熄火',lit:'点火',cooking:'烹饪'} as Record<string, string>)[query.get('state') ?? 'lit']}`;
await scene.whenReadyAsync(); scene.render(); document.body.dataset.ready = 'true';
engine.runRenderLoop(() => scene.render());
