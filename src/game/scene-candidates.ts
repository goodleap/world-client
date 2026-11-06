import '@babylonjs/core/Culling/Octrees/octreeSceneComponent.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

/** Babylon owns spatial selection and LOD. Only immutable world geometry goes
 * in the tree; rigs, doors, pooled objects and mutable thin-instance bounds
 * stay in dynamicContent. LOD proxies never need an independent candidate. */
export function createSceneCandidates(scene: Scene) {
  const tree = scene.createOrUpdateSelectionOctree(32, 4);
  let reconcile = true, staticDirty = true, dynamicDirty = true, candidates = 0, rebuilds = 0;
  let lastRebuildMs=0,maxRebuildMs=0,totalRebuildMs=0;
  let incrementalAdds=0,incrementalRemoves=0;
  let worldMin=Vector3.Zero(),worldMax=Vector3.Zero();
  const reasons={initial:0,explicit:0,staticAdded:0,staticRemoved:0,imported:0};
  let explicit=false;
  const known = new Set<AbstractMesh>(), fixed = new Set<AbstractMesh>(), moving = new Set<AbstractMesh>();
  const pending = new Set<AbstractMesh>(), imported = new Set<AbstractMesh>();
  const changed = () => { reconcile = true; staticDirty = true; explicit=true; };
  const added = scene.onNewMeshAddedObservable.add(mesh => pending.add(mesh));
  // Babylon inserts imported meshes into its tree automatically. Reclassify
  // those entries as well, so animated imports never retain static bounds.
  const loaded = scene.onMeshImportedObservable.add(mesh => { pending.add(mesh); imported.add(mesh); });
  const removed = scene.onMeshRemovedObservable.add(mesh => {
    known.delete(mesh); pending.delete(mesh);
    if (imported.delete(mesh)) tree.removeMesh(mesh);
    if (fixed.delete(mesh)){tree.removeMesh(mesh);incrementalRemoves++;reasons.staticRemoved++;}
    if (moving.delete(mesh)) dynamicDirty = true;
  });
  const nativeCandidates = scene.getActiveMeshCandidates.bind(scene);
  scene.getActiveMeshCandidates = () => {
    const result = nativeCandidates(); candidates = result.length; return result;
  };
  function refresh() {
    // Babylon defers onNewMeshAdded until a later task. Same-frame construction
    // must already be visible to the next render.
    if (reconcile || known.size !== scene.meshes.length) {
      for (const mesh of scene.meshes) if (reconcile || !known.has(mesh)) { known.add(mesh); pending.add(mesh); }
      reconcile = false;
    }
    for (const mesh of pending) {
      if (imported.has(mesh)) { tree.removeMesh(mesh); if (fixed.delete(mesh)) reasons.imported++; }
      if (!known.has(mesh)) continue; // A deferred add can arrive after removal.
      const eligible = !mesh.isBlocked && !mesh.isDisposed();
      // Hidden templates must remain available to Babylon's instance batches.
      const immutable = eligible && mesh.isWorldMatrixFrozen && !mesh.skeleton && !mesh.morphTargetManager
        && mesh.isVisible && !mesh.alwaysSelectAsActiveMesh && !(mesh as Mesh).hasThinInstances;
      if (immutable !== fixed.has(mesh)) {
        if (immutable) {
          fixed.add(mesh);reasons.staticAdded++;
          const box=mesh.getBoundingInfo().boundingBox;
          // Loot, crops and construction normally fit the existing world.
          // Babylon can insert them directly; only expanding the world bounds
          // or explicit reclassification requires rebuilding the whole tree.
          if (box.minimumWorld.x<worldMin.x||box.minimumWorld.y<worldMin.y||box.minimumWorld.z<worldMin.z
            ||box.maximumWorld.x>worldMax.x||box.maximumWorld.y>worldMax.y||box.maximumWorld.z>worldMax.z) staticDirty=true;
          else if (!staticDirty) { tree.addMesh(mesh);incrementalAdds++; }
        } else {
          fixed.delete(mesh);tree.removeMesh(mesh);incrementalRemoves++;reasons.staticRemoved++;
        }
      }
      const dynamic = eligible && !immutable;
      if (dynamic !== moving.has(mesh)) { if (dynamic) moving.add(mesh); else moving.delete(mesh); dynamicDirty = true; }
    }
    pending.clear(); imported.clear();
    if (staticDirty) {
      const started=performance.now();if(!rebuilds)reasons.initial++;if(explicit){reasons.explicit++;explicit=false;}
      const entries = [...fixed];
      const bounds = entries.length ? Mesh.MinMax(entries) : { min:Vector3.Zero(), max:Vector3.Zero() };
      worldMin=bounds.min.subtractFromFloats(1,1,1);worldMax=bounds.max.subtractFromFloats(-1,-1,-1);
      tree.update(worldMin,worldMax,entries);
      rebuilds++; staticDirty = false;lastRebuildMs=performance.now()-started;totalRebuildMs+=lastRebuildMs;maxRebuildMs=Math.max(maxRebuildMs,lastRebuildMs);
    }
    if (dynamicDirty) { tree.dynamicContent = [...moving]; dynamicDirty = false; }
  }
  const before = scene.onBeforeRenderObservable.add(refresh);
  refresh();
  return {
    refresh: changed,
    snapshot: () => ({ candidates, static: fixed.size, dynamic: tree.dynamicContent.length, rebuilds, incrementalAdds, incrementalRemoves, lastRebuildMs, maxRebuildMs, totalRebuildMs, reasons:{...reasons} }),
    dispose() {
      scene.onNewMeshAddedObservable.remove(added); scene.onMeshRemovedObservable.remove(removed);
      scene.onMeshImportedObservable.remove(loaded);
      scene.onBeforeRenderObservable.remove(before);
      scene.getActiveMeshCandidates = nativeCandidates;
      known.clear(); fixed.clear(); moving.clear(); pending.clear(); imported.clear();
    },
  };
}
