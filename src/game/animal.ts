import { Bone } from '@babylonjs/core/Bones/bone';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { cylinder, softBox, sphere } from './models.ts';
import type { Palette } from './models.ts';
import { createSkinAssembly } from './skinning.ts';
import { createVillageDog } from './dog-view.ts';

export function createAnimal(scene: Scene, p: Palette, shadows: ShadowGenerator, kind: 'horse' | 'dog', id: string) {
  if (kind === 'dog') return createVillageDog(scene, shadows, id);
  const root = new TransformNode(id, scene);
  const skeleton = new Skeleton(`${id}-rig`, `${id}-rig`, scene);
  const body = new Bone('body', skeleton, null, Matrix.Identity());
  const head = new Bone('head', skeleton, body, Matrix.Translation(0, 1.82, 0.86));
  const legs: Bone[] = [];
  const tail = new Bone('tail', skeleton, body, Matrix.Translation(0, 1.2, -0.83));
  const tailTip = new Bone('tail-tip', skeleton, tail, Matrix.Translation(0, -0.35, -0.16));
  const assembly = createSkinAssembly(), skin = assembly.add;
  const fur = p.horse;
  const width = 0.29, legZ = 0.55;
  for (const front of [true, false]) {
    for (const side of [-1, 1]) {
      const x = side * width, z = front ? legZ : -legZ;
      const leg = new Bone(`${front ? 'front' : 'rear'}-${side < 0 ? 'left' : 'right'}`, skeleton, body, Matrix.Translation(x, 0.88, z));
      legs.push(leg);
        skin(softBox(scene, 'horse-upper-leg', [0.23, 0.49, 0.27], [x, 0.68, z], fur, 0.07), leg);
        skin(cylinder(scene, 'horse-lower-leg', 0.35, 0.14, 0.18, [x, 0.28, z], fur, 8), leg);
        skin(softBox(scene, 'hoof', [0.21, 0.16, 0.27], [x, 0.085, z + 0.02], p.boot, 0.045), leg);
    }
  }
  {
    skin(sphere(scene, 'horse-body', [0.92, 0.84, 1.75], [0, 1.17, 0], fur), body);
    const neck = sphere(scene, 'horse-neck', [0.48, 1.12, 0.63], [0, 1.55, 0.63], fur);
    neck.rotation.x = 0.25; skin(neck, body);
    skin(sphere(scene, 'horse-head', [0.46, 0.52, 0.75], [0, 1.97, 0.98], fur), head);
    skin(sphere(scene, 'horse-muzzle', [0.4, 0.3, 0.45], [0, 1.81, 1.27], p.sandCloth), head);
    skin(softBox(scene, 'horse-mane', [0.11, 0.83, 0.2], [0, 1.73, 0.37], p.hair, 0.045), body);
    skin(softBox(scene, 'forelock', [0.25, 0.22, 0.1], [0, 2.19, 1.12], p.hair, 0.04), head);
    for (const side of [-1, 1]) {
      skin(cylinder(scene, 'horse-ear', 0.32, 0.16, 0.025, [side * 0.15, 2.29, 0.82], fur, 5), head);
      skin(sphere(scene, 'horse-eye', [0.06, 0.075, 0.05], [side * 0.21, 2.02, 1.12], p.nose), head);
      skin(sphere(scene, 'horse-nostril', [0.065, 0.045, 0.035], [side * 0.105, 1.85, 1.47], p.nose), head);
      skin(softBox(scene, 'saddle-girth', [0.045, 0.68, 0.13], [side * 0.44, 1.19, -0.1], p.leatherDark, 0.015), body);
      const rein = MeshBuilder.CreateTube('bridle-rein', {
        path: [new Vector3(side * 0.2, 1.85, 1.22), new Vector3(side * 0.3, 1.67, 0.68), new Vector3(side * 0.32, 1.71, 0.17)],
        radius: 0.018, tessellation: 5,
      }, scene);
      rein.material = p.leatherDark; skin(rein, body);
    }
    skin(softBox(scene, 'bridle-noseband', [0.42, 0.065, 0.09], [0, 1.94, 1.3], p.leatherDark, 0.02), head);
    skin(softBox(scene, 'saddle-blanket', [0.98, 0.09, 0.91], [0, 1.53, -0.11], p.sage, 0.03), body);
    skin(softBox(scene, 'saddle', [0.66, 0.13, 0.61], [0, 1.61, -0.1], p.leatherDark, 0.04), body);
    skin(sphere(scene, 'horse-tail-root', [0.19, 0.53, 0.25], [0, 1, -0.97], p.hair), tail);
    skin(sphere(scene, 'horse-tail-lock', [0.21, 0.61, 0.24], [0, 0.6, -1.09], p.hair), tailTip);
  }
  const { mesh, partNames } = assembly.finish(`${id}-${kind}`, root, skeleton, shadows);
  const rotation = new Vector3();
  const rootRotation = Quaternion.Identity(); root.rotationQuaternion = rootRotation;
  let phase = 1, blend = 0, facing = Math.PI;
  let motion: 'idle' | 'walk' | 'run' = 'idle';
  return {
    root, skeleton, mesh, partNames,
    get motion() { return motion; },
    get runPlaybackRate() { return undefined; },
    get runReferenceSpeed() { return undefined; },
    async loadModel() {},
    lodInfo() { return undefined; },
    update(seconds: number, vx: number, vz: number, _purposeful = false, _feeding = false) {
      const speed = Math.hypot(vx, vz);
      motion = speed <= .06 ? 'idle' : 'walk';
      blend += (Number(speed > 0.06) - blend) * (1 - Math.exp(-seconds * 9));
      phase += seconds * (speed > 0.06 ? speed * 4 : 1.8);
      if (speed > 0.06) {
        const target = Math.atan2(vx, vz);
        facing += Math.atan2(Math.sin(target - facing), Math.cos(target - facing)) * (1 - Math.exp(-seconds * 7));
      }
      Quaternion.RotationYawPitchRollToRef(facing, 0, 0, rootRotation);
      for (let i = 0; i < legs.length; i++) {
        const offset = [0, Math.PI, Math.PI * 0.7, Math.PI * 1.7][i];
        rotation.set(Math.sin(phase + offset) * 0.3 * blend, 0, 0);
        legs[i].setRotation(rotation);
      }
      rotation.set(0, Math.sin(phase * 0.4) * 0.04, 0); head.setRotation(rotation);
      rotation.set(0, Math.sin(phase * 0.7) * 0.13, 0); tail.setRotation(rotation);
      rotation.set(0, Math.sin(phase * 0.7 + 0.5) * 0.12, 0); tailTip.setRotation(rotation);
    },
  };
}
