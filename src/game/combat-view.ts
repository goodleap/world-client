import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { CombatState } from './combat.ts';

/** One low-poly arrow per live shot. No particles or extra lights. */
export function createCombatView(scene: Scene) {
  const wood = new StandardMaterial('arrow-wood', scene); wood.diffuseColor = Color3.FromHexString('#66472c'); wood.specularColor = Color3.Black();
  const arrows = new Map<number, Mesh>();
  return { update(state: CombatState, visualLag = 0) {
    for (const [id, mesh] of arrows) if (!state.projectiles.some(p => p.id === id)) { mesh.dispose(); arrows.delete(id); }
    for (const p of state.projectiles) {
      let mesh = arrows.get(p.id);
      if (!mesh) {
        mesh = MeshBuilder.CreateCylinder('combat-arrow', { height: .8, diameterTop: .025, diameterBottom: .045, tessellation: 5 }, scene);
        mesh.material = wood; mesh.isPickable = false; arrows.set(p.id, mesh);
      }
      const t = Math.min(1, Math.max(0, p.elapsed - visualLag) / p.duration);
      mesh.position.set(p.from.x + (p.to.x - p.from.x) * t, (p.from.y??1.25)*(1-t)+(p.to.y??1.25)*t + Math.sin(t * Math.PI) * .35, p.from.z + (p.to.z - p.from.z) * t);
      mesh.rotation.set(Math.PI / 2 + Math.atan2((p.to.y??1.25)-(p.from.y??1.25),Math.hypot(p.to.x-p.from.x,p.to.z-p.from.z)), Math.atan2(p.to.x - p.from.x, p.to.z - p.from.z), 0);
      mesh.computeWorldMatrix();
    }
  } };
}
