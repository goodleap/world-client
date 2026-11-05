import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { modelData, modelOptions } from './asset-cache.ts';
import { loadingProgress } from '../loading-progress.ts';
import type { Scene } from '@babylonjs/core/scene.js';
import '@babylonjs/loaders/glTF/index.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { TREE_COLORS, treeAsset, treeColor } from './tree-profile.ts';
import type { TreeSpecies, TreeSize, TreeColor } from './tree-profile.ts';
import environmentAsset from '../assets/environment/environment.glb?url';

export type EnvironmentAsset = 'bush'|'reeds'|'grass'|'flowers'|'stone'|'cliff';
type Detail='near'|'medium'|'far';
export async function loadEnvironment(scene:Scene) {
  // Vite fingerprints the content, just like character GLBs. A fixed public
  // URL can serve cached geometry whose parts no longer match this loader.
  const url=environmentAsset;
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
    scene.addMesh(mesh);mesh.freezeWorldMatrix();meshes.set(`${extras.asset}${extras.treePart?`-${extras.treePart}`:''}-${extras.detail}`,mesh);
  }
  const get=(name:string,detail:Detail)=>{
    const mesh=meshes.get(`${name}-${detail}`);if(!mesh)throw new Error(`环境模型缺失：${name}/${detail}`);return mesh;
  };
  const attachLOD=(source:Mesh,medium:Mesh,far:Mesh,coverage:number)=>{
    source.useLODScreenCoverage=true;source.addLODLevel(coverage,medium);source.addLODLevel(.012,far);
  };
  for(const [key,source] of meshes)if(key.endsWith('-near')){
    const name=key.slice(0,-5);
    // Ordinary crowns use palette clones; the restored pine retains its paint.
    if(name.endsWith('-crown')&&name!=='pine-crown')continue;
    attachLOD(source,get(name,'medium'),get(name,'far'),name.endsWith('-wood')||name==='pine-crown'?.22:.055);
  }
  material.freeze();
  const colors=new Map<TreeColor,StandardMaterial>(),crowns=new Map<string,Mesh>();
  function crown(asset:string,color:TreeColor){
    const key=`${asset}-${color}`,cached=crowns.get(key);if(cached)return cached;
    let palette=colors.get(color);
    if(!palette){palette=new StandardMaterial(`tree-${color}`,scene);palette.diffuseColor=Color3.FromHexString(TREE_COLORS[color]);palette.specularColor=Color3.Black();palette.freeze();colors.set(color,palette);}
    const levels=(['near','medium','far'] as const).map(detail=>{
      // Babylon Mesh.clone shares Geometry; only the material and native
      // instance batches differ. No per-tree geometry/material allocations.
      const mesh=get(`${asset}-crown`,detail).clone(`${key}-${detail}`,null,true);
      mesh.material=palette;mesh.isVisible=false;mesh.isPickable=false;
      mesh._instanceDataStorage.useMonoDataStorageRenderPass=false;mesh.freezeWorldMatrix();return mesh;
    });
    attachLOD(levels[0],levels[1],levels[2],.22);crowns.set(key,levels[0]);return levels[0];
  }
  // Imported PBR materials are replaced by shared opaque matte materials.
  for(const original of container.materials)original.dispose();
  return {source:(name:EnvironmentAsset,detail:Detail='near')=>get(name,detail),
    tree(species:TreeSpecies,size:TreeSize,tone:number){
      const asset=treeAsset(species,size);return [get(`${asset}-wood`,'near'),asset==='pine'?get('pine-crown','near'):crown(asset,treeColor(species,tone))];
    }};
}
export type EnvironmentLibrary=Awaited<ReturnType<typeof loadEnvironment>>;
