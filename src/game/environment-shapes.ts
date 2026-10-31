import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';

export type XYZ = [number, number, number];

/** Rounded surfaces with analytic normals, including the silhouette of each edge. */
export function roundedBox(scene: Scene, name: string, size: XYZ, at: XYZ, material: StandardMaterial, radius = 0.1) {
  const half = size.map(n => n / 2), r = Math.min(radius, ...half);
  const positions: number[] = [], normals: number[] = [], indices: number[] = [], uvs: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    // The middle of a straight span adds no shape or normal detail. Keep all
    // original bevel samples; remove that split and coincident thin-box rows.
    const samples = (h: number) => [...new Set([-h, -h + r * 0.134, -h + r * 0.5, -h + r, h - r, h - r * 0.5, h - r * 0.134, h])];
    const us = samples(half[u]), vs = samples(half[v]);
    for (const sign of [-1, 1]) {
      const start = positions.length / 3;
      for (const y of vs) for (const x of us) {
        const p = [0, 0, 0]; p[axis] = sign * half[axis]; p[u] = x; p[v] = y;
        const inner = p.map((n, a) => Math.max(-half[a] + r, Math.min(half[a] - r, n)));
        const n = new Vector3(p[0] - inner[0], p[1] - inner[1], p[2] - inner[2]).normalize();
        positions.push(inner[0] + n.x * r, inner[1] + n.y * r, inner[2] + n.z * r);
        normals.push(n.x, n.y, n.z); uvs.push(x / size[u] + 0.5, y / size[v] + 0.5);
      }
      for (let y = 0; y < vs.length - 1; y++) for (let x = 0; x < us.length - 1; x++) {
        const a = start + y * us.length + x, b = a + 1, c = a + us.length, d = c + 1;
        indices.push(...(sign > 0 ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
      }
    }
  }
  const data = new VertexData(); data.positions = positions; data.normals = normals; data.indices = indices; data.uvs = uvs;
  const mesh = new Mesh(name, scene); data.applyToMesh(mesh); mesh.position.set(...at); mesh.material = material;
  return mesh;
}

export function ellipsoid(scene: Scene, name: string, size: XYZ, at: XYZ, material: StandardMaterial, segments = 16) {
  const mesh = MeshBuilder.CreateSphere(name, { diameter: 1, segments }, scene);
  mesh.scaling.set(...size); mesh.position.set(...at); mesh.material = material;
  return mesh;
}

/** Subtle colored shading is part of the asset; it is not a global screen filter. */
export function tintHeight(mesh: Mesh, low: string, high: string) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  let min = Infinity, max = -Infinity;
  for (let i = 1; i < positions.length; i += 3) { min = Math.min(min, positions[i]); max = Math.max(max, positions[i]); }
  const a = Color3.FromHexString(low), b = Color3.FromHexString(high), colors: number[] = [];
  for (let i = 1; i < positions.length; i += 3) {
    const color = Color3.Lerp(a, b, (positions[i] - min) / Math.max(.001, max - min));
    colors.push(color.r, color.g, color.b, 1);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}
