import '@babylonjs/core/Culling/Octrees/octreeSceneComponent.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

/** Babylon owns spatial selection and LOD. Only immutable world geometry goes
 * in the tree; rigs, doors, pooled objects and mutable thin-instance bounds
 * stay in dynamicContent. LOD proxies never need an independent candidate. */
export function createSceneCandidates(scene: Scene) {
  const tree = scene.createOrUpdateSelectionOctree(32, 4);
  let dirty = true, candidates = 0, staticCount = 0, rebuilds = 0, knownCount = -1;
  const changed = () => { dirty = true; };
  const added = scene.onNewMeshAddedObservable.add(changed);
  const removed = scene.onMeshRemovedObservable.add(changed);
  const nativeCandidates = scene.getActiveMeshCandidates.bind(scene);
  scene.getActiveMeshCandidates = () => {
    const result = nativeCandidates(); candidates = result.length; return result;
  };
  function refresh() {
    // Babylon defers onNewMeshAdded until a later task. Same-frame construction
    // must already be visible to the next render.
    if (!dirty && knownCount === scene.meshes.length) return;
    const fixed: AbstractMesh[] = [], moving: AbstractMesh[] = [];
    for (const mesh of scene.meshes) {
      if (mesh.isBlocked || mesh.isDisposed()) continue;
      // Hidden templates must remain available to Babylon's instance batches.
      const immutable = mesh.isWorldMatrixFrozen && !mesh.skeleton && !mesh.morphTargetManager
        && mesh.isVisible && !mesh.alwaysSelectAsActiveMesh && !(mesh as Mesh).hasThinInstances;
      (immutable ? fixed : moving).push(mesh);
    }
    const bounds = Mesh.MinMax(fixed.length ? fixed : moving);
    tree.update(bounds.min.subtractFromFloats(1, 1, 1), bounds.max.subtractFromFloats(-1, -1, -1), fixed);
    tree.dynamicContent = moving;
    staticCount = fixed.length; knownCount = scene.meshes.length; rebuilds++; dirty = false;
  }
  const before = scene.onBeforeRenderObservable.add(refresh);
  refresh();
  return {
    refresh: changed,
    snapshot: () => ({ candidates, static: staticCount, dynamic: tree.dynamicContent.length, rebuilds }),
    dispose() {
      scene.onNewMeshAddedObservable.remove(added); scene.onMeshRemovedObservable.remove(removed);
      scene.onBeforeRenderObservable.remove(before);
    },
  };
}
