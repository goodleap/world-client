import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Bone } from '@babylonjs/core/Bones/bone';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Scene } from '@babylonjs/core/scene';
import { cylinder, softBox, sphere } from './models.ts';
import type { Palette } from './models.ts';

export type HumanRole = 'traveler' | 'farmer' | 'infantry' | 'archer' | 'cavalry';
export type HumanBones = Record<'hips' | 'torso' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg', Bone>;
export type SkinPart = (mesh: Mesh, bone: Bone) => void;

/** All costumes use the same bind pose. Proportions change at the actor root. */
export const HUMAN_STYLES = {
  traveler: { name: '旅人', shirt: 'shirt', trousers: 'pants', scale: [1, 1, 1], armSwing: 0.8 },
  farmer: { name: '农民', shirt: 'flax', trousers: 'sandCloth', scale: [1, 0.98, 1], armSwing: 0.8 },
  infantry: { name: '步兵', shirt: 'leather', trousers: 'pants', scale: [1.07, 1.06, 1.04], armSwing: 0.3 },
  archer: { name: '弓兵', shirt: 'sage', trousers: 'sandCloth', scale: [0.94, 1.02, 0.96], armSwing: 0.45 },
  cavalry: { name: '骑兵', shirt: 'shirt', trousers: 'leatherDark', scale: [1, 1, 1], armSwing: 0.12 },
} as const satisfies Record<HumanRole, {
  name: string; shirt: keyof Palette; trousers: keyof Palette; scale: readonly [number, number, number]; armSwing: number;
}>;

