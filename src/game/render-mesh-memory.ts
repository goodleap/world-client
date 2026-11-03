import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';

/** Babylon 9.32's skinned Mesh.clone refreshes bounds and caches a Vector3
 * per vertex for picking. Render-only actors use separate picking volumes.
 * Rebinding the SAME native Geometry invalidates that cache without dropping
 * vertex buffers, skin weights, context-restoration data or shared geometry.
 * Keep the computed posed bounds, rather than reverting to the bind pose. */
export function releaseRenderPickingCache(mesh: AbstractMesh) {
  if (!(mesh instanceof Mesh) || !mesh.geometry || !mesh.skeleton) return;
  const geometry = mesh.geometry, box = mesh.getBoundingInfo().boundingBox;
  const bounds = new BoundingInfo(box.minimum.clone(), box.maximum.clone());
  geometry.releaseForMesh(mesh);
  geometry.applyToMesh(mesh);
  mesh.setBoundingInfo(bounds);
  mesh.isPickable = false;
}

export function prepareRenderTemplates(meshes: readonly AbstractMesh[]) {
  for (const mesh of meshes) {
    releaseRenderPickingCache(mesh);
    // Release each clone immediately, before the rest of an actor is cloned.
    mesh.onClonedObservable.add(clone => { if (clone instanceof Mesh) releaseRenderPickingCache(clone); });
  }
}
