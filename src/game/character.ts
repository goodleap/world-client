import { Bone } from '@babylonjs/core/Bones/bone';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { cylinder, softBox, sphere } from './models.ts';
import type { Palette } from './models.ts';
import { addOutfit, HUMAN_STYLES } from './character-outfits.ts';
import type { HumanRole } from './character-outfits.ts';
import { createSkinAssembly } from './skinning.ts';

export interface CharacterOptions { id?: string; role?: HumanRole; marker?: boolean; phase?: number; mounted?: boolean }

export function createCharacter(scene: Scene, p: Palette, shadows: ShadowGenerator, options: CharacterOptions = {}) {
  const { id = 'player', role = 'traveler', marker: showMarker = true } = options;
  const style = HUMAN_STYLES[role];
  const root = new TransformNode(id, scene);
  root.scaling.set(style.scale[0], style.scale[1], style.scale[2]);
  // Each actor owns its pose, but shares this rig definition, base body and animation code.
  const skeleton = new Skeleton(`${id}-rig`, `${id}-rig`, scene);
  const hips = new Bone('hips', skeleton, null, Matrix.Translation(0, 0.72, 0));
  const torso = new Bone('torso', skeleton, hips, Matrix.Translation(0, 0.25, 0));
  const head = new Bone('head', skeleton, torso, Matrix.Translation(0, 0.5, 0));
  const leftArm = new Bone('left-arm', skeleton, torso, Matrix.Translation(-0.32, 0.2, 0));
  const rightArm = new Bone('right-arm', skeleton, torso, Matrix.Translation(0.32, 0.2, 0));
  const leftLeg = new Bone('left-leg', skeleton, hips, Matrix.Translation(-0.16, -0.05, 0));
  const rightLeg = new Bone('right-leg', skeleton, hips, Matrix.Translation(0.16, -0.05, 0));
  const assembly = createSkinAssembly();
  const skin = assembly.add;
  skin(softBox(scene, 'shirt', [0.57, 0.62, 0.4], [0, 1.03, 0], p[style.shirt], 0.1), torso);
  skin(softBox(scene, 'trousers', [0.51, 0.27, 0.36], [0, 0.71, 0], p[style.trousers], 0.08), hips);
  skin(softBox(scene, 'face', [0.52, 0.52, 0.48], [0, 1.55, 0], p.skin, 0.13), head);
  skin(sphere(scene, 'hair', [0.59, 0.36, 0.55], [0, 1.78, -0.04], p.hair), head);
  skin(softBox(scene, 'back-hair', [0.51, 0.35, 0.18], [0, 1.57, -0.2], p.hair, 0.05), head);
  for (const side of [-1, 1]) {
    const arm = side < 0 ? leftArm : rightArm, leg = side < 0 ? leftLeg : rightLeg;
    skin(softBox(scene, 'sleeve', [0.22, 0.35, 0.25], [side * 0.34, 1.03, 0], p[style.shirt], 0.06), arm);
    skin(softBox(scene, 'hand', [0.18, 0.21, 0.2], [side * 0.35, 0.78, 0.02], p.skin, 0.06), arm);
    if (role === 'farmer') {
      skin(softBox(scene, 'bare-calf', [0.19, 0.33, 0.21], [side * 0.16, 0.32, 0], p.skin, 0.05), leg);
      skin(softBox(scene, 'shorts', [0.25, 0.25, 0.29], [side * 0.16, 0.56, 0], p.sandCloth, 0.045), leg);
      skin(softBox(scene, 'foot', [0.2, 0.12, 0.3], [side * 0.16, 0.13, 0.04], p.skin, 0.04), leg);
      skin(softBox(scene, 'straw-sandal', [0.25, 0.065, 0.37], [side * 0.16, 0.055, 0.06], p.straw, 0.025), leg);
      skin(softBox(scene, 'sandal-strap', [0.23, 0.045, 0.065], [side * 0.16, 0.2, 0.1], p.straw, 0.015), leg);
    } else {
      skin(softBox(scene, 'leg', [0.22, 0.45, 0.25], [side * 0.16, 0.43, 0], p[style.trousers], 0.05), leg);
      skin(softBox(scene, 'boot', [0.25, 0.19, 0.38], [side * 0.16, 0.13, 0.05], p.boot, 0.06), leg);
      if (role !== 'traveler') skin(softBox(scene, 'boot-cuff', [0.25, 0.22, 0.27], [side * 0.16, 0.28, 0], p.leatherDark, 0.035), leg);
    }
    skin(sphere(scene, 'eye', [0.045, 0.06, 0.035], [side * 0.105, 1.58, 0.247], p.woodDark), head);
    skin(sphere(scene, 'ear', [0.13, 0.19, 0.17], [side * 0.29, 1.53, 0], p.skin), head);
  }
  skin(sphere(scene, 'nose', [0.08, 0.09, 0.07], [0, 1.52, 0.27], p.skin), head);
  addOutfit(scene, p, role, { hips, torso, head, leftArm, rightArm, leftLeg, rightLeg }, skin);
  const { mesh, partNames } = assembly.finish(`${id}-${role}`, root, skeleton, shadows);
  // A stable foot marker keeps the player readable on a small portrait screen.
  if (showMarker) {
    const marker = cylinder(scene, `${id}-marker`, 0.015, 0.88, 0.88, [0, 0.065, 0], p.pathLight, 24);
    marker.parent = root; marker.isPickable = false;
  }
  let phase = options.phase ?? 0, blend = 0, facing = Math.PI;
  const rotation = new Vector3();
  const hipPosition = new Vector3();
  const rootRotation = Quaternion.Identity();
  root.rotationQuaternion = rootRotation;

  return {
    root, skeleton, mesh, role, partNames,
    update(seconds: number, velocityX: number, velocityZ: number) {
      const speed = Math.hypot(velocityX, velocityZ);
      blend += ((speed > 0.08 ? 1 : 0) - blend) * (1 - Math.exp(-seconds * 12));
      phase += seconds * (speed > 0.08 ? speed * 3.8 : 1.5);
      if (speed > 0.08) {
        const target = Math.atan2(velocityX, velocityZ);
        const difference = Math.atan2(Math.sin(target - facing), Math.cos(target - facing));
        facing += difference * (1 - Math.exp(-seconds * 14));
      }
      Quaternion.RotationYawPitchRollToRef(options.mounted ? 0 : facing, 0, 0, rootRotation);
      const swing = Math.sin(phase) * 0.58 * blend;
      if (options.mounted) {
        rotation.set(-0.5, 0, -0.55); leftLeg.setRotation(rotation);
        rotation.z = 0.55; rightLeg.setRotation(rotation);
        rotation.set(-0.4 + swing * 0.08, 0, 0); leftArm.setRotation(rotation);
        rotation.set(-0.08 + swing * 0.06, 0, 0); rightArm.setRotation(rotation);
      } else {
        rotation.set(swing, 0, 0); leftLeg.setRotation(rotation);
        rotation.x = -swing; rightLeg.setRotation(rotation);
        rotation.x = -swing * style.armSwing; leftArm.setRotation(rotation);
        rotation.x = swing * style.armSwing; rightArm.setRotation(rotation);
      }
      rotation.set(0.02 * blend, Math.sin(phase / 2) * 0.025, 0); torso.setRotation(rotation);
      hipPosition.set(0, 0.72 + Math.abs(Math.cos(phase)) * 0.035 * blend, 0);
      hips.setPosition(hipPosition);
    },
  };
}
