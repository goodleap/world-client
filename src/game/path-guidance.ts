import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Point } from './movement.ts';

/** Draw only the authoritative remaining route. No second path search, timer,
 * particles, extra render pass or mesh per waypoint. Idle wandering is omitted. */
export function createPathGuidance(scene: Scene) {
  const mesh = new Mesh('selected-route', scene), material = new StandardMaterial('selected-route-ink', scene);
  material.disableLighting = true; material.emissiveColor = Color3.FromHexString('#a7eff2');
  material.alpha = .53; material.backFaceCulling = false; material.disableDepthWrite = true;
  mesh.material = material; mesh.isPickable = false; mesh.setEnabled(false);
  let key = '', points: Point[] = [], selected: string | undefined;
  return {
    update(id: string | undefined, position?: Point, route: readonly Point[] = []) {
      selected = id;
      if (!id || !position || !route.length) { mesh.setEnabled(false); key = ''; points = []; return; }
      const next = [position, ...route].map(p => ({ x: p.x, z: p.z }));
      const stamp = id + ':' + next.map(p => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';');
      if (stamp === key) return;
      key = stamp; points = next; mesh.setEnabled(true);
      const positions: number[] = [], indices: number[] = [];
      const polygon = (corners: Point[]) => {
        const base = positions.length / 3;
        for (const p of corners) positions.push(p.x, .095, p.z);
        for (let i = 1; i < corners.length - 1; i++) indices.push(base, base + i, base + i + 1);
      };
      const strip = (a: Point, b: Point, width: number) => {
        const d = Math.hypot(b.x - a.x, b.z - a.z); if (d < .001) return;
        const x = (b.z - a.z) / d * width, z = (a.x - b.x) / d * width;
        polygon([{ x: a.x + x, z: a.z + z }, { x: b.x + x, z: b.z + z }, { x: b.x - x, z: b.z - z }, { x: a.x - x, z: a.z - z }]);
      };
      let offset = 1;
      for (let i = 1; i < next.length; i++) {
        const a = next[i - 1], b = next[i], length = Math.hypot(b.x - a.x, b.z - a.z);
        strip(a, b, .07);
        if (length < .001) continue;
        const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
        for (; offset < length; offset += 2.4) {
          const x = a.x + dx * offset, z = a.z + dz * offset;
          polygon([{ x: x + dx * .22, z: z + dz * .22 }, { x: x - dx * .12 + dz * .18, z: z - dz * .12 - dx * .18 },
            { x: x - dx * .12 - dz * .18, z: z - dz * .12 + dx * .18 }]);
        }
        offset -= length;
      }
      const end = next.at(-1)!, diamond = [{ x: end.x, z: end.z + .28 }, { x: end.x + .28, z: end.z }, { x: end.x, z: end.z - .28 }, { x: end.x - .28, z: end.z }];
      diamond.forEach((p, i) => strip(p, diamond[(i + 1) % 4], .035));
      const data = new VertexData(); data.positions = positions; data.indices = indices;
      // Vertex count follows the actual route, generally only a few bends.
      data.applyToMesh(mesh, true);
    },
    snapshot: () => ({ visible: mesh.isEnabled(), selected, points, endpoint: points.at(-1) }),
  };
}