export function addOutfit(scene: Scene, p: Palette, role: HumanRole, bones: HumanBones, skin: SkinPart) {
  const { head, torso, hips, leftArm, rightArm } = bones;
  const part = (name: string, size: [number, number, number], at: [number, number, number], color: keyof Palette, bone: Bone, bevel = 0.04) => {
    skin(softBox(scene, `${role}-${name}`, size, at, p[color], bevel), bone);
  };

  if (role === 'traveler' || role === 'farmer') {
    const wide = role === 'farmer';
    skin(cylinder(scene, `${role}-hat-brim`, 0.075, wide ? 1.03 : 0.97, wide ? 1.03 : 0.97, [0, 1.85, 0], p.linen, 12), head);
    skin(cylinder(scene, `${role}-hat-crown`, 0.27, 0.62, 0.49, [0, 1.98, 0], p.linen, 12), head);
    skin(cylinder(scene, `${role}-hat-band`, 0.075, 0.635, 0.61, [0, 1.89, 0], wide ? p.sandCloth : p.sage, 12), head);
  }
  if (role === 'traveler') {
    part('satchel', [0.42, 0.46, 0.18], [0, 1, -0.28], 'timberLight', torso, 0.07);
  }
  if (role === 'farmer') {
    part('shirt-placket', [0.045, 0.43, 0.025], [0, 1.03, 0.215], 'sandCloth', torso, 0.01);
    for (const side of [-1, 1]) {
      const collar = softBox(scene, 'linen-collar', [0.14, 0.12, 0.06], [side * 0.1, 1.27, 0.2], p.linen, 0.03);
      collar.rotation.z = side * 0.35; skin(collar, torso);
      part('rolled-cuff', [0.24, 0.1, 0.27], [side * 0.34, 0.95, 0], 'linen', side < 0 ? leftArm : rightArm);
    }
    part('rope-belt', [0.52, 0.065, 0.38], [0, 0.8, 0], 'timberLight', hips, 0.02);
    part('cloth-patch', [0.15, 0.17, 0.025], [-0.14, 0.95, 0.215], 'linen', torso, 0.015);
  }
  if (role === 'infantry' || role === 'cavalry') {
    part('cuirass', [0.53, 0.53, 0.07], [0, 1.05, 0.23], 'leatherDark', torso, 0.05);
    part('breastplate', [0.38, 0.32, 0.06], [0, 1.13, 0.29], 'metal', torso, 0.065);
    part('belt', [0.57, 0.12, 0.4], [0, 0.8, 0], 'leatherDark', hips);
    part('buckle', [0.11, 0.1, 0.04], [0, 0.8, 0.235], 'metalLight', hips, 0.02);
    skin(cylinder(scene, `${role}-helmet`, 0.23, 0.66, 0.48, [0, 1.86, 0], p.metal, 12), head);
    part('helmet-ridge', [0.065, 0.13, 0.51], [0, 1.99, 0], 'metalLight', head, 0.025);
    for (const side of [-1, 1]) {
      part('cheek-guard', [0.1, 0.24, 0.2], [side * 0.3, 1.68, 0.03], 'metal', head);
      part('shoulder-plate', [0.26, 0.16, 0.31], [side * 0.34, 1.22, 0], 'metal', side < 0 ? leftArm : rightArm, 0.055);
    }
  }
  if (role === 'infantry') {
    // Shield normal faces forward (+Z) and follows the left hand's bone.
    for (const [name, diameter, thickness, z, color] of [
      ['rim', 0.68, 0.09, 0.19, 'metal'],
      ['wood', 0.56, 0.1, 0.24, 'timber'],
    ] as const) {
      const disc = cylinder(scene, `round-shield-${name}`, thickness, diameter, diameter, [-0.5, 0.98, z], p[color], 16);
      disc.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2);
      skin(disc, leftArm);
    }
    part('shield-strap', [0.055, 0.51, 0.025], [-0.5, 0.98, 0.3], 'leatherDark', leftArm, 0.01);
    skin(sphere(scene, 'shield-boss', [0.16, 0.16, 0.09], [-0.5, 0.98, 0.33], p.metalLight), leftArm);
    part('sword-grip', [0.075, 0.21, 0.08], [0.37, 0.83, 0.12], 'leatherDark', rightArm, 0.02);
    part('sword-guard', [0.27, 0.065, 0.09], [0.37, 0.72, 0.12], 'metal', rightArm, 0.02);
    const blade = cylinder(scene, 'short-sword-blade', 0.54, 0, 0.15, [0.37, 0.42, 0.12], p.metalLight, 4);
    blade.scaling.z = 0.35; skin(blade, rightArm);
  }
  if (role === 'archer') {
    part('leather-vest', [0.46, 0.46, 0.055], [0, 1.04, 0.225], 'leather', torso, 0.045);
    for (const side of [-1, 1]) {
      part('bracer', [0.23, 0.18, 0.27], [side * 0.34, 0.9, 0], 'leatherDark', side < 0 ? leftArm : rightArm);
    }
    const strap = softBox(scene, 'quiver-strap', [0.07, 0.65, 0.045], [0, 1.04, 0.27], p.leatherDark, 0.015);
    strap.rotation.z = -0.52; skin(strap, torso);
    skin(cylinder(scene, 'quiver', 0.62, 0.24, 0.29, [0.16, 1.12, -0.35], p.leather, 10), torso);
    for (let i = 0; i < 3; i++) {
      const x = 0.09 + i * 0.065;
      skin(cylinder(scene, 'arrow-shaft', 0.49, 0.018, 0.018, [x, 1.48, -0.35], p.timberLight, 5), torso);
      part('arrow-fletching', [0.08, 0.11, 0.025], [x, 1.69, -0.35], 'linen', torso, 0.01);
    }
    const bow = MeshBuilder.CreateTube('wooden-bow', {
      path: [new Vector3(-0.65, 0.24, 0.14), new Vector3(-0.46, 0.5, 0.14), new Vector3(-0.38, 0.85, 0.14), new Vector3(-0.46, 1.2, 0.14), new Vector3(-0.65, 1.47, 0.14)],
      radius: 0.035, tessellation: 6, cap: 3,
    }, scene);
    bow.material = p.timber; skin(bow, leftArm);
    skin(cylinder(scene, 'bowstring', 1.23, 0.012, 0.012, [-0.65, 0.855, 0.14], p.flax, 4), leftArm);
  }
  if (role === 'cavalry') {
    skin(cylinder(scene, 'lance-shaft', 2.1, 0.045, 0.045, [0.38, 1.43, 0.13], p.timber, 8), rightArm);
    const tip = cylinder(scene, 'lance-tip', 0.29, 0.13, 0, [0.38, 2.62, 0.13], p.metalLight, 4);
    tip.scaling.z = 0.6; skin(tip, rightArm);
    part('lance-grip', [0.065, 0.25, 0.07], [0.38, 0.86, 0.13], 'leatherDark', rightArm, 0.015);
  }
}
