import { Engine, Scene, ArcRotateCamera, Camera, TransformNode, MeshBuilder, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, StandardMaterial, ShadowGenerator, ImportMeshAsync } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { createCharacterLibrary } from '../src/game/character-library.ts';
import type { CharacterRole } from '../src/game/character-library.ts';
import { batchSkinnedMeshes } from '../src/game/mesh-batching.ts';
import { DeathView } from '../src/game/death-view.ts';
import { createCharacterMaterialSetup } from '../src/game/character-materials.ts';
const role=new URLSearchParams(location.search).get('role') ?? 'infantry';
const engine=new Engine(document.querySelector('canvas')!,true,{preserveDrawingBuffer:true}), scene=new Scene(engine);
scene.clearColor=Color4.FromHexString('#e5e6dfff');
const camera=new ArcRotateCamera('review',1.1,1.0,10,new Vector3(1,.8,0),scene);camera.mode=Camera.ORTHOGRAPHIC_CAMERA;
const sky=new HemisphericLight('sky',Vector3.Up(),scene);sky.intensity=.7;
const sun=new DirectionalLight('sun',new Vector3(-.5,-1,.7),scene);sun.intensity=.8;
const floor=MeshBuilder.CreateGround('floor',{width:40,height:40},scene), mat=new StandardMaterial('floor',scene);mat.diffuseColor=Color3.FromHexString('#899572');floor.material=mat;floor.position.y=-.02;
const root=new TransformNode('death-review',scene), library=createCharacterLibrary(scene);
const loaded=role==='wolf' ? await ImportMeshAsync('/studies/wolf/wolf.glb',scene) : await library.instantiate(role as CharacterRole,root);
if(role==='wolf') for(const n of loaded.meshes.filter(m=>!m.parent)) n.parent=root;
for(const mesh of loaded.meshes) if(mesh.metadata?.gltf?.extras?.wolfLOD!==undefined) mesh.setEnabled(mesh.metadata.gltf.extras.wolfLOD===0);
createCharacterMaterialSetup(scene)(loaded.meshes.map(m=>m.material));
const meshes=role==='wolf' ? loaded.meshes.filter(m=>m.isEnabled()&&m.getTotalVertices()) : batchSkinnedMeshes(loaded.meshes,library.highBatches);
floor.receiveShadows=true;sun.position.set(-3,7,4);
const shadows=new ShadowGenerator(512,sun);shadows.usePercentageCloserFiltering=true;for(const mesh of meshes)shadows.addShadowCaster(mesh);
const view=new DeathView(root, role === 'cavalry' ? 1 : -1), neutral=loaded.animationGroups.find(g=>g.name===(role==='wolf'?'Idle':role==='cavalry'?'RideIdle':'Walk'))!;
function pose(){for(const g of loaded.animationGroups)g.stop();neutral.enableBlending=false;neutral.start(false).pause();neutral.goToFrame(neutral.from);}
function frame(age:number){view.sample(age,0,meshes,pose);scene.render();document.querySelector('#note')!.textContent=`${role} · ${age.toFixed(2)} 秒 · ${view.snapshot().phase}`;return view.snapshot();}
function angle(name:string){engine.resize();camera.alpha=name==='side'?-Math.PI/2:1.1;camera.beta=name==='side'?1.4:1.0;const zoom=role==='cavalry'?3.2:2.3;camera.orthoTop=zoom;camera.orthoBottom=-zoom;camera.orthoRight=zoom*engine.getAspectRatio(camera);camera.orthoLeft=-camera.orthoRight;scene.render();}
pose();angle('game');await scene.whenReadyAsync();frame(0);
Object.assign(window,{deathReview:{frame,angle,snapshot:()=>view.snapshot(),scene,root}});
