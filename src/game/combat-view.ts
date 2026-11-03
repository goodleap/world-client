import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion,Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { CombatState } from './combat.ts';
import { arrowFlight } from './arrow-flight.ts';

/** One shared, vertex-colored arrow, with native instances for live shots. */
export function createCombatView(scene:Scene){
  const material=new StandardMaterial('arrow-ink',scene);material.diffuseColor=Color3.White();material.specularColor=Color3.Black();
  const shaft=MeshBuilder.CreateCylinder('arrow-shaft',{height:.8,diameter:.072,tessellation:6},scene);
  const head=MeshBuilder.CreateCylinder('arrow-head',{height:.22,diameterTop:0,diameterBottom:.18,tessellation:4},scene);head.position.y=.49;
  const feathers=[0,Math.PI/2].map(angle=>{const m=MeshBuilder.CreateBox('arrow-feather',{width:.22,height:.23,depth:.035},scene);m.position.y=-.29;m.rotation.y=angle;return m;});
  for(const [i,m] of [shaft,head,...feathers].entries()){
    m.material=material;m.isPickable=false;
    const c=Color3.FromHexString(i===0?'#b08c4c':i===1?'#dce1dc':'#f4e9bf');
    m.setVerticesData(VertexBuffer.ColorKind,Array.from({length:m.getTotalVertices()},()=>[c.r,c.g,c.b,1]).flat());
  }
  const source=Mesh.MergeMeshes([shaft,head,...feathers],true,true)!;source.name='arrow-template';source.isVisible=false;
  const arrows=new Map<number,InstancedMesh>(),direction=new Vector3();
  return {update(state:CombatState,visualLag=0){
    for(const [id,mesh]of arrows)if(!state.projectiles.some(p=>p.id===id)){mesh.dispose();arrows.delete(id);}
    for(const p of state.projectiles){
      let mesh=arrows.get(p.id);
      if(!mesh){mesh=source.createInstance('combat-arrow');mesh.isVisible=true;mesh.isPickable=false;mesh.rotationQuaternion=Quaternion.Identity();arrows.set(p.id,mesh);}
      const pose=arrowFlight(p,visualLag);mesh.position.set(pose.position.x,pose.position.y,pose.position.z);
      direction.set(pose.tangent.x,pose.tangent.y,pose.tangent.z).normalize();
      Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly,direction,mesh.rotationQuaternion!);
      mesh.computeWorldMatrix();
    }
  }};
}
