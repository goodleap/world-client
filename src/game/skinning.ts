import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Bone } from '@babylonjs/core/Bones/bone';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

/** Rigid weights retain crisp low-poly joints while using real GPU skinning. */
export function createSkinAssembly() {
  const parts: Mesh[] = [];
  return {
    add(mesh: Mesh, bone: Bone) {
      mesh.bakeCurrentTransformIntoVertices();
      const indices: number[] = [], weights: number[] = [];
      for (let i = 0; i < mesh.getTotalVertices(); i++) {
        indices.push(bone.getIndex(), 0, 0, 0); weights.push(1, 0, 0, 0);
      }
      mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, indices, false, 4);
      mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, weights, false, 4);
      parts.push(mesh);
    },
    finish(name: string, root: TransformNode, skeleton: Skeleton, shadows: ShadowGenerator) {
      const partNames = parts.map((part) => part.name);
      const groups = new Map<Mesh['material'], Mesh[]>();
      for (const part of parts) {
        const group = groups.get(part.material) ?? [];
        group.push(part); groups.set(part.material, group);
      }
      const batched = [...groups.values()].map((group) => Mesh.MergeMeshes(group, true, true)!);
      const mesh = Mesh.MergeMeshes(batched, true, true, undefined, false, true);
      if (!mesh) throw new Error(`Cannot assemble ${name}.`);
      mesh.name = name; mesh.parent = root; mesh.skeleton = skeleton;
      mesh.numBoneInfluencers = 1; mesh.isPickable = false;
      // Cast ground shadows while keeping small faces readable with scene-light shading.
      mesh.alwaysSelectAsActiveMesh = true; mesh.receiveShadows = false;
      shadows.addShadowCaster(mesh);
      return { mesh, partNames };
    },
  };
}
