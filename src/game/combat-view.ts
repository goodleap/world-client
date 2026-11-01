import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { CombatState } from './combat.ts';
import { OUTPOST } from './combat-config.ts';

/** Small shared markers and one low-poly arrow per live shot. No particles or extra lights. */
export function createCombatView(scene: Scene) {
  const red = new StandardMaterial('outpost-red', scene); red.diffuseColor = Color3.FromHexString('#b54835'); red.specularColor = Color3.Black();
  const wood = new StandardMaterial('arrow-wood', scene); wood.diffuseColor = Color3.FromHexString('#66472c'); wood.specularColor = Color3.Black();
  const pole = MeshBuilder.CreateCylinder('outpost-banner-pole', { height: 2.6, diameter: .09, tessellation: 6 }, scene);
  pole.position.set(OUTPOST.x, 1.3, OUTPOST.z); pole.material = wood; pole.isPickable = false;
  const flag = MeshBuilder.CreateBox('outpost-banner', { width: .9, height: .6, depth: .035 }, scene);
  flag.position.set(OUTPOST.x + .45, 2.15, OUTPOST.z); flag.material = red; flag.isPickable = false;
  const ring = MeshBuilder.CreateTorus('outpost-boundary', { diameter: OUTPOST.radius * 2, thickness: .035, tessellation: 48 }, scene);
  ring.position.set(OUTPOST.x, .08, OUTPOST.z); ring.material = red; ring.isPickable = false;
  const arrows = new Map<number, Mesh>();
  return { update(state: CombatState) {
    red.diffuseColor.copyFromFloats(...(state.cleared ? [.3, .55, .35] : [.7, .22, .15]) as [number, number, number]);
    for (const [id, mesh] of arrows) if (!state.projectiles.some(p => p.id === id)) { mesh.dispose(); arrows.delete(id); }
    for (const p of state.projectiles) {
      let mesh = arrows.get(p.id);
      if (!mesh) {
        mesh = MeshBuilder.CreateCylinder('combat-arrow', { height: .8, diameterTop: .025, diameterBottom: .045, tessellation: 5 }, scene);
        mesh.material = wood; mesh.isPickable = false; arrows.set(p.id, mesh);
      }
      const t = Math.min(1, p.elapsed / p.duration);
      mesh.position.set(p.from.x + (p.to.x - p.from.x) * t, 1.25 + Math.sin(t * Math.PI) * .35, p.from.z + (p.to.z - p.from.z) * t);
      mesh.rotation.set(Math.PI / 2, Math.atan2(p.to.x - p.from.x, p.to.z - p.from.z), 0);
      mesh.computeWorldMatrix();
    }
  }, anchor: new Vector3(OUTPOST.x, 2.9, OUTPOST.z) };
}
