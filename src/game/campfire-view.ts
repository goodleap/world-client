import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import type { Palette } from './models.ts';
import { ellipsoid, roundedBox } from './environment-shapes.ts';
import { fireAppearance } from './campfire.ts';
import type { Campfire } from './campfire.ts';
import type { Point } from './movement.ts';
import { CAMPFIRE_SHAPE as SHAPE } from './campfire-shape.ts';
import { refreshFrozenMaterials } from './material-invalidation.ts';
import { createFirePicking } from './picking-shapes.ts';

/** A stone ring, charred logs and a removable roasting spit. Two pooled native
 * lights, no shadow maps, glow post-processes, smoke or particle emitters. */
export function createCampfireView(scene: Scene, p: Palette, shadows?: ShadowGenerator) {
  const material = (name: string, color: string, emissive = false) => {
    const m = new StandardMaterial(name, scene); m.diffuseColor = Color3.FromHexString(color); m.specularColor = Color3.Black();
    if (emissive) { m.emissiveColor = m.diffuseColor; m.disableLighting = true; } return m;
  };
  const ash = material('fire-ash', '#544b40'), meat = material('fire-roast', '#b75b32');
  const orange = material('fire-orange', '#ff8c2d', true), yellow = material('fire-core', '#ffd975', true);
  const lights = Array.from({ length: 2 }, (_, i) => {
    const light = new PointLight(`campfire-light-${i}`, new Vector3(), scene);
    light.diffuse = Color3.FromHexString('#ffbd70'); light.specular = Color3.Black(); light.range = 8; light.intensity = 0;
    light.shadowEnabled = false; light.setEnabled(false); return light;
  });
  const items = new Map<string, { root: TransformNode; flame: TransformNode; roast: TransformNode; state: string }>();
  let clock = 0;
  function merge(parts: Mesh[], root: TransformNode) {
    const groups = new Map<Mesh['material'], Mesh[]>();
    for (const m of parts) { m.computeWorldMatrix(true); const group = groups.get(m.material) ?? []; group.push(m); groups.set(m.material, group); }
    for (const group of groups.values()) {
      const mesh = group.length === 1 ? group[0] : Mesh.MergeMeshes(group, true, true)!;
      mesh.parent = root; mesh.metadata = { worldObjectId: root.name.split(':')[0] }; mesh.isPickable = false; mesh.receiveShadows = true;
      if (root.name.endsWith(':base')) shadows?.addShadowCaster(mesh, false);
    }
  }
  function add(site: Point & { id: string }) {
    if (items.has(site.id)) return;
    const root = new TransformNode(site.id + ':base', scene), flame = new TransformNode(site.id + ':flame', scene), roast = new TransformNode(site.id + ':roast', scene);
    const stone: Mesh[] = [];
    for (let i = 0; i < SHAPE.stones; i++) {
      const a = i * Math.PI * 2 / SHAPE.stones;
      const rock = ellipsoid(scene, 'hearth-stone', [SHAPE.stoneWidth, .4 + .05 * (i % 3), SHAPE.stoneDepth], [Math.cos(a) * SHAPE.orbit, .22, Math.sin(a) * SHAPE.orbit], i % 3 ? p.stoneLight : p.stone, 8);
      rock.rotation.y = -a; rock.rotation.z = .1 * Math.sin(i * 7); stone.push(rock);
    }
    stone.push(ellipsoid(scene, 'hearth-ash', [1.9, .14, 1.9], [0, .09, 0], ash, 12));
    for (let i = 0; i < 3; i++) {
      const log = roundedBox(scene, 'charred-log', [1.5, .25, .29], [0, .22 + i * .09, 0], p.woodDark, .1); log.rotation.y = i * Math.PI / 3; stone.push(log);
    }
    merge(stone, root);
    const flames: Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const scale = i === 0 ? 1 : .65;
      const shape = [new Vector3(.05, 0), new Vector3(.27, .18), new Vector3(.29, .42), new Vector3(.18, .7), new Vector3(.08, .95), new Vector3(0, 1.2)].map(v => v.scale(scale));
      const f = MeshBuilder.CreateLathe('hearth-flame', { shape, tessellation: 10 }, scene);
      f.position.set((i - 1) * .32, .35, i % 2 * .18); f.material = i === 1 ? yellow : orange; flames.push(f);
    }
    merge(flames, flame);
    const spit: Mesh[] = [];
    for (const x of [-.82, .82]) {
      const post = roundedBox(scene, 'spit-post', [.12, 1.4, .12], [x, .7, .05], p.timberLight, .04); spit.push(post);
    }
    spit.push(roundedBox(scene, 'spit-bar', [2, .09, .09], [0, 1.25, .05], p.woodDark, .04));
    spit.push(ellipsoid(scene, 'roasting-food', [.82, .42, .42], [0, 1.25, .05], meat, 12));
    for (const x of [-.22, .1]) spit.push(roundedBox(scene, 'roast-score', [.035, .13, .035], [x, 1.4, -.08], p.golden, .012));
    merge(spit, roast);
    flame.parent = root; roast.parent = root; root.position.set(site.x, 0, site.z);
    createFirePicking(scene,root,site.id,SHAPE.radius);
    flame.setEnabled(false); roast.setEnabled(false); items.set(site.id, { root, flame, roast, state: 'off' });
  }
  function remove(id: string) {
    const item = items.get(id); if (!item) return;
    for (const mesh of item.root.getChildMeshes()) shadows?.removeShadowCaster(mesh, false);
    item.root.dispose(); items.delete(id);
  }
  return {
    add, remove,
    update(fires: readonly Campfire[], dt: number, center: Point) {
      clock += Math.max(0, dt);
      const burning: typeof items extends Map<string, infer T> ? T[] : never = [];
      for (const fire of fires) {
        const item = items.get(fire.id); if (!item) continue;
        const state = fireAppearance(fire);
        if (state !== item.state) { item.state = state; item.flame.setEnabled(state !== 'off'); item.roast.setEnabled(state === 'cooking'); }
        if (state !== 'off') {
          item.flame.scaling.y = 1 + .075 * Math.sin(clock * 7 + item.root.position.x);
          burning.push(item);
        }
      }
      burning.sort((a, b) => Math.hypot(a.root.position.x - center.x, a.root.position.z - center.z) - Math.hypot(b.root.position.x - center.x, b.root.position.z - center.z));
      let lightMembershipChanged = false;
      lights.forEach((light, i) => {
        const item = burning[i];
        if (light.isEnabled() !== !!item) { light.setEnabled(!!item); lightMembershipChanged = true; }
        light.intensity = item ? .85 : 0;
        if (item) light.position.set(item.root.position.x, 1.7, item.root.position.z);
      });
      if (lightMembershipChanged) refreshFrozenMaterials(scene);
    },
    snapshot: () => ({ lights: lights.filter(l => l.intensity > 0).length, budget: 2, states: [...items].map(([id, item]) => ({ id, state: item.state, flameScale: item.flame.scaling.y })) }),
  };
}
export type CampfireView = ReturnType<typeof createCampfireView>;
