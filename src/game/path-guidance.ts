import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import earcut from 'earcut';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Point } from './movement.ts';
import { UNIT_SELECTION_COLOR } from './selection-colors.ts';

/** Draw only the authoritative remaining route. No second path search, timer,
 * particles, extra render pass or mesh per waypoint. Idle wandering is omitted. */
export function createPathGuidance(scene: Scene) {
  const mesh = new Mesh('selected-route', scene), material = new StandardMaterial('selected-route-ink', scene);
  material.disableLighting = true; material.emissiveColor = Color3.White();
  material.backFaceCulling = false; material.disableDepthWrite = true;
  mesh.material = material; mesh.isPickable = false; mesh.setEnabled(false);
  mesh.hasVertexAlpha = true;
  const fill = Color3.FromHexString(UNIT_SELECTION_COLOR), outline = fill.scale(.7);
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
  type RouteSymbol = { x: number; z: number; station: number; first: number; count: number; alpha: number; arrow: boolean };
  let points: Point[] = [], anchors: Point[] = [], stations: number[] = [], symbols: RouteSymbol[] = [];
  let selected: string | undefined, activeId: string | undefined, progress = 0, revision = 0, colors = new Float32Array();
  return {
    update(id: string | undefined, position?: Point, route: readonly Point[] = []) {
      selected = id;
      if (!id || !position || !route.length) {
        mesh.setEnabled(false); activeId = undefined; points = []; anchors = []; symbols = []; progress = 0; return;
      }
      const next = [position, ...route].map(p => ({ x: p.x, z: p.z }));
      points = next; mesh.setEnabled(true);
      // Consuming a waypoint only advances through the existing geometry. New
      // vertices are needed only for a different unit or an actual route change.
      let segment = anchors.length - route.length - 1;
      const unchanged = activeId === id && segment >= 0 && route.every((p,i) => {
        const a = anchors[segment+1+i]; return a && Math.hypot(p.x-a.x,p.z-a.z)<1e-5;
      });
      if (!unchanged) {
        activeId = id; anchors = next; stations = [0]; symbols = []; progress = 0; segment = 0; revision++;
        for(let i=1;i<anchors.length;i++) stations.push(stations[i-1]+Math.hypot(anchors[i].x-anchors[i-1].x,anchors[i].z-anchors[i-1].z));
        const total = stations.at(-1)!;
        const positions: number[] = [], indices: number[] = [], tint: number[] = [];
        const vertices = (corners: Point[], color: Color3) => {
          const base = positions.length / 3;
          for (const p of corners) { positions.push(p.x, .095, p.z); tint.push(color.r, color.g, color.b, 1); }
          return base;
        };
        const strip = (a: Point, b: Point, width: number) => {
          const d = Math.hypot(b.x - a.x, b.z - a.z); if (d < .001) return;
          const x = (b.z - a.z) / d * width, z = (a.x - b.x) / d * width;
          const base = vertices([{ x: a.x + x, z: a.z + z }, { x: b.x + x, z: b.z + z }, { x: b.x - x, z: b.z - z }, { x: a.x - x, z: a.z - z }], outline);
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };
        // Anchor spacing at the destination. Even when a detour replans the
        // beginning, arrows on the unchanged tail stay in their world positions.
        let station = total >= .7 ? (total-.7)%1 : total+1;
        for (let i = 1; i < next.length; i++) {
          const a = next[i - 1], b = next[i], length = Math.hypot(b.x - a.x, b.z - a.z);
          if (length < .001) continue;
          const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
          for (; station < stations[i]; station += 1) {
            const offset=station-stations[i-1];
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
            symbols.push({x,z,station,first:border,count:positions.length/3-border,alpha:-1,arrow:true});
          }
        }
        const end = next.at(-1)!, diamond = [{ x: end.x, z: end.z + .28 }, { x: end.x + .28, z: end.z }, { x: end.x, z: end.z - .28 }, { x: end.x - .28, z: end.z }];
        const first=positions.length/3;
        diamond.forEach((p, i) => strip(p, diamond[(i + 1) % 4], .035));
        symbols.push({...end,station:total,first,count:positions.length/3-first,alpha:-1,arrow:false});
        colors = new Float32Array(tint);
        const data = new VertexData(); data.positions = positions; data.indices = indices; data.colors = colors;
        data.applyToMesh(mesh, true);
      }
      const a=anchors[segment], b=anchors[segment+1], dx=b.x-a.x, dz=b.z-a.z, length=Math.hypot(dx,dz);
      const projected = length ? Math.max(0,Math.min(length,((position.x-a.x)*dx+(position.z-a.z)*dz)/length)) : 0;
      progress = Math.max(progress,stations[segment]+projected);
      let changed=false;
      for(const symbol of symbols) {
        // Fade within 1.8 units ahead of the feet, gone by 0.6. No timer or
        // scrolling UVs: paused/stationary units leave the arrows unchanged.
        const alpha=Math.max(0,Math.min(1,(symbol.station-progress-.6)/1.2));
        if(Math.abs(alpha-symbol.alpha)<1e-5) continue;
        symbol.alpha=alpha; changed=true;
        for(let i=symbol.first;i<symbol.first+symbol.count;i++) colors[i*4+3]=alpha;
      }
      if(changed) mesh.updateVerticesData(VertexBuffer.ColorKind,colors);
    },
    snapshot: () => ({ visible: mesh.isEnabled(), selected, points, endpoint: points.at(-1), revision,
      arrows:symbols.filter(s=>s.arrow).map(({x,z,alpha})=>({x,z,alpha})) }),
  };
}
