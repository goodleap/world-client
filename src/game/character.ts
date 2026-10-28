import { Bone } from '@babylonjs/core/Bones/bone';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { cylinder, softBox, sphere } from './models.ts';
import type { Palette } from './models.ts';

export function createCharacter(scene: Scene, p: Palette, shadows: ShadowGenerator) {
  const root = new TransformNode('player', scene);
  const skeleton = new Skeleton('villager-rig', 'villager-rig', scene);
  const hips = new Bone('hips', skeleton, null, Matrix.Translation(0, 0.72, 0));
  const torso = new Bone('torso', skeleton, hips, Matrix.Translation(0, 0.25, 0));
  const head = new Bone('head', skeleton, torso, Matrix.Translation(0, 0.5, 0));
  const leftArm = new Bone('left-arm', skeleton, torso, Matrix.Translation(-0.32, 0.2, 0));
  const rightArm = new Bone('right-arm', skeleton, torso, Matrix.Translation(0.32, 0.2, 0));
  const leftLeg = new Bone('left-leg', skeleton, hips, Matrix.Translation(-0.16, -0.05, 0));
  const rightLeg = new Bone('right-leg', skeleton, hips, Matrix.Translation(0.16, -0.05, 0));
  // Rigid bone weights give clean low-poly articulation; joints and accessories share a real skin.
  const parts: Mesh[] = [];
  function skin(mesh: Mesh, bone: Bone) {
    mesh.bakeCurrentTransformIntoVertices();
    const indices: number[] = [], weights: number[] = [];
    for (let i = 0; i < mesh.getTotalVertices(); i++) {
      indices.push(bone.getIndex(), 0, 0, 0); weights.push(1, 0, 0, 0);
    }
    mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, indices, false, 4);
    mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, weights, false, 4);
    parts.push(mesh);
  }
  skin(softBox(scene, 'shirt', [0.57, 0.62, 0.4], [0, 1.03, 0], p.shirt, 0.1), torso);
  skin(softBox(scene, 'trousers', [0.51, 0.27, 0.36], [0, 0.71, 0], p.pants, 0.08), hips);
  skin(softBox(scene, 'face', [0.52, 0.52, 0.48], [0, 1.55, 0], p.skin, 0.13), head);
  skin(sphere(scene, 'hair', [0.59, 0.36, 0.55], [0, 1.78, -0.04], p.hair), head);
  skin(softBox(scene, 'back-hair', [0.51, 0.35, 0.18], [0, 1.57, -0.2], p.hair, 0.05), head);
  skin(cylinder(scene, 'hat-brim', 0.08, 0.97, 0.97, [0, 1.85, 0], p.linen, 12), head);
  skin(cylinder(scene, 'hat-crown', 0.27, 0.62, 0.49, [0, 1.98, 0], p.linen, 12), head);
  skin(cylinder(scene, 'hat-band', 0.08, 0.635, 0.61, [0, 1.89, 0], p.sage, 12), head);
  for (const side of [-1, 1]) {
    const arm = side < 0 ? leftArm : rightArm, leg = side < 0 ? leftLeg : rightLeg;
    skin(softBox(scene, 'sleeve', [0.22, 0.35, 0.25], [side * 0.34, 1.03, 0], p.shirt, 0.06), arm);
    skin(softBox(scene, 'hand', [0.18, 0.21, 0.2], [side * 0.35, 0.78, 0.02], p.skin, 0.06), arm);
    skin(softBox(scene, 'leg', [0.22, 0.45, 0.25], [side * 0.16, 0.43, 0], p.pants, 0.05), leg);
    skin(softBox(scene, 'boot', [0.25, 0.19, 0.38], [side * 0.16, 0.13, 0.05], p.boot, 0.06), leg);
    skin(sphere(scene, 'eye', [0.045, 0.06, 0.035], [side * 0.105, 1.58, 0.247], p.woodDark), head);
    skin(sphere(scene, 'ear', [0.13, 0.19, 0.17], [side * 0.29, 1.53, 0], p.skin), head);
  }
  skin(sphere(scene, 'nose', [0.08, 0.09, 0.07], [0, 1.52, 0.27], p.skin), head);
  skin(softBox(scene, 'satchel', [0.42, 0.46, 0.18], [0, 1.0, -0.28], p.timberLight, 0.07), torso);
  const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
  if (!mesh) throw new Error('Character geometry could not be assembled.');
  mesh.name = 'villager'; mesh.parent = root; mesh.skeleton = skeleton;
  mesh.numBoneInfluencers = 1;
  mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
  mesh.receiveShadows = true;
  shadows.addShadowCaster(mesh);
  // A stable foot marker keeps the player readable on a small portrait screen.
  const marker = cylinder(scene, 'player-marker', 0.015, 0.88, 0.88, [0, 0.065, 0], p.pathLight, 24);
  marker.parent = root;
  marker.isPickable = false;
  let phase = 0, blend = 0, facing = Math.PI;
  const rotation = new Vector3();
  const rootRotation = Quaternion.Identity();
  root.rotationQuaternion = rootRotation;

  return {
    root, skeleton, mesh,
    update(seconds: number, velocityX: number, velocityZ: number) {
      const speed = Math.hypot(velocityX, velocityZ);
      blend += ((speed > 0.08 ? 1 : 0) - blend) * (1 - Math.exp(-seconds * 12));
      phase += seconds * (speed > 0.08 ? speed * 3.8 : 1.5);
      if (speed > 0.08) {
        const target = Math.atan2(velocityX, velocityZ);
        const difference = Math.atan2(Math.sin(target - facing), Math.cos(target - facing));
        facing += difference * (1 - Math.exp(-seconds * 14));
      }
      Quaternion.RotationYawPitchRollToRef(facing, 0, 0, rootRotation);
      const swing = Math.sin(phase) * 0.58 * blend;
      rotation.set(swing, 0, 0); leftLeg.setRotation(rotation);
      rotation.x = -swing; rightLeg.setRotation(rotation);
      rotation.x = -swing * 0.8; leftArm.setRotation(rotation);
      rotation.x = swing * 0.8; rightArm.setRotation(rotation);
      rotation.set(0.02 * blend, Math.sin(phase / 2) * 0.025, 0); torso.setRotation(rotation);
      hips.setPosition(new Vector3(0, 0.72 + Math.abs(Math.cos(phase)) * 0.035 * blend, 0));
    },
  };
}
