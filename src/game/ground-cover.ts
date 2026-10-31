import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { BuildingSite } from './construction.ts';
import type { Point } from './movement.ts';
import { BUILDINGS, GRID_SIZE, MAP_SIZE, POND } from './world-data.ts';
import { FARM_PLOTS, RESOURCE_NODES } from './economy-config.ts';
import { ellipsoid, tintHeight } from './environment-shapes.ts';

type Footprint = Pick<BuildingSite, 'x' | 'z' | 'width' | 'depth'>;
type Plant = Point & { size: number; rotation: number; flower: boolean };
const CHUNK_SIZE = 12, SPACING = 1.8, MARGIN = .42;
const inFootprint = (p: Point, b: Footprint) => Math.abs(p.x - b.x) < b.width / 2 + MARGIN && Math.abs(p.z - b.z) < b.depth / 2 + MARGIN;
function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

/** Shared native thin instances: rounded silhouettes, one draw per visible
 * patch/type, no individual meshes, animation callbacks or shadow-map draws. */
export function createGroundCover(scene: Scene, roads: { paths: Point[][]; roadHalfWidth: number }) {
  const material = new StandardMaterial('meadow-plants', scene);
  material.diffuseColor = Color3.White(); material.specularColor = Color3.Black();
  function template(flower: boolean) {
    const parts: Mesh[] = [];
    if (flower) {
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5;
        const petal = ellipsoid(scene, 'meadow-petal', [.18, .085, .26], [Math.sin(angle) * .14, .13, Math.cos(angle) * .14], material, 4);
        petal.rotation.y = angle; tintHeight(petal, '#e8dfb3', '#fff9e6'); parts.push(petal);
      }
      const center = ellipsoid(scene, 'meadow-pollen', [.16, .10, .16], [0, .18, 0], material, 4);
      tintHeight(center, '#d18a28', '#ffd75c'); parts.push(center);
    } else {
      for (let i = 0; i < 4; i++) {
        const blade = ellipsoid(scene, 'meadow-blade', [.14, .34 + i % 2 * .16, .08], [(i - 1.5) * .07, .16, Math.sin(i * 2) * .06], material, 2);
        blade.rotation.z = (i - 1.5) * -.30;
        tintHeight(blade, '#4b8638', i % 2 ? '#bad764' : '#95bd49'); parts.push(blade);
      }
    }
    const mesh = Mesh.MergeMeshes(parts, true, true)!;
    mesh.name = flower ? 'meadow-flower-template' : 'meadow-grass-template';
    mesh.isPickable = false; mesh.setEnabled(false);
    return mesh;
  }
  const templates = [template(false), template(true)];
  const chunks = new Map<string, { mesh: Mesh; plants: Plant[]; visible?: Plant[] }>();
  const footprints: Footprint[] = [...BUILDINGS, ...FARM_PLOTS.map(p => ({ ...p, width: GRID_SIZE, depth: GRID_SIZE }))];
  const segments = roads.paths.flatMap(points => points.slice(1).map((b, i) => [points[i], b] as const));
  let seed = 19331;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let z = -MAP_SIZE / 2 + SPACING; z < MAP_SIZE / 2 - SPACING; z += SPACING) {
    for (let x = -MAP_SIZE / 2 + SPACING; x < MAP_SIZE / 2 - SPACING; x += SPACING) {
      const plant: Plant = { x: x + (random() - .5) * SPACING * .9, z: z + (random() - .5) * SPACING * .9,
        size: .65 + random() * .5, rotation: random() * Math.PI * 2, flower: random() < .30 };
      if (random() < .22 || footprints.some(b => inFootprint(plant, b))
        || Math.hypot(plant.x - POND.x, plant.z - POND.z) < POND.radius + .9
        || RESOURCE_NODES.some(n => Math.hypot(plant.x - n.x, plant.z - n.z) < n.radius + MARGIN)
        || segments.some(([a, b]) => distanceToSegment(plant, a, b) < roads.roadHalfWidth + MARGIN)) continue;
      const cx = Math.floor(plant.x / CHUNK_SIZE), cz = Math.floor(plant.z / CHUNK_SIZE);
      const key = `${cx},${cz}:${plant.flower ? 'flowers' : 'grass'}`;
      let chunk = chunks.get(key);
      if (!chunk) {
        const mesh = new Mesh(`meadow-cover-${key}`, scene);
        // Babylon attaches instance attributes to Geometry. Patches need their
        // own native geometry copy or the last patch's matrices replace all
        // earlier buffers; every plant inside a patch still shares one mesh.
        templates[Number(plant.flower)].geometry!.copy(mesh.name).applyToMesh(mesh); mesh.material = material;
        mesh.position.set(cx * CHUNK_SIZE, .025, cz * CHUNK_SIZE);
        mesh.isPickable = false; mesh.receiveShadows = true;
        mesh.freezeWorldMatrix();
        chunk = { mesh, plants: [] }; chunks.set(key, chunk);
      }
      chunk.plants.push(plant);
    }
  }
  let footprintKey: string | undefined;
  function sync(sites: readonly Footprint[]) {
    const key = sites.map(s => `${s.x},${s.z},${s.width},${s.depth}`).join(';');
    if (key === footprintKey) return;
    footprintKey = key;
    for (const chunk of chunks.values()) {
      const visible = chunk.plants.filter(p => !sites.some(site => inFootprint(p, site)));
      if (chunk.visible?.length === visible.length && visible.every((p, i) => p === chunk.visible![i])) continue;
      const matrices = new Float32Array(visible.length * 16);
      for (const [i, p] of visible.entries()) Matrix.Compose(new Vector3(p.size, p.size, p.size),
        Quaternion.RotationAxis(Vector3.Up(), p.rotation), new Vector3(p.x - chunk.mesh.position.x, 0, p.z - chunk.mesh.position.z)).copyToArray(matrices, i * 16);
      chunk.mesh.setEnabled(visible.length > 0);
      if (visible.length) {
        chunk.mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
        chunk.mesh.thinInstanceRefreshBoundingInfo();
        // Native screen-coverage LOD drops subpixel geometry in the map
        // overview; the leaf texture remains visible and needs only one plane.
        if (!chunk.mesh.getLODLevels().length) {
          chunk.mesh.useLODScreenCoverage = true;
          const radius = chunk.mesh.getBoundingInfo().boundingSphere.radiusWorld;
          chunk.mesh.addLODLevel(Math.PI * radius * radius / (90 * 90), null);
        }
      }
      chunk.visible = visible;
    }
  }
  return { sync };
}
