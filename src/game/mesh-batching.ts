import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

/** Join compatible GLB parts in their existing bind space. Keep every vertex,
 * normal, color and skin weight; never bake a posed/world transform into a rig. */
export function batchSkinnedMeshes(meshes: readonly AbstractMesh[]): AbstractMesh[] {
  const animationTargets = new Set(meshes[0]?.getScene().animationGroups.flatMap(group => group.targetedAnimations.map(entry => entry.target)));
  const groups = new Map<string, Mesh[]>();
  for (const mesh of meshes) {
    if (!(mesh instanceof Mesh) || !mesh.skeleton || mesh.skeleton.needInitialSkinMatrix ||
      !mesh.material || mesh.material.needAlphaBlendingForMesh(mesh) || mesh.morphTargetManager ||
      mesh.animations.length || animationTargets.has(mesh) || mesh.getChildren().length || mesh.subMeshes?.length !== 1 ||
      !mesh.position.equalsToFloats(0, 0, 0) || !mesh.scaling.equalsToFloats(1, 1, 1) ||
      !mesh.rotation.equalsToFloats(0, 0, 0) || (mesh.rotationQuaternion && !mesh.rotationQuaternion.equalsToFloats(0, 0, 0, 1)) ||
      !mesh.getPivotMatrix().isIdentity()) continue;
    const key = [mesh.parent?.uniqueId, mesh.skeleton.uniqueId, mesh.material.uniqueId,
      mesh.sideOrientation, mesh.numBoneInfluencers, mesh.computeBonesUsingShaders,
      mesh.useVertexColors, mesh.hasVertexAlpha, mesh.visibility, mesh.isVisible, mesh.isEnabled(), mesh.renderingGroupId,
      mesh.getVerticesDataKinds().sort().join(',')].join('|');
    const group = groups.get(key) ?? []; group.push(mesh); groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group;
    const data = VertexData.ExtractFromMesh(first, true, true);
    data.merge(rest.map(mesh => VertexData.ExtractFromMesh(mesh, true, true)), true);
    first.makeGeometryUnique();
    data.applyToMesh(first);
    first.metadata = { ...first.metadata, batchedParts: group.map(mesh => mesh.name) };
    for (const mesh of rest) mesh.dispose(false, false);
  }
  return meshes.filter(mesh => !mesh.isDisposed());
}
