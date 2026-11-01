import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Bone } from '@babylonjs/core/Bones/bone.js';

export type RigEnvelope = { root: TransformNode; radius: number };

/** A conservative bound for every authored pose, not just the bind pose.
 * Bound each weighted vertex in joint space, then apply triangle inequalities
 * through the joint and model chains. Arbitrary rotations remain inside it.
 * Unknown animation targets/interpolation fall back to uncullable skinning. */
export function rigEnvelope(meshes: readonly AbstractMesh[], root: TransformNode): RigEnvelope | undefined {
  const tracks = new Map<object, { position: number; scale: number }>();
  const scale = Vector3.One(), position = Vector3.Zero(), rotation = Quaternion.Identity(), vertex = Vector3.Zero();
  if (root.getScene().animationGroups.some(group => group.isAdditive)) return;
  for (const group of root.getScene().animationGroups) for (const { target, animation } of group.targetedAnimations) {
    if (animation.targetProperty.startsWith('position.') || animation.targetProperty.startsWith('scaling.')) return;
    if (!['position', 'scaling', 'rotationQuaternion'].includes(animation.targetProperty)) continue;
    const values = tracks.get(target) ?? { position: 0, scale: 1 };
    for (const key of animation.getKeys()) {
      if (key.inTangent || key.outTangent) return; // Cubic overshoot needs its own bound.
      if (animation.targetProperty === 'position') values.position = Math.max(values.position, key.value.length());
      if (animation.targetProperty === 'scaling') values.scale = Math.max(values.scale, Math.abs(key.value.x), Math.abs(key.value.y), Math.abs(key.value.z));
    }
    tracks.set(target, values);
  }
  const coefficients = new Map<Bone, { offset: number; scale: number }>();
  function boneBound(bone: Bone): { offset: number; scale: number } {
    const cached = coefficients.get(bone); if (cached) return cached;
    bone.getRestMatrix().decompose(scale, rotation, position);
    const track = tracks.get(bone.getTransformNode()!);
    const s = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z), track?.scale ?? 1);
    const t = Math.max(position.length(), track?.position ?? 0);
    const parent = bone.getParent(), p = parent ? boneBound(parent) : { offset: 0, scale: 1 };
    const value = { offset: p.offset + p.scale * t, scale: p.scale * s };
    coefficients.set(bone, value); return value;
  }
  let radius = 0;
  for (const mesh of meshes) {
    const rig = mesh.skeleton; if (!rig) continue;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind), indices = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind), weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
    if (!positions || !indices || !weights || mesh.numBoneInfluencers > 4 || rig.needInitialSkinMatrix || mesh.morphTargetManager) return;
    const indexedBones = new Map(rig.bones.map((bone, index) => [bone.getIndex() ?? index, bone]));
    let localRadius = 0;
    for (let i = 0; i < positions.length / 3; i++) for (let j = 0; j < 4; j++) {
      if (weights[i * 4 + j] <= 0) continue;
      const bone = indexedBones.get(indices[i * 4 + j]); if (!bone) return;
      Vector3.TransformCoordinatesFromFloatsToRef(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], bone.getAbsoluteInverseBindMatrix(), vertex);
      const c = boneBound(bone); localRadius = Math.max(localRadius, c.offset + c.scale * vertex.length());
    }
    let node: TransformNode | null = mesh;
    while (node && node !== root) {
      const track = tracks.get(node);
      localRadius = Math.max(node.position.length(), track?.position ?? 0)
        + Math.max(Math.abs(node.scaling.x), Math.abs(node.scaling.y), Math.abs(node.scaling.z), track?.scale ?? 1) * localRadius;
      node = node.parent as TransformNode | null;
    }
    if (node !== root || !Number.isFinite(localRadius)) return;
    radius = Math.max(radius, localRadius);
  }
  return radius > 0 ? { root, radius: radius + .25 } : undefined;
}
