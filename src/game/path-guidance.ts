import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import earcut from 'earcut';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Point } from './movement.ts';

/** Draw only the authoritative remaining route. No second path search, timer,
 * particles, extra render pass or mesh per waypoint. Idle wandering is omitted. */
export function createPathGuidance(scene: Scene) {
  const mesh = new Mesh('selected-route', scene), material = new StandardMaterial('selected-route-ink', scene);
  material.disableLighting = true; material.emissiveColor = Color3.White();
  material.alpha = .9; material.backFaceCulling = false; material.disableDepthWrite = true;
  mesh.material = material; mesh.isPickable = false; mesh.setEnabled(false);
  const outline = Color3.FromHexString('#789195'), fill = Color3.FromHexString('#edf5e9');
  // Both loops are rounded once at creation, including the nose, inner notch
  // and tail edges. Shared indexed geometry keeps the dense route one draw.
  const round = (corners: number[][], cut: number) => corners.flatMap((p, i) => {
    const previous=corners[(i+corners.length-1)%corners.length], next=corners[(i+1)%corners.length];
    const along=(q:number[])=>{const d=Math.hypot(q[0]-p[0],q[1]-p[1]);return p.map((v,k)=>v+(q[k]-v)*Math.min(cut/d,.4));};
    const a=along(previous), b=along(next);
    return Array.from({length:5},(_,j)=>{const t=j/4;return p.map((v,k)=>(1-t)**2*a[k]+2*(1-t)*t*v+t*t*b[k]);});
  });
  const outer = round([[0,.38],[.42,-.04],[.26,-.20],[0,.06],[-.26,-.20],[-.42,-.04]], .10);
  const inset = round([[0,.3234],[.3634,-.04],[.26,-.1434],[0,.1166],[-.26,-.1434],[-.3634,-.04]], .07);
  const fillIndices=earcut(inset.flat()), sides=outer.length;
  let key = '', points: Point[] = [], selected: string | undefined;
  return {
    update(id: string | undefined, position?: Point, route: readonly Point[] = []) {
      selected = id;
      if (!id || !position || !route.length) { mesh.setEnabled(false); key = ''; points = []; return; }
      const next = [position, ...route].map(p => ({ x: p.x, z: p.z }));
      const stamp = id + ':' + next.map(p => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(';');
      if (stamp === key) return;
      key = stamp; points = next; mesh.setEnabled(true);
      const positions: number[] = [], indices: number[] = [], colors: number[] = [];
      const vertices = (corners: Point[], color: Color3) => {
        const base = positions.length / 3;
        for (const p of corners) { positions.push(p.x, .095, p.z); colors.push(color.r, color.g, color.b, 1); }
        return base;
      };
      const strip = (a: Point, b: Point, width: number) => {
        const d = Math.hypot(b.x - a.x, b.z - a.z); if (d < .001) return;
        const x = (b.z - a.z) / d * width, z = (a.x - b.x) / d * width;
        const base = vertices([{ x: a.x + x, z: a.z + z }, { x: b.x + x, z: b.z + z }, { x: b.x - x, z: b.z - z }, { x: a.x - x, z: a.z - z }], outline);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      let offset = .7;
      for (let i = 1; i < next.length; i++) {
        const a = next[i - 1], b = next[i], length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < .001) continue;
        const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
        for (; offset < length; offset += 1) {
          // Leave breathing room around sharp navigation bends and the goal.
          if (offset < .32 || length - offset < .42) continue;
          const x = a.x + dx * offset, z = a.z + dz * offset;
          const orient = ([right, forward]: number[]): Point => ({ x: x + dz * right + dx * forward, z: z - dx * right + dz * forward });
          const border = vertices([...outer, ...inset].map(orient), outline);
          for (let k = 0; k < sides; k++) {
            const n = (k + 1) % sides;
            indices.push(border+k, border+n, border+sides+n, border+k, border+sides+n, border+sides+k);
          }
          const face = vertices(inset.map(orient), fill);
          for (const n of fillIndices) indices.push(face+n);
        }
        offset -= length;
      }
      const end = next.at(-1)!, diamond = [{ x: end.x, z: end.z + .28 }, { x: end.x + .28, z: end.z }, { x: end.x, z: end.z - .28 }, { x: end.x - .28, z: end.z }];
      diamond.forEach((p, i) => strip(p, diamond[(i + 1) % 4], .035));
      const data = new VertexData(); data.positions = positions; data.indices = indices; data.colors = colors;
      // Vertex count follows the actual route, generally only a few bends.
      data.applyToMesh(mesh, true);
    },
    snapshot: () => ({ visible: mesh.isEnabled(), selected, points, endpoint: points.at(-1) }),
  };
}
