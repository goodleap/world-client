import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Skeleton } from '@babylonjs/core/Bones/skeleton.js';
import { Bone } from '@babylonjs/core/Bones/bone.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import '@babylonjs/core/Culling/ray.js';
import { prepareRenderTemplates } from '../src/game/render-mesh-memory.ts';
import { createResidentPicking, createBuildingPicking, createWolfPicking } from '../src/game/picking-shapes.ts';
import { isWorldPickable } from '../src/game/world-selection.ts';

test('render clones retain shared geometry, posed bounds and skinning without per-vertex picking caches',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const mesh=MeshBuilder.CreateBox('body',{size:2},scene),rig=new Skeleton('rig','rig',scene);
    new Bone('body',rig,null,Matrix.Identity());mesh.skeleton=rig;mesh.numBoneInfluencers=1;
    mesh.setVerticesData(VertexBuffer.MatricesIndicesKind,new Float32Array(mesh.getTotalVertices()*4));
    const weights=new Float32Array(mesh.getTotalVertices()*4);for(let i=0;i<weights.length;i+=4)weights[i]=1;
    mesh.setVerticesData(VertexBuffer.MatricesWeightsKind,weights);rig.prepare(true);
    mesh.refreshBoundingInfo(true,true);assert(mesh._positions?.length);
    const positions=Array.from(mesh.getPositionData(true)!),box=mesh.getBoundingInfo().boundingBox;
    const min=box.minimum.clone(),max=box.maximum.clone();prepareRenderTemplates([mesh]);
    const clones=Array.from({length:10},(_,i)=>mesh.clone('actor'+i,null,true)!);
    for(const copy of clones){
      assert.equal(copy.geometry,mesh.geometry);assert.equal(copy._positions,null);
      assert.deepEqual(Array.from(copy.getPositionData(true)!),positions);
      assert(copy.getBoundingInfo().boundingBox.minimum.equals(min));assert(copy.getBoundingInfo().boundingBox.maximum.equals(max));
    }
    clones[0].dispose();assert.equal(mesh.getTotalVertices(),24);assert.equal(clones[1].getTotalVertices(),24);
  }finally{scene.dispose();engine.dispose();}
});

test('wolf body is picked through its native cylinder without enabling the render mesh',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const root=new TransformNode('wolf',scene),hit=createWolfPicking(scene,root,'wolf-wild-0');
    root.position.set(3,0,4);root.rotation.y=1.2;hit.computeWorldMatrix(true);
    const ray=new Ray(new Vector3(3,.8,0),new Vector3(0,0,1));
    assert.equal(scene.pickWithRay(ray,isWorldPickable)?.pickedMesh?.metadata.id,'wolf-wild-0');
    hit.metadata.id='wolf-2-0';assert.equal(scene.pickWithRay(ray,isWorldPickable)?.pickedMesh?.metadata.id,'wolf-2-0');
    hit.isPickable=false;assert(!scene.pickWithRay(ray,isWorldPickable)?.hit);
    hit.isPickable=true;root.setEnabled(false);assert(!scene.pickWithRay(ray,isWorldPickable)?.hit);
  }finally{scene.dispose();engine.dispose();}
});

test('cylindrical hit width stays constant at head/feet and ignores visual-root scale; building hit uses fitted bounds',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const root=new TransformNode('infantry',scene);root.scaling.set(1.07,1.06,1.04);
    const hit=createResidentPicking(scene,root,'infantry','infantry');hit.computeWorldMatrix(true);
    for(const y of [.05,2.25])assert.equal(scene.pickWithRay(new Ray(new Vector3(.7,y,-4),new Vector3(0,0,1)),isWorldPickable)?.pickedMesh,hit);
    assert(!scene.pickWithRay(new Ray(new Vector3(.9,1,-4),new Vector3(0,0,1)),isWorldPickable)?.hit);
    const house=MeshBuilder.CreateBox('house',{width:3,height:4,depth:2},scene);house.position.set(6,2,0);
    const proxy=createBuildingPicking(scene,'house',[house])!;proxy.computeWorldMatrix(true);
    assert.equal(house.isPickable,false);assert.equal(proxy.visibility,0);
    assert.equal(scene.pickWithRay(new Ray(new Vector3(6,3,-6),new Vector3(0,0,1)),isWorldPickable)?.pickedMesh,proxy);
  }finally{scene.dispose();engine.dispose();}
});
