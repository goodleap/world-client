import type { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';

/** Procedural builders/native mesh merges may keep JS number arrays after
 * uploading float32 GPU buffers. Keep the same data in packed native buffers,
 * including the CPU copy Babylon needs for picking and context restoration. */
export function packGeometry(geometry: Geometry) {
  for (const [kind, buffer] of Object.entries(geometry.getVertexBuffers() ?? {})) {
    if (!Array.isArray(buffer.getData()) || buffer.getIsInstanced() || buffer.type !== VertexBuffer.FLOAT) continue;
    const values = geometry.getVerticesData(kind);
    if (values) geometry.setVerticesData(kind, new Float32Array(values), buffer.isUpdatable(), buffer.getSize());
  }
  const indices = geometry.getIndices();
  if (Array.isArray(indices)) geometry.setIndices(geometry.getTotalVertices() > 65536
    ? new Uint32Array(indices) : new Uint16Array(indices), null, false, true);
}
