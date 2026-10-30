import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene';
import type { Bone } from '@babylonjs/core/Bones/bone';

/** A bounding gait for the existing eight-bone dog. The front pair supports at
 * phase 0, the rear pair at .25, then the body lifts into suspension. The
 * skeleton, geometry and bind pose stay unchanged. Babylon owns interpolation,
 * looping and the shared pause/animation clock. */
export function createDogRun(scene: Scene, body: Bone, legs: readonly Bone[]) {
  const group = new AnimationGroup('DogRun', scene);
  const referenceSpeed = 2.1;
  const lift = [0, .035, 0, .08, .12, .08, .04, .02, 0];
  for (const [index, leg] of legs.entries()) {
    const animation = new Animation(`dog-run-${leg.name}`, 'rotationQuaternion', 60, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);
    animation.setKeys(Array.from({ length: 25 }, (_, frame) => {
      const phase = frame / 24 * Math.PI * 2;
      const angle = index < 2 ? .65 * Math.sin(phase) : -.65 * Math.cos(phase);
      return { frame, value: Quaternion.RotationYawPitchRoll(0, angle, 0) };
    }));
    group.addTargetedAnimation(animation, leg);
  }
  const bounce = new Animation('dog-run-body', 'position', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
  bounce.setKeys(lift.map((height, index) => ({ frame: index * 3, value: new Vector3(0, height, 0) })));
  group.addTargetedAnimation(bounce, body);
  return { group, referenceSpeed };
}
