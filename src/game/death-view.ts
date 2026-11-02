import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { DEATH, DEATH_END, deathPhase } from './death.ts';
import type { Point } from './movement.ts';

type FallOptions = { prone?: boolean; side?: number; offset?: Point; airborne?: boolean };
/** Native sampled root tracks. Posed vertices establish actual ground contact;
 * no ragdoll, per-frame skin readback or additional render pass. */
export class DeathView {
  private clip?: AnimationGroup;
  private age = -1;
  private height = 0;
  private root: TransformNode;
  private options: FallOptions;
  constructor(root: TransformNode, options: FallOptions = {}) { this.root = root; this.options = options; }
  sample(age: number, facing: number, meshes: readonly AbstractMesh[], pose: () => void, posture?: AnimationGroup) {
    if (age >= DEATH_END) {
      if (this.age < DEATH_END) this.clip?.goToFrame(DEATH_END * 60);
      this.root.setEnabled(false); this.age = age; return;
    }
    this.root.setEnabled(true);
    if (!this.clip) {
      pose();
      this.root.position.y = 0; this.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(facing, 0, 0);
      this.root.computeWorldMatrix(true);
      const inverse = Matrix.Invert(this.root.getWorldMatrix()), local = new Vector3();
      const readPoints = () => {
        const points: number[] = [];
        for (const mesh of meshes) {
          // Native linked bones read their transform nodes during prepare.
          mesh.skeleton?.prepare(true); mesh.computeWorldMatrix(true);
          const transform = mesh.getWorldMatrix().multiply(inverse), data = mesh.getPositionData(true, true);
          if (!data) continue;
          for (let i = 0; i < data.length; i += 3) {
            Vector3.TransformCoordinatesFromFloatsToRef(data[i], data[i + 1], data[i + 2], transform, local);
            points.push(local.x, local.y, local.z);
          }
        }
        return points;
      };
      const fixed = posture ? undefined : readPoints();
      if (posture) posture.start(false).pause();
      const turn = new Animation('death-fall', 'rotationQuaternion', 60, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CONSTANT);
      const lift = new Animation('death-ground-and-sink', 'position.y', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
      const rotations = [], heights = [], x = [], z = [];
      let grounded = 0;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, eased = t * t * (3 - 2 * t), angle = Math.PI / 2 * eased;
        // Only the single mounted rider unfolds from its seated pose. Sample
        // its short native blend once at death, then use cached tracks forever.
        posture?.goToFrame(t * DEATH.fall * 60);
        const points = fixed ?? readPoints();
        const pitch = this.options.prone ? angle : 0, roll = this.options.prone ? 0 : (this.options.side ?? -1) * angle;
        let bottom = Infinity, top = -Infinity;
        for (let j = 0; j < points.length; j += 3) {
          const y = this.options.prone ? points[j + 1] * Math.cos(pitch) - points[j + 2] * Math.sin(pitch)
            : points[j] * Math.sin(roll) + points[j + 1] * Math.cos(roll);
          bottom = Math.min(bottom, y); top = Math.max(top, y);
        }
        grounded = points.length ? .015 - bottom : 0;
        if (this.options.airborne && grounded < 0) grounded *= eased;
        if (i === 24) this.height = points.length ? top - bottom : 3;
        const frame = DEATH.fall * 60 * t;
        rotations.push({ frame, value: Quaternion.RotationYawPitchRoll(facing, pitch, roll) });
        heights.push({ frame, value: grounded });
        x.push({ frame, value: (this.options.offset?.x ?? 0) * eased });
        z.push({ frame, value: (this.options.offset?.z ?? 0) * eased });
      }
      rotations.push({ frame: DEATH_END * 60, value: rotations.at(-1)!.value.clone() });
      heights.push({ frame: (DEATH.fall + DEATH.hold) * 60, value: grounded }, { frame: DEATH_END * 60, value: grounded - this.height - .2 });
      turn.setKeys(rotations); lift.setKeys(heights);
      this.clip = new AnimationGroup(`${this.root.name}-death`, this.root.getScene());
      this.clip.addTargetedAnimation(turn, this.root); this.clip.addTargetedAnimation(lift, this.root);
      if (this.options.offset) for (const [property, keys] of [['position.x', x], ['position.z', z]] as const) {
        const track = new Animation('death-separation', property, 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
        keys.push({ frame: DEATH_END * 60, value: keys.at(-1)!.value }); track.setKeys(keys); this.clip.addTargetedAnimation(track, this.root);
      }
      if (posture) { posture.stop(); for (const track of posture.targetedAnimations) this.clip.addTargetedAnimation(track.animation, track.target); }
      this.clip.start(false).pause();
    }
    if (this.age !== age) this.clip.goToFrame(Math.max(0, age) * 60);
    this.age = age;
  }
  reset() {
    this.clip?.dispose(); this.clip = undefined; this.age = -1; this.root.position.y = 0;
    if (this.options.offset) { this.root.position.x = 0; this.root.position.z = 0; }
  }
  snapshot() { return { age: this.age, phase: this.age < 0 ? 'alive' : deathPhase(this.age), height: this.height, y: this.root.position.y, visible: this.root.isEnabled() }; }
}

/** Separate native transforms for rider and mount; skeletons and skinning stay
 * intact. LODs inherit their master mesh world transform in Babylon. */
export class MountedDeathView {
  private rider?: DeathView;
  private mount?: DeathView;
  private groups: TransformNode[] = [];
  private originals: { mesh: AbstractMesh; parent: AbstractMesh['parent']; position: Vector3; rotation: Vector3; quaternion: Quaternion | null; scaling: Vector3 }[] = [];
  private age = -1;
  private root: TransformNode;
  constructor(root: TransformNode) { this.root = root; }
  sample(age: number, facing: number, meshes: readonly AbstractMesh[], pose: () => void, posture?: AnimationGroup) {
    this.age = age;
    if (age >= DEATH_END) { this.root.setEnabled(false); return; }
    if (!this.rider) {
      pose(); this.root.position.y = 0; this.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(facing, 0, 0);
      const rider = new TransformNode('fallen-rider', this.root.getScene()), mount = new TransformNode('fallen-mount', this.root.getScene());
      rider.parent = mount.parent = this.root; this.groups = [rider, mount];
      this.originals = meshes.map(mesh => ({ mesh, parent: mesh.parent, position: mesh.position.clone(), rotation: mesh.rotation.clone(),
        quaternion: mesh.rotationQuaternion?.clone() ?? null, scaling: mesh.scaling.clone() }));
      for (const mesh of meshes) mesh.setParent(mesh.skeleton?.bones[0]?.name.startsWith('Horse.') ? mount : rider);
      this.rider = new DeathView(rider, { prone: true, airborne: true, offset: { x: 1.15, z: .1 } });
      this.mount = new DeathView(mount, { side: 1, offset: { x: -.15, z: 0 } });
    }
    const human = meshes.filter(m => !m.skeleton?.bones[0]?.name.startsWith('Horse.'));
    this.rider.sample(age, 0, human, () => {}, posture);
    this.mount!.sample(age, 0, meshes.filter(m => !human.includes(m)), () => {});
  }
  reset() {
    this.rider?.reset(); this.mount?.reset();
    for (const { mesh, parent, position, rotation, quaternion, scaling } of this.originals) {
      mesh.parent = parent; mesh.position.copyFrom(position); mesh.rotation.copyFrom(rotation); mesh.rotationQuaternion = quaternion; mesh.scaling.copyFrom(scaling);
    }
    this.groups.forEach(g => g.dispose()); this.groups = []; this.originals = [];
    this.rider = this.mount = undefined; this.age = -1; this.root.position.y = 0;
  }
  snapshot() {
    const rider = this.rider?.snapshot();
    return { age: this.age, phase: this.age < 0 ? 'alive' : deathPhase(this.age), height: rider?.height ?? 0,
      y: rider?.y ?? 0, visible: this.root.isEnabled(), rider, mount: this.mount?.snapshot() };
  }
}
