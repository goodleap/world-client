import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { ResidentRole } from './resident-data.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';

/** World-space click volumes, independent of navigation and combat reach. */
export const RESIDENT_PICKING = {
  farmer: { diameter: 1.4, height: 2 },
  infantry: { diameter: 1.6, height: 2.3 },
  archer: { diameter: 1.5, height: 2.2 },
  cavalry: { diameter: 1.8, height: 2.8 },
  dog: { diameter: 1.3, height: 1.2 },
} satisfies Record<ResidentRole, { diameter: number; height: number }>;

export function createResidentPicking(scene: Scene, root: TransformNode, id: string, role: ResidentRole) {
  const { diameter, height } = RESIDENT_PICKING[role];
  const hit = MeshBuilder.CreateCylinder(`${id}-hit`, { diameter, height, tessellation: 16 }, scene);
  hit.parent = root;
  // Role styling scales the visual root; selection sizes stay in world units.
  hit.scaling.set(1 / root.scaling.x, 1 / root.scaling.y, 1 / root.scaling.z);
  hit.position.y = height / 2 / root.scaling.y;
  hit.visibility = 0;
  hit.metadata = { selectionKind: 'resident', id, pickingShape: 'cylinder', diameter, height };
  return hit;
}

/** Compute once after model assembly; no per-frame geometry/bone scans. */
export function createBuildingPicking(scene: Scene, id: string, meshes: readonly AbstractMesh[]) {
  const bounds = meshes.filter(m=>m.getTotalVertices()).map(mesh=>{
    mesh.computeWorldMatrix(true);mesh.isPickable=false;return mesh.getBoundingInfo().boundingBox;
  });
  if (!bounds.length) return;
  const minX=Math.min(...bounds.map(b=>b.minimumWorld.x)),maxX=Math.max(...bounds.map(b=>b.maximumWorld.x));
  const minY=Math.min(...bounds.map(b=>b.minimumWorld.y)),maxY=Math.max(...bounds.map(b=>b.maximumWorld.y));
  const minZ=Math.min(...bounds.map(b=>b.minimumWorld.z)),maxZ=Math.max(...bounds.map(b=>b.maximumWorld.z));
  const hit=MeshBuilder.CreateBox(`${id}-building-hit`,{width:maxX-minX,height:Math.max(.08,maxY-minY),depth:maxZ-minZ},scene);
  hit.position.set((minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2);
  hit.visibility=0;hit.metadata={worldObjectId:id,pickingProxy:true,pickingShape:'box'};hit.freezeWorldMatrix();return hit;
}

export function createFirePicking(scene: Scene, root: TransformNode, id: string, radius: number) {
  const hit=MeshBuilder.CreateCylinder(`${id}-fire-hit`,{diameter:radius*2,height:1.6,tessellation:16},scene);
  hit.parent=root;hit.position.y=.8;hit.visibility=0;
  hit.metadata={worldObjectId:id,pickingProxy:true,pickingShape:'cylinder'};return hit;
}
