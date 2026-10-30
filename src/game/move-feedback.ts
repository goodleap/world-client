import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import type { Point } from './movement.ts';

/** One reusable ground marker; native animations share the scene's pause clock. */
export function createMoveFeedback(scene: Scene) {
  const root = new TransformNode('move-destination', scene);
  const material = new StandardMaterial('move-destination-ink', scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.FromHexString('#fff5bd');
  material.backFaceCulling = false;
  const ring = MeshBuilder.CreateTorus('move-destination-ring', { diameter: .5, thickness: .05, tessellation: 32 }, scene);
  ring.parent = root; ring.material = material; ring.isPickable = false;
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    const arrow = MeshBuilder.CreateDisc(`move-destination-arrow-${i}`, { radius: .19, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE }, scene);
    arrow.parent = root; arrow.material = material; arrow.isPickable = false;
    arrow.position.set(Math.cos(angle) * .68, .01, Math.sin(angle) * .68);
    arrow.rotation.set(Math.PI / 2, Math.PI - angle, 0);
  }
  const group = new AnimationGroup('move-destination-feedback', scene);
  const scale = new Animation('converge', 'scaling', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
  scale.setKeys([{ frame: 0, value: Vector3.One().scale(1.45) }, { frame: 16, value: Vector3.One().scale(.82) }, { frame: 48, value: Vector3.One().scale(.9) }]);
  const fade = new Animation('fade', 'alpha', 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
  fade.setKeys([{ frame: 0, value: .6 }, { frame: 6, value: 1 }, { frame: 28, value: 1 }, { frame: 48, value: 0 }]);
  group.addTargetedAnimation(scale, root); group.addTargetedAnimation(fade, material);
  group.onAnimationGroupEndObservable.add(() => root.setEnabled(false));
  root.setEnabled(false);
  return {
    show(point: Point) {
      group.stop(); root.position.set(point.x, .06, point.z); root.scaling.setAll(1.45); material.alpha = .6;
      root.setEnabled(true); group.start(false, 1, 0, 48);
    },
    snapshot: () => ({ visible: root.isEnabled(), x: root.position.x, z: root.position.z }),
  };
}
