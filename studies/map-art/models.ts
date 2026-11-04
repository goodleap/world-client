import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/loaders/glTF/index.js';

export const assetNames=['oak','sapling','fruit','blossom','pine','bush','reeds','grass','flowers','stone','cliff'] as const;
export type AssetName=typeof assetNames[number];
export type XYZ=[number,number,number];

/** Review assets stay outside the production entry graph. One native container
 * per asset shares geometry and materials between the small review compositions. */
export class ModelLibrary {
  private containers=new Map<AssetName,AssetContainer>();
  private sequence=0;
  constructor(readonly scene:Scene,readonly shadows:ShadowGenerator){}
  async load(names:readonly AssetName[]){
    for(const name of names){
      if(this.containers.has(name))continue;
      const container=await LoadAssetContainerAsync(`/studies/map-art/assets/${name}.glb`,this.scene);
      const materials=new Map<string,StandardMaterial>();
      for(const mesh of container.meshes){
        if(!mesh.getTotalVertices())continue;
        const name=mesh.material?.name??'matte';
        let material=materials.get(name);
        if(!material){material=new StandardMaterial(name,this.scene);material.diffuseColor=Color3.White();material.specularColor=Color3.Black();materials.set(name,material);}
        mesh.material=material;
        const colors=mesh.getVerticesData('color'),stride=mesh.getVertexBuffer('color')?.getSize()??4;
        if(colors){
          const rgba:number[]=[];
          for(let i=0;i<colors.length;i+=stride){
            for(let c=0;c<3;c++){const v=colors[i+c];rgba.push(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055);}
            rgba.push(1);
          }
          mesh.setVerticesData('color',rgba,false,4);
        }
        mesh.receiveShadows=true;mesh.isPickable=false;
      }
      this.containers.set(name,container);
    }
  }
  place(name:AssetName,at:XYZ=[0,0,0],scale:number|XYZ=1,angle=0){
    const container=this.containers.get(name);
    if(!container)throw new Error(`Asset is not loaded: ${name}`);
    const root=new TransformNode(`${name}-${++this.sequence}`,this.scene);
    root.position.set(...at);root.scaling.set(...(typeof scale==='number'?[scale,scale,scale] as XYZ:scale));root.rotation.y=angle;
    const instance=container.instantiateModelsToScene(n=>`${root.name}/${n}`,false,{doNotInstantiate:false});
    for(const node of instance.rootNodes)node.parent=root;
    for(const mesh of root.getChildMeshes()){mesh.receiveShadows=true;mesh.isPickable=false;if(mesh.getTotalVertices())this.shadows.addShadowCaster(mesh);}
    return root;
  }
}
