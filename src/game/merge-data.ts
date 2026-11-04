import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';

/** Native merge preserves its input array type. Use packed GPU-width data
 * instead of retaining large JS number arrays or copying every source buffer.
 * Call merge with forceCloneIndices=true when sources are shared templates. */
export function extractMergeData(mesh: Mesh) {
  const data = VertexData.ExtractFromMesh(mesh);
  for (const kind of mesh.getVerticesDataKinds()) {
    const values = mesh.getVerticesData(kind);
    if (Array.isArray(values)) data.set(new Float32Array(values), kind);
  }
  if (Array.isArray(data.indices)) data.indices = new Uint32Array(data.indices);
  return data;
}
