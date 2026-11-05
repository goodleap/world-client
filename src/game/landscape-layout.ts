import { createLandforms } from './map-landforms.ts';
import { Curve3 } from '@babylonjs/core/Maths/math.path.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure.js';
import { polygonDistance } from './polygon.ts';
import type { Point } from './movement.ts';

import { MAP_CONFIG, ROUTE_LAYOUT, createRegions, pathDistanceSquared } from './map-regions.ts';

import { createMapLandmarks } from './map-landmarks.ts';
import { isBlocked } from './movement.ts';
import { createMapWater } from './map-water.ts';
import { treeCanopyRadius, treeCollisionRadius } from './tree-profile.ts';
import { createResourceDressing } from './landscape-dressing.ts';
import type { TreeSpecies, TreeSize } from './tree-profile.ts';
export const LANDSCAPE_SEED = MAP_CONFIG.seed;
export function seededRandom(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

export function createCurvedRoadPaths(roads: readonly Point[][], gridSize: number, spacing = gridSize) {
  return roads.map(road => {
    const point = (p: Point) => new Vector3(p.x, 0, p.z);
    const points = [point(road[0])];
    for (let i = 1; i < road.length; i++) {
      const control = point(road[i - 1]), end = Vector3.Center(control, point(road[i]));
      const start = points.at(-1)!;
      const samples = Math.max(4, Math.ceil((Vector3.Distance(start, control) + Vector3.Distance(control, end)) / spacing));
      points.push(...Curve3.CreateQuadraticBezier(start, control, end, samples).getPoints().slice(1));
    }
    points.push(point(road.at(-1)!));
    return points;
  });
}

/** Region graph authored from the user's clearing/corridor reference. */
export function createLandscapeLayout(gridPoint: (x: number, z: number) => Point, gridSize: number, seed: number = LANDSCAPE_SEED) {
  const random = seededRandom(seed), local = (x: number, z: number) => ({ x: x * gridSize, z: z * gridSize });
  const roadControls = ROUTE_LAYOUT.map(route => route.map(([x, z]) => local(x, z)));
  const paths = createCurvedRoadPaths(roadControls, gridSize, gridSize * 1.5);
  const landmarks = createMapLandmarks(gridSize);
  const geography = createLandforms(gridSize,paths);
  const water = createMapWater(gridSize, paths);
  const terrain = createRegions(gridSize, paths, water.water, water.waterSolidPolygons,geography);
  type Tree = Point & { size: TreeSize; scale: number; tone: number; rotation: number; species: TreeSpecies };
  type Rock = Point & { scale: number; rotation: number };
  const trees: Tree[] = [{ ...gridPoint(MAP_CONFIG.columns / 2 - 6, MAP_CONFIG.rows / 2 - 5), size:'small', scale: 1, tone: 0, species: 'oak', rotation: .7 }, { ...gridPoint(MAP_CONFIG.columns / 2 - 7, MAP_CONFIG.rows / 2 + 3), size:'small', scale: 1, tone: 1, species: 'sapling', rotation: 2.3 }];
  const rocks: Rock[] = [{ ...gridPoint(MAP_CONFIG.columns / 2 + 9, MAP_CONFIG.rows / 2 + 6), scale: 1, rotation: .5 }, { ...gridPoint(MAP_CONFIG.columns / 2 - 10, MAP_CONFIG.rows / 2 - 4), scale: 1.2, rotation: 2.1 }];
  const iron: Rock[] = [], forage: Rock[] = [];
  const roadDistance = (p: Point) => Math.sqrt(Math.min(...paths.flatMap(path => path.slice(1).map((b, i) => pathDistanceSquared(p, path[i], b)))));
  const placementSolids=[...landmarks.obstacles,...terrain.obstacles.map(a=>({kind:'polygon' as const,...a})),...water.waterSolids.map(a=>({kind:'polygon' as const,...a}))];
  const crowded = (p: Point) => [...trees, ...rocks, ...iron, ...forage].some(t => Math.hypot(p.x - t.x, p.z - t.z) < 3.25);
  const treeSpecies = (biome: string): TreeSpecies => biome === 'conifers' || biome === 'rock' || biome === 'camp' ? 'pine' : biome === 'orchard' ? (random() < .8 ? 'fruit' : 'blossom') : biome === 'meadow' ? 'blossom' : biome === 'wetland' || biome === 'lake' ? 'sapling' : random() < .28 ? 'sapling' : 'oak';
  for (const region of terrain.regions) {
    const count = region.id === 'home' ? 9 : ['woodland','conifers'].includes(region.id) ? 22 : region.id === 'orchard' ? 26 : region.id === 'quarry' ? 24 : region.id === 'pass' ? 9 : 7;
    for (let placed = 0, attempt = 0; placed < count && attempt < 2000; attempt++) {
      const cluster=attempt%3;
      const a = cluster*Math.PI*2/3 + (random()-.5)*1.9, r = .18 + random() * .7;
      const point = region.id==='orchard'&&attempt<36?local(8+(attempt%6)*3,-16-Math.floor(attempt/6)*2.8):{ x: region.x + Math.cos(a) * region.rx * gridSize * r, z: region.z + Math.sin(a) * region.rz * gridSize * r };
      if (region.id === 'home' && point.x > -14 && point.x < 17 && point.z > -15 && point.z < 11 || roadDistance(point) < 3.0 || crowded(point)) continue;
      if (Math.max(...[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dz])=>Math.abs(geography.heightAt(point.x+dx,point.z+dz)-geography.heightAt(point.x,point.z))))>.45 || isBlocked(point, 1.6, placementSolids) || polygonDistance(point, region.area) > -2.6 || !terrain.contains(point) || water.waterAreas.some(a => polygonDistance(point,a) < 2.4)) continue;
      const common = { ...point, scale: .9 + random() * .4, rotation: random() * Math.PI * 2 };
      if (region.id === 'quarry' && placed % 2 === 0 || region.id === 'pass' && placed % 3 === 0) iron.push(common);
      else if (region.id === 'orchard' && placed % 4 === 0 || region.id === 'woodland' && placed % 4 === 0 || region.id === 'home' && placed === 0) forage.push({ ...common, scale: 1 });
      else if (region.id === 'quarry' || region.id === 'stone-hollow' || placed % 4 === 2) rocks.push(common);
      else trees.push({ ...common, size:'small', scale: 1, tone: Math.floor(random() * 3), species: treeSpecies(region.biome) });
      placed++;
    }
  }
  // Ordinary woodland trees are individual renewable resources, with room
  // for workers between trunks. Permanent barriers belong to landforms only.
  const occupied=(p:Point)=>trees.some(t=>Math.hypot(p.x-t.x,p.z-t.z)<gridSize*1.2)
    || [...rocks,...iron,...forage].some(n=>Math.hypot(p.x-n.x,p.z-n.z)<n.scale*.85+1);
  for(const patch of geography.forests){
    const b=patch.area.bounds,spacing=gridSize*1.5;
    let row=0;
    for(let z=b.minZ;z<b.maxZ;z+=spacing*.86,row++)for(let x=b.minX+(row%2)*spacing/2;x<b.maxX;x+=spacing){
      const point={x:x+(random()-.5)*spacing*.28,z:z+(random()-.5)*spacing*.28};
      const edge=polygonDistance(point,patch.area);
      if(edge>-.6||roadDistance(point)<3||occupied(point)||isBlocked(point,.95,placementSolids)||!terrain.contains(point))continue;
      const slope=Math.max(...[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dz])=>Math.abs(geography.heightAt(point.x+dx,point.z+dz)-geography.heightAt(point.x,point.z))));
      if(slope>.45)continue;
      const species=patch.species==='oak'&&edge>-2.5?'sapling':patch.species==='fruit'&&random()<.2?'blossom':patch.species;
      random(); // Preserve the existing layout's random sequence and resource IDs.
      trees.push({...point,size:'small',scale:1,tone:Math.floor(random()*3),species,rotation:random()*Math.PI*2});
    }
  }
  // Choose from three authored silhouettes, retaining the existing resource
  // positions. Crowns may touch lightly; trunks and access paths remain clear.
  const sizes=seededRandom(seed^0x53a67b);
  for(const [i,tree] of trees.entries()){
    const choice=sizes(),preferred:TreeSize=i===0?'medium':tree.species==='sapling'?(choice<.75?'small':'medium'):choice<.2?'small':choice<.7?'medium':'large';
    const candidates:TreeSize[]=preferred==='large'?['large','medium','small']:preferred==='medium'?['medium','small']:['small'];
    for(const size of candidates){
      const radius=treeCanopyRadius({...tree,size},gridSize);
      if(isBlocked(tree,radius+.05,placementSolids))continue;
      if(trees.some(other=>other!==tree&&Math.hypot(tree.x-other.x,tree.z-other.z)<radius+treeCanopyRadius(other,gridSize)-gridSize*.15))continue;
      tree.size=size;break;
    }
  }
  const dressing=createResourceDressing(geography,water.waterAreas,terrain.contains,placementSolids,
    [...trees.map(t=>({...t,radius:treeCollisionRadius(t,gridSize)})),...rocks.map(n=>({...n,radius:n.scale*.85})),
      ...iron.map(n=>({...n,radius:n.scale*.85})),...forage.map(n=>({...n,radius:n.scale*.65}))],seededRandom(seed^0x43b9));
  rocks.push(...dressing.rocks);forage.push(...dressing.forage);
  return { seed, geography, ...water, trees, rocks, iron, forage, decorations:dressing.decorations, roadControls, ...terrain };
}
