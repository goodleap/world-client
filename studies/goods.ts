import { Engine, Scene, ArcRotateCamera, Vector3, Color3, Color4, MeshBuilder, StandardMaterial } from '@babylonjs/core';
import { createPalette } from '../src/game/models.ts';
import { createDaylight } from '../src/game/lighting.ts';
import { createLandscapeRockMaterial } from '../src/game/landscape-rock.ts';
import { createGroundGoodsModel } from '../src/game/ground-goods-model.ts';
import type { Goods } from '../src/game/economy.ts';

const query = new URLSearchParams(location.search), kind = query.get('kind') || 'carrot';
const engine = new Engine(document.querySelector('canvas')!, true, { preserveDrawingBuffer: true });
const scene = new Scene(engine); scene.clearColor = Color4.FromHexString('#f4efdaff');
const camera = new ArcRotateCamera('goods-review', -Math.PI/2, .76, 10, new Vector3(0,.18,0), scene);
camera.mode = 1;
const p = createPalette(scene), shadows = createDaylight(scene), rock = createLandscapeRockMaterial(scene);
const carrot = new StandardMaterial('carrot-orange',scene); carrot.diffuseColor = Color3.FromHexString('#f28328'); carrot.specularColor = Color3.Black();
const goods: Pick<Goods,'resource'|'crop'> = kind === 'carrot' || kind === 'wheat' ? {resource:'food',crop:kind} : {resource:kind as Goods['resource']};
createGroundGoodsModel(scene,p,carrot,rock,goods);
const meshes = [...scene.meshes]; for (const m of meshes) { m.computeWorldMatrix(true); shadows.addShadowCaster(m); m.receiveShadows = true; }
const report = {
  kind, triangles: meshes.reduce((n,m)=>n+m.getTotalIndices()/3,0),
  bottom: Math.min(...meshes.map(m=>m.getBoundingInfo().boundingBox.minimumWorld.y)),
  top: Math.max(...meshes.map(m=>m.getBoundingInfo().boundingBox.maximumWorld.y)),
};
const ground = MeshBuilder.CreateGround('ground',{width:40,height:40},scene); ground.material=p.cream; ground.receiveShadows=true;
let currentView='game';
function view(name=currentView) {
  currentView=name;
  engine.resize(); camera.alpha = name === 'side' ? 0 : -Math.PI/2;
  camera.beta = name === 'front' || name === 'side' ? Math.PI/2-.08 : .76;
  const zoom = name === 'mobile' ? 3.1 : .8, aspect = innerWidth/innerHeight;
  camera.orthoTop=zoom; camera.orthoBottom=-zoom; camera.orthoLeft=-zoom*aspect; camera.orthoRight=zoom*aspect;
  document.querySelector('#note')!.textContent = name === 'mobile' ? '' : `${kind} · ${name}`;
  scene.render();
}
Object.assign(window,{goodsReview:{view,report}});
await scene.whenReadyAsync(); view(); document.body.dataset.ready='true';
engine.runRenderLoop(()=>scene.render()); addEventListener('resize',()=>view());
