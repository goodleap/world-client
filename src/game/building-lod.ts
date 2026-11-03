import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { BuildingDetail } from './buildings.ts';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';

/** Count what the main camera actually chose, once per diagnostic sample. */
export function buildingLODCounts(scene: Scene) {
  const counts = { near: 0, medium: 0, far: 0 }, camera = scene.activeCamera;
  if (!camera) return counts;
  const active = scene.getActiveMeshes();
  for (let i = 0; i < active.length; i++) {
    const mesh = active.data[i], source = mesh instanceof InstancedMesh ? mesh.sourceMesh : mesh;
    if (!source.metadata?.buildingLODSource) continue;
    const level = mesh.getLOD(camera)?.metadata?.buildingLOD;
    counts[level === 'far' ? 'far' : level === 'map' ? 'medium' : 'near']++;
  }
  return counts;
}

/** Reduce subdivisions, not the building's tile/window/flower arrangement.
 * Native per-material LOD keeps the original pick mesh and caster membership.
 * The same templates also work for subsequently built native instances. */
export function attachBuildingLOD(scene: Scene, sources: readonly Mesh[], build: (detail: BuildingDetail) => void) {
  const levels = (['map', 'far'] as const).map(detail => {
    const first = scene.meshes.length; build(detail);
    const groups = new Map<Mesh['material'], Mesh[]>();
    for (const mesh of scene.meshes.slice(first)) if (mesh instanceof Mesh && mesh.material && mesh.getTotalVertices()) {
      if (!mesh.isVerticesDataPresent(VertexBuffer.ColorKind)) mesh.setVerticesData(VertexBuffer.ColorKind, new Float32Array(mesh.getTotalVertices() * 4).fill(1));
      if (!mesh.isVerticesDataPresent(VertexBuffer.UVKind)) mesh.setVerticesData(VertexBuffer.UVKind, new Float32Array(mesh.getTotalVertices() * 2));
      const group = groups.get(mesh.material) ?? []; group.push(mesh); groups.set(mesh.material, group);
    }
    return new Map([...groups].map(([material, parts]) => {
      for (const mesh of parts) mesh.computeWorldMatrix(true);
      const merged = parts.length === 1 ? parts[0] : Mesh.MergeMeshes(parts, true, true)!;
      merged.bakeCurrentTransformIntoVertices();
      return [material, merged];
    }));
  });
  for (const source of sources) {
    source.computeWorldMatrix(true);
    const radius = source.getBoundingInfo().boundingSphere.radiusWorld;
    const inverse = Matrix.Invert(source.getWorldMatrix());
    source.useLODScreenCoverage = true;
    source.metadata = { ...source.metadata, buildingLODSource: true };
    source._instanceDataStorage.useMonoDataStorageRenderPass = false;
    for (const [i, level] of levels.entries()) {
      const mesh = level.get(source.material);
      if (!mesh) continue;
      mesh.bakeTransformIntoVertices(inverse);
      mesh.name = `${source.name}-building-${i ? 'far' : 'map'}`;
      mesh.metadata = { worldObjectId: source.metadata?.worldObjectId, buildingLOD: i ? 'far' : 'map' };
      mesh.isPickable = false; mesh.receiveShadows = source.receiveShadows;
      mesh.isVisible = source.isVisible;
      mesh._instanceDataStorage.useMonoDataStorageRenderPass = false;
      // Main map: two bevel steps. Wide map/shadow view: one. Close-up: original.
      source.addLODLevel(Math.PI * radius * radius / (i ? 650 : 180), mesh);
      source.onDisposeObservable.addOnce(() => mesh.dispose());
      level.delete(source.material);
    }
  }
  for (const level of levels) for (const orphan of level.values()) orphan.dispose();
}
