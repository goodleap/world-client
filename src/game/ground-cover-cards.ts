import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { Scene } from '@babylonjs/core/scene.js';
import atlasUrl from '../assets/environment/ground-cover.png?url';

/** Native alpha-tested cards: one shared atlas/material, two triangles per
 * clump, no transparent sorting, billboard callbacks or shadow caster pass.
 * The slight tilt follows the game's fixed camera azimuth and keeps short
 * stems above the ground at both normal and close inspection angles. */
export async function createGroundCoverCards(scene:Scene){
  const texture=await new Promise<Texture>((resolve,reject)=>{
    const t=new Texture(atlasUrl,scene,false,true,Texture.TRILINEAR_SAMPLINGMODE,
      ()=>resolve(t),message=>reject(new Error(`草花贴图加载失败：${message}`)));
  });
  texture.hasAlpha=true;texture.wrapU=texture.wrapV=Texture.CLAMP_ADDRESSMODE;texture.anisotropicFilteringLevel=4;
  const material=new StandardMaterial('ground-cover-painted',scene);
  material.diffuseTexture=texture;material.diffuseColor=new Color3(.22,.22,.22);
  // A painted base retains the petal colors; native light/shadow adds only a
  // small response. Emission multiplies the texture rather than bleaching it.
  material.emissiveColor=new Color3(.78,.78,.78);material.specularColor=Color3.Black();
  material.useAlphaFromDiffuseTexture=true;material.transparencyMode=Material.MATERIAL_ALPHATEST;
  material.alphaCutOff=.4;material.backFaceCulling=false;
  material.freeze();
  return Array.from({length:4},(_,variant)=>{
    const flower=variant>0,w=flower?1.04:.85,d=flower?.72:.62,h=flower?.36:.32;
    const mesh=new Mesh(`ground-cover-card-${variant}`,scene),data=new VertexData();
    data.positions=[-w/2,.025,-d/2,w/2,.025,-d/2,w/2,h,d/2,-w/2,h,d/2];
    data.indices=[0,2,1,0,3,2];const normals:number[]=[];VertexData.ComputeNormals(data.positions,data.indices,normals);data.normals=normals;
    const x=variant%2*.5,y=Math.floor(variant/2)*.5,pad=2/512;
    data.uvs=[x+pad,1-y-.5+pad,x+.5-pad,1-y-.5+pad,x+.5-pad,1-y-pad,x+pad,1-y-pad];
    data.applyToMesh(mesh);mesh.material=material;mesh.isVisible=false;mesh.isPickable=false;mesh.receiveShadows=true;
    return mesh;
  });
}
