import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import '@babylonjs/loaders/glTF/index.js';
import { buildSample, samples } from './samples.ts';
import type { SampleName } from './samples.ts';

const params = new URLSearchParams(location.search);
const chosen=params.get('sample')??'creek';
const sample:SampleName=chosen in samples?chosen as SampleName:'creek';
document.body.dataset.capture = String(params.has('capture'));
document.querySelector('#title')!.textContent=samples[sample].title;
document.querySelector('#description')!.textContent=samples[sample].description;
for(const [key,info]of Object.entries(samples)){
  const button=document.createElement('button');button.textContent=info.title;button.setAttribute('aria-pressed',String(key===sample));
  button.addEventListener('click',()=>{const next=new URL(location.href);next.searchParams.set('sample',key);location.assign(next);});
  document.querySelector('#samples')!.append(button);
}
const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#e9ecddff');
scene.imageProcessingConfiguration.contrast = 1;
scene.imageProcessingConfiguration.exposure = 1;
const camera = new ArcRotateCamera('review', -1.5, 1.08, 45, new Vector3(0, 2.2, 0), scene);
camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
camera.minZ = .1;camera.lowerBetaLimit=.15;camera.upperBetaLimit=1.52;camera.panningSensibility=0;
camera.attachControl(canvas, true);
const fill = new HemisphericLight('sky', new Vector3(0,1,0), scene);
fill.intensity = .68; fill.diffuse = Color3.FromHexString('#eef5e7'); fill.groundColor = Color3.FromHexString('#a3b58d');
const sun = new DirectionalLight('sun', new Vector3(.7,-1,-.45), scene);
sun.position.set(-12,20,9); sun.diffuse = Color3.FromHexString('#fff1da'); sun.intensity=.72;
sun.autoCalcShadowZBounds = true;
const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering=true;shadows.filteringQuality=ShadowGenerator.QUALITY_HIGH;
shadows.bias=.0004; shadows.normalBias=.025; shadows.setDarkness(.18);
const floor = MeshBuilder.CreateGround('neutral review floor', { width:200, height:200 }, scene);
const floorMat = new StandardMaterial('neutral matte', scene);
floorMat.diffuseColor=Color3.FromHexString('#bbc5ae'); floorMat.specularColor=Color3.Black();
floor.material=floorMat;floor.receiveShadows=true;floor.position.y=['oak','trees','colors'].includes(sample)?-.025:-.285;
const info=await buildSample(sample,scene,shadows);
camera.target.set(info.target[0],info.target[1],info.target[2]);
let height=info.height, rotating=false;
camera.lowerRadiusLimit=45*3/info.height;camera.upperRadiusLimit=45*32/info.height;
camera.wheelDeltaPercentage=.015;camera.pinchDeltaPercentage=.006;
camera.onAfterCheckInputsObservable.add(()=>{const next=info.height*camera.radius/45;if(Math.abs(next-height)>.0001){height=next;fit();}});
function frame(view='game') {
  camera.target.set(info.target[0],info.target[1],info.target[2]);camera.radius=45;height=info.height;
  camera.alpha=view==='side'?.15:-1.43;
  camera.beta=view==='game'?(['oak','trees','colors'].includes(sample)?1.08:.85):1.38;
  fit();scene.render();
}
function fit(){engine.resize();const minWidth=(sample==='oak'?3.2:sample==='trees'?8:sample==='colors'?12.4:20)*(height/info.height),h=Math.max(height,minWidth/engine.getAspectRatio(camera));camera.orthoTop=h/2;camera.orthoBottom=-h/2;camera.orthoRight=h/2*engine.getAspectRatio(camera);camera.orthoLeft=-camera.orthoRight;}
document.querySelector('#game')!.addEventListener('click',()=>frame());
document.querySelector('#side')!.addEventListener('click',()=>frame('side'));
document.querySelector('#rotate')!.addEventListener('click',e=>{rotating=!rotating;(e.currentTarget as HTMLButtonElement).setAttribute('aria-pressed',String(rotating));});
await scene.whenReadyAsync();frame();
document.querySelector('#status')!.textContent='Babylon.js 实际渲染 · 局部模型待审阅';
engine.runRenderLoop(()=>{if(rotating)camera.alpha+=engine.getDeltaTime()*.00016;scene.render();});
addEventListener('resize',fit);
Object.assign(window,{mapArt:{scene,engine,camera,frame,ready:true,
  focus(target:[number,number,number],viewHeight:number){camera.target.set(...target);height=viewHeight;camera.radius=45*height/info.height;fit();scene.render();},
}});
