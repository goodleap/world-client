import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';

/** Keep heavy static material batches local enough for Babylon's ordinary
 * bounding-box/frustum culling. No per-frame visibility controller is needed. */
export function spatialBatches(meshes: readonly Mesh[], cellSize = 8): Map<string, Mesh[]> {
  const cells = new Map<string, Mesh[]>();
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const center = mesh.getBoundingInfo().boundingBox.centerWorld;
    const key = `${Math.floor(center.x / cellSize)},${Math.floor(center.z / cellSize)}`;
    const cell = cells.get(key) ?? [];
    cell.push(mesh); cells.set(key, cell);
  }
  return cells;
}
