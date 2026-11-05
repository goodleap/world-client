import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { BuildingSite } from './construction.ts';
import type { Point } from './movement.ts';
import { BUILDINGS, GRID_SIZE, MAP_WIDTH, MAP_DEPTH, LANDSCAPE } from './world-data.ts';
import { FARM_PLOTS, RESOURCE_NODES } from './economy-config.ts';
import type { EnvironmentLibrary } from './environment-library.ts';
import { surfaceHeight } from './terrain-height.ts';
import { polygonDistance } from './polygon.ts';
import { nearRoad } from './road-layout.ts';

type Footprint = Pick<BuildingSite, 'x' | 'z' | 'width' | 'depth'>;
type Plant = Point & { size: number; rotation: number; flower: boolean; variant:number };
const CHUNK_SIZE = 12, SPACING = 1.8, MARGIN = .42;
const inFootprint = (p: Point, b: Footprint) => Math.abs(p.x - b.x) < b.width / 2 + MARGIN && Math.abs(p.z - b.z) < b.depth / 2 + MARGIN;
/** Shared native thin instances: rounded silhouettes, one draw per visible
 * patch/type, no individual meshes, animation callbacks or shadow-map draws. */
export function createGroundCover(scene: Scene, environment:Pick<EnvironmentLibrary,'source'>) {
  const templates=[environment.source('grass','far'),...(['flowers','flowers-cream','flowers-lilac'] as const).map(a=>environment.source(a,'medium'))];
  const chunks = new Map<string, { mesh: Mesh; plants: Plant[]; visible?: Plant[] }>();
  const footprints: Footprint[] = [...BUILDINGS, ...FARM_PLOTS.map(p => ({ ...p, width: GRID_SIZE, depth: GRID_SIZE }))];
  let seed = 19331;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let z = -MAP_DEPTH / 2 + SPACING; z < MAP_DEPTH / 2 - SPACING; z += SPACING) {
    for (let x = -MAP_WIDTH / 2 + SPACING; x < MAP_WIDTH / 2 - SPACING; x += SPACING) {
      const plant: Plant = { x: x + (random() - .5) * SPACING * .9, z: z + (random() - .5) * SPACING * .9,
        size: .45 + random() * .5, rotation: random() * Math.PI * 2, flower: false, variant:0 };
      const region=LANDSCAPE.regions.reduce((a,b)=>Math.hypot((plant.x-a.x)/a.rx,(plant.z-a.z)/a.rz)<Math.hypot((plant.x-b.x)/b.rx,(plant.z-b.z)/b.rz)?a:b);
      const drift=Math.max(0,Math.sin(plant.x*.24+plant.z*.1)*Math.cos(plant.z*.29));
      const meadow=region.biome==='meadow',grove=region.biome==='orchard',rocky=region.biome==='rock'||region.biome==='camp';
      plant.flower=random()<(meadow?.6:grove?.3:.08);
      if(plant.flower){plant.size*=1.25;plant.variant=1+(Math.abs(Math.floor(plant.x/8)+Math.floor(plant.z/8)*7)%3);}
      if(random()>(rocky?.1:meadow?.45:grove?.28:.18)+drift*(meadow?.5:.25))continue;
      if (!LANDSCAPE.geography.inside(plant) || Math.abs(surfaceHeight(plant.x+1,plant.z)-surfaceHeight(plant.x-1,plant.z))+Math.abs(surfaceHeight(plant.x,plant.z+1)-surfaceHeight(plant.x,plant.z-1))>1.2 || random() < .12 || footprints.some(b => inFootprint(plant, b))
        || LANDSCAPE.waterAreas.some(a=>polygonDistance(plant,a)<.8)
        || RESOURCE_NODES.some(n => Math.hypot(plant.x - n.x, plant.z - n.z) < n.radius + MARGIN)
        || nearRoad(plant, (plant.flower?.65:.6)*plant.size+.16)) continue;
      const cx = Math.floor(plant.x / CHUNK_SIZE), cz = Math.floor(plant.z / CHUNK_SIZE);
      const key = `${cx},${cz}:${plant.variant}`;
      let chunk = chunks.get(key);
      if (!chunk) {
        const mesh = new Mesh(`meadow-cover-${key}`, scene);
        // Babylon attaches instance attributes to Geometry. Patches need their
        // own native geometry copy or the last patch's matrices replace all
        // earlier buffers; every plant inside a patch still shares one mesh.
        templates[plant.variant].geometry!.copy(mesh.name).applyToMesh(mesh); mesh.material = templates[plant.variant].material;
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
        Quaternion.RotationAxis(Vector3.Up(), p.rotation), new Vector3(p.x - chunk.mesh.position.x, surfaceHeight(p.x,p.z), p.z - chunk.mesh.position.z)).copyToArray(matrices, i * 16);
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
