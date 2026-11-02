import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Palette } from './models.ts';
import type { CropKind } from './economy.ts';
import { ellipsoid, tintHeight } from './environment-shapes.ts';

/** One crop geometry source for growing plants and their laid-down harvest. */
export function createCropModel(scene: Scene, p: Palette, carrot: StandardMaterial, kind: CropKind, stage: number) {
  const size = [.35, .65, 1][stage];
  if (kind === 'carrot') {
    ellipsoid(scene, 'carrot', [.37 * size, .4 * size, .37 * size], [0, .10 + .16 * size, 0], carrot, 12);
    for (let i = -1; i <= 1; i++) {
      const leaf = ellipsoid(scene, 'carrot-leaf', [.19 * size, .5 * size, .14 * size], [i * .13 * size, .10 + .51 * size, 0], i % 2 ? p.leaf : p.leafLight, 12);
      leaf.rotation.z = i * -.5; tintHeight(leaf, '#539d54', '#ffffff');
    }
  } else for (let i = -1; i <= 1; i++) {
    const stem = MeshBuilder.CreateCylinder('wheat-stem', { height: .65 * size, diameter: .035, tessellation: 8 }, scene);
    stem.position.set(i * .15 * size, .10 + .325 * size, 0); stem.material = p.leafLight;
    for (let k = 0; k < 3; k++) {
      const ear = ellipsoid(scene, 'wheat-ear', [.13 * size, .21 * size, .13 * size], [(i * .15 + (k % 2 - .5) * .07) * size, .10 + (.60 + k * .1) * size, 0], stage < 2 ? p.leafLight : k % 2 ? p.golden : p.linen, 12);
      ear.rotation.z = (k % 2 - .5) * .7;
    }
  }
}
