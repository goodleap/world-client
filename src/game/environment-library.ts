import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { modelData, modelOptions } from './asset-cache.ts';
import { loadingProgress } from '../loading-progress.ts';
import type { Scene } from '@babylonjs/core/scene.js';
import '@babylonjs/loaders/glTF/index.js';
import '@babylonjs/core/Meshes/instancedMesh.js';

export type EnvironmentAsset = 'oak'|'pine'|'sapling'|'fruit'|'blossom'|'bush'|'reeds'|'grass'|'flowers'|'stone'|'cliff';
export async function loadEnvironment(scene:Scene) {
  const url=`${import.meta.env.BASE_URL}assets/environment/environment.glb`;
  loadingProgress.register(url,'地形与植物模型','download');
  const data=await modelData(url);
  const container=await loadingProgress.run('environment:parse','地形与植物：解析',()=>LoadAssetContainerAsync(data,scene,modelOptions(url)));

  const material=new StandardMaterial('environment-painted-matte',scene);
  material.diffuseColor=Color3.White();material.specularColor=Color3.Black();
  const meshes=new Map<string,Mesh>();
  for(const mesh of container.meshes) {
    if(!(mesh instanceof Mesh)||!mesh.getTotalVertices())continue;
    const extras=mesh.metadata?.gltf?.extras;
    if(!extras?.asset||!extras?.detail)continue;
    mesh.computeWorldMatrix(true);mesh.bakeCurrentTransformIntoVertices();mesh.parent=null;
    // glTF nodes retain an identity quaternion after baking. Instances inherit
    // it, which would otherwise override the placement's Euler rotation.
    mesh.rotationQuaternion=null;
    const colors=mesh.getVerticesData('color'),stride=mesh.getVertexBuffer('color')?.getSize()??4;
    if(colors){
      const rgba=new Float32Array(mesh.getTotalVertices()*4);
      for(let i=0,j=0;i<colors.length;i+=stride,j+=4){
        for(let c=0;c<3;c++){const v=colors[i+c];rgba[j+c]=v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;}
        rgba[j+3]=1;
      }
      mesh.setVerticesData('color',rgba,false,4);
    }
    mesh.material=material;mesh.isVisible=false;mesh.isPickable=false;mesh.receiveShadows=true;
    mesh._instanceDataStorage.useMonoDataStorageRenderPass=false;
    scene.addMesh(mesh);mesh.freezeWorldMatrix();meshes.set(`${extras.asset}-${extras.detail}`,mesh);
  }
  for(const [key,source] of meshes)if(key.endsWith('-near')){
    const name=key.slice(0,-5);
    source.useLODScreenCoverage=true;
    source.addLODLevel(['oak','pine','sapling','fruit','blossom'].includes(name)?.22:.055,meshes.get(`${name}-medium`)!);
    source.addLODLevel(.012,meshes.get(`${name}-far`)!);
  }
  material.freeze();
  // Imported PBR materials/textures are replaced by one opaque matte material.
  for(const original of container.materials)original.dispose();
  return {source(name:EnvironmentAsset,detail:'near'|'medium'|'far'='near'){
    const mesh=meshes.get(`${name}-${detail}`);if(!mesh)throw new Error(`环境模型缺失：${name}/${detail}`);return mesh;
  }};
}
export type EnvironmentLibrary=Awaited<ReturnType<typeof loadEnvironment>>;
