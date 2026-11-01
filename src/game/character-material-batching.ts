import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Geometry } from '@babylonjs/core/Meshes/geometry.js';

/** Preserve the PBR response; only move its constant linear albedo multiplier
 * into vertex colors. Native skinning/batching/LOD continue to own geometry.
 * Run on immutable library templates, before actor cloning and material freezes. */
export function batchCharacterMaterials(meshes: readonly AbstractMesh[]) {
  const groups = new Map<string, Set<PBRMaterial>>();
  for (const mesh of meshes) {
    const m = mesh.material;
    if (!(m instanceof PBRMaterial) || m.alpha !== 1 || m.getActiveTextures().length || m.animations?.length) continue;
    const data = m.serialize();
    for (const key of ['name', 'id', 'uniqueId', 'tags', 'metadata', 'albedo']) delete data[key];
    const key = JSON.stringify(data);
    const group = groups.get(key) ?? new Set<PBRMaterial>(); group.add(m); groups.set(key, group);
  }
  const replacements = new Map<PBRMaterial, PBRMaterial>();
  let index = 0;
  for (const group of groups.values()) {
    if (group.size < 2) continue;
    const shared = [...group][0].clone(`shared-character-solid-${index++}`)!;
    shared.albedoColor = Color3.White();
    for (const m of group) replacements.set(m, shared);
  }
  const geometries = new Map<string, Geometry>();
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || !mesh.geometry || !(mesh.material instanceof PBRMaterial)) continue;
    const original = mesh.material, material = replacements.get(original);
    if (!material) continue;
    const color = original.albedoColor;
    const key = `${mesh.geometry.uniqueId}:${color.r},${color.g},${color.b}`;
    const cached = geometries.get(key);
    if (cached) cached.applyToMesh(mesh);
    else {
      const existing = mesh.getVerticesData(VertexBuffer.ColorKind);
      const stride = mesh.getVertexBuffer(VertexBuffer.ColorKind)?.getSize() ?? 4;
      const values = new Float32Array(mesh.getTotalVertices() * 4);
      for (let i = 0; i < mesh.getTotalVertices(); i++) {
        values[i * 4] = (existing?.[i * stride] ?? 1) * color.r;
        values[i * 4 + 1] = (existing?.[i * stride + 1] ?? 1) * color.g;
        values[i * 4 + 2] = (existing?.[i * stride + 2] ?? 1) * color.b;
        values[i * 4 + 3] = stride === 4 ? existing?.[i * stride + 3] ?? 1 : 1;
      }
      // Most role parts already share the same geometry and color. Add one
      // color buffer in place instead of duplicating positions/normals/skin
      // buffers for every template. Split only a genuinely different color.
      const sameColor = mesh.geometry.meshes.every(user => user.material instanceof PBRMaterial
        && replacements.has(user.material) && user.material.albedoColor.equals(color));
      if (!sameColor) mesh.makeGeometryUnique();
      mesh.setVerticesData(VertexBuffer.ColorKind, values, false, 4);
      geometries.set(key, mesh.geometry!);
    }
    mesh.material = material; mesh.useVertexColors = true;
  }
  return { materialGroups: index, replacedMaterials: replacements.size };
}
