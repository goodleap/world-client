import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { DEATH, DEATH_END, deathPhase } from './death.ts';

/** One native clip per retiring unit. Read its posed vertices once, then sample
 * a short root-motion track. No ragdoll, per-frame skin readback or extra pass.
 * Rider and mount retain both rigs under the SAME root and fall as one assembly. */
export class DeathView {
  private clip?: AnimationGroup;
  private age = -1;
  private height = 0;
  private root: TransformNode;
  private side: number;
  constructor(root: TransformNode, side = -1) { this.root = root; this.side = side; }
  sample(age: number, facing: number, meshes: readonly AbstractMesh[], pose: () => void) {
    if (age >= DEATH_END) {
      if (this.age < DEATH_END) this.clip?.goToFrame(DEATH_END * 60);
      this.root.setEnabled(false); this.age = age; return;
    }
    this.root.setEnabled(true);
    if (!this.clip) {
      pose();
      this.root.position.y = 0; this.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(facing, 0, 0);
      this.root.computeWorldMatrix(true);
      const inverse = Matrix.Invert(this.root.getWorldMatrix()), local = new Vector3(), points: number[] = [];
      for (const mesh of meshes) {
        mesh.skeleton?.prepare(true); mesh.computeWorldMatrix(true);
        const transform = mesh.getWorldMatrix().multiply(inverse), data = mesh.getPositionData(true, true);
        if (!data) continue;
        for (let i = 0; i < data.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(data[i], data[i + 1], data[i + 2], transform, local);
          points.push(local.x, local.y);
        }
      }
      const turn = new Animation('death-fall', 'rotationQuaternion', 60, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CONSTANT);
      const lift = new Animation('death-ground-and-sink', 'position.y', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
      const rotations = [], heights = [];
      let grounded = 0;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, roll = this.side * Math.PI / 2 * t * t * (3 - 2 * t);
        let bottom = Infinity, top = -Infinity;
        for (let j = 0; j < points.length; j += 2) {
          const y = points[j] * Math.sin(roll) + points[j + 1] * Math.cos(roll);
          bottom = Math.min(bottom, y); top = Math.max(top, y);
        }
        grounded = points.length ? .015 - bottom : 0;
        if (i === 24) this.height = points.length ? top - bottom : 3;
        rotations.push({ frame: DEATH.fall * 60 * t, value: Quaternion.RotationYawPitchRoll(facing, 0, roll) });
        heights.push({ frame: DEATH.fall * 60 * t, value: grounded });
      }
      rotations.push({frame: DEATH_END * 60, value: rotations.at(-1)!.value.clone()});
      heights.push({frame:(DEATH.fall + DEATH.hold) * 60, value:grounded}, {frame:DEATH_END * 60, value:grounded - this.height - .2});
      turn.setKeys(rotations); lift.setKeys(heights);
      this.clip = new AnimationGroup(`${this.root.name}-death`, this.root.getScene());
      this.clip.addTargetedAnimation(turn, this.root); this.clip.addTargetedAnimation(lift, this.root);
      this.clip.start(false).pause();
    }
    if (this.age !== age) this.clip.goToFrame(Math.max(0, age) * 60);
    this.age = age;
  }
  reset() { this.clip?.dispose(); this.clip = undefined; this.age = -1; this.root.position.y = 0; }
  snapshot() { return { age: this.age, phase: this.age < 0 ? 'alive' : deathPhase(this.age), height: this.height, y: this.root.position.y, visible: this.root.isEnabled() }; }
}
