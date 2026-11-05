import { createTowerModel } from './tower-model.ts';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import '@babylonjs/core/Meshes/instancedMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { Palette } from './models.ts';
import type { Obstacle, Point } from './movement.ts';
import type { WorldObject } from './world-selection.ts';
import type { Economy } from './economy.ts';
import { RESOURCE_NAMES } from './economy.ts';
import { createCropModel } from './crop-model.ts';
import { createGroundGoodsModel, groundGoodsKind } from './ground-goods-model.ts';
import { ECONOMY_CONFIG as C, RESOURCE_NODES, economyObstacles } from './economy-config.ts';
import { TREES, GRID_SIZE, BUILDINGS } from './world-data.ts';
import { treeModelScale, treeName } from './tree-profile.ts';
import type { EnvironmentLibrary } from './environment-library.ts';
import { surfaceHeight } from './terrain-height.ts';
import { BUILDING_TYPES } from './construction.ts';
import { referenceHouse } from './buildings.ts';
import { roundedBox } from './environment-shapes.ts';
import { createLandscapeRock, createLandscapeRockMaterial } from './landscape-rock.ts';
import type { CampfireView } from './campfire-view.ts';
import { CAMPFIRE_SHAPE } from './campfire-shape.ts';
import type { BuildingDoors } from './building-doors.ts';
import { attachBuildingLOD } from './building-lod.ts';
import { createBuildingPicking } from './picking-shapes.ts';
import { createFarmModel, farmGridKey, farmNeighbourMask } from './farm-model.ts';

/** Mutable objects use Babylon instances. Removing one tree/crop leaves the
 * shared geometry, other instances and static scenery batches intact. */
export function createEconomyWorld(scene: Scene, p: Palette, shadows: ShadowGenerator, economy: Economy, objects: Map<string, WorldObject>, doors: BuildingDoors, fires: CampfireView, environment: EnvironmentLibrary) {
  const templates = new Map<string, Mesh[]>();
  const instances = new Map<string, { state: string; meshes: AbstractMesh[] }>();
  const rockMaterial = createLandscapeRockMaterial(scene);
  const carrot = new StandardMaterial('carrot-orange', scene);
  carrot.diffuseColor = Color3.FromHexString('#f28328'); carrot.specularColor = Color3.Black();
  function template(name: string, build: () => void): Mesh[] {
    const cached = templates.get(name); if (cached) return cached;
    const first = scene.meshes.length; build();
    const groups = new Map<NonNullable<Mesh['material']>, Mesh[]>();
    for (const mesh of scene.meshes.slice(first)) if (mesh instanceof Mesh && mesh.material) {
      if (!mesh.isVerticesDataPresent(VertexBuffer.ColorKind)) mesh.setVerticesData(VertexBuffer.ColorKind, new Float32Array(mesh.getTotalVertices() * 4).fill(1));
      if (!mesh.isVerticesDataPresent(VertexBuffer.UVKind)) mesh.setVerticesData(VertexBuffer.UVKind, new Float32Array(mesh.getTotalVertices() * 2));
      mesh.computeWorldMatrix(true);
      const group = groups.get(mesh.material) ?? []; group.push(mesh); groups.set(mesh.material, group);
    }
    const sources = [...groups.values()].map(parts => {
      const source = parts.length === 1 ? parts[0] : Mesh.MergeMeshes(parts, true, true)!;
      source.bakeCurrentTransformIntoVertices();
      source.name = `economy-template-${name}-${source.material!.name}`;
      // Keep the source enabled for Babylon's instance renderer, but hide its
      // own draw. Each live instance owns picking and caster membership.
      source.isVisible = false; source.isPickable = false; source.receiveShadows = true;
      source.freezeWorldMatrix(); source.material?.freeze();
      return source;
    });
    templates.set(name, sources); return sources;
  }
  function remove(id: string) {
    doors.remove(id); fires.remove(id);
    for (const mesh of instances.get(id)?.meshes ?? []) { shadows.removeShadowCaster(mesh, false); mesh.dispose(); }
    instances.delete(id); objects.delete(id);
  }
  function show(object: WorldObject, state: string, sources: () => Mesh[], scale = 1, rotation = 0, elevation = 0) {
    const ground=surfaceHeight(object.x,object.z);
    object.anchor.y+=ground;if(object.markerY!==undefined)object.markerY+=ground;
    object.labelAnchor=objects.get(object.id)?.labelAnchor;
    objects.set(object.id, object);
    if (instances.get(object.id)?.state === state) return;
    remove(object.id); objects.set(object.id, object);
    const meshes:AbstractMesh[] = sources().map(source => {
      const mesh = source.createInstance(object.id + '-' + source.name);
      mesh.position.set(object.x, elevation+ground, object.z); mesh.scaling.setAll(scale);
      mesh.rotation.y = rotation;
      mesh.metadata = { worldObjectId: object.id }; mesh.isPickable = true; mesh.receiveShadows = true;
      // Flat soil/grass beds still receive shadows. Casting these shallow
      // surfaces into a map-wide shadow atlas causes diagonal self-shadow acne.
      if (source.getBoundingInfo().boundingBox.maximum.y * scale > .24) shadows.addShadowCaster(mesh, false);
      mesh.freezeWorldMatrix(); return mesh;
    });
    if(object.kind==='building'||object.kind==='site'){
      const hit=createBuildingPicking(scene,object.id,meshes);
      if(hit){const box=hit.getBoundingInfo().boundingBox;object.labelAnchor={x:object.x,y:box.maximumWorld.y+.15,z:box.maximumWorld.z};meshes.push(hit);}
    }
    instances.set(object.id, { state, meshes });
  }
  function cropTemplate(kind: 'carrot' | 'wheat', stage: number) {
    return template(`${kind}-${stage}`, () => {
      const first=scene.meshes.length;
      createCropModel(scene,p,carrot,kind,stage);
      // Keep the original single crop and all growth-stage dimensions. Only
      // raise its roots from the former .10 soil level to the new .19 bed.
      for(const mesh of scene.meshes.slice(first))mesh.position.y+=.09;
    });
  }
  function houseTemplate(site: Parameters<typeof referenceHouse>[2], name: string) {
    const cached = templates.get(name); if (cached) return cached;
    const definition = { ...site, x: 0, z: 0 };
    const sources = template(name, () => referenceHouse(scene, p, definition, false));
    attachBuildingLOD(scene, sources, detail => referenceHouse(scene, p, definition, false, detail));
    return sources;
  }
  let lastRevision = -1;
  let obstacles: Obstacle[] = [];
  let obstaclesWithFields: Obstacle[] = [];
  function sync() {
    if (lastRevision === economy.revision) return false;
    lastRevision = economy.revision;
    for (const node of RESOURCE_NODES) {
      if (economy.state.depleted.includes(node.id)) { remove(node.id); continue; }
      if (node.kind === 'wood') {
        const tree = TREES[Number(node.id.slice(5))];
        const sources=environment.tree(tree.species,tree.size,tree.tone),scale=GRID_SIZE*tree.scale*treeModelScale(tree.species,tree.size);
        show({ id: node.id, kind: 'tree', name: treeName(tree.species), x: tree.x, z: tree.z, radius: node.canopyRadius,
          anchor: { x: tree.x, y: Math.max(...sources.map(s=>s.getBoundingInfo().boundingBox.maximum.y))*scale, z: tree.z - .45 * tree.scale } }, 'tree',
        () => sources, scale, tree.rotation);
      } else if (node.kind === 'food') {
        show({ id: node.id, kind: 'rock', name: '林间果丛', x: node.x, z: node.z, radius: .9,
          anchor: { x: node.x, y: 1.1, z: node.z } }, 'forage', () => [environment.source('bush')], node.scale*.7, node.rotation);
      } else show({ id: node.id, kind: 'rock', name: node.kind === 'iron' ? '铁矿' : '石材', x: node.x, z: node.z, radius: .75 * node.scale,
        anchor: { x: node.x, y: .9, z: node.z } }, node.kind, () => node.kind==='stone' ? [environment.source('stone')] : template(node.kind, () => {
        createLandscapeRock(scene, rockMaterial, true);
      }), node.kind==='stone'?node.scale*.63:node.scale, node.rotation);
    }
    for (const id of instances.keys()) if (id.startsWith('plot-') && !economy.plot(id)) remove(id);
    const tilled = new Set(economy.state.plots.filter(plot => plot.tilled).map(farmGridKey));
    for (const plot of economy.state.plots) {
      const neighbours = plot.tilled ? farmNeighbourMask(plot, tilled) : 0;
      const definition = plot;
      const mature = !!plot.crop && plot.growth >= C.crops[plot.crop].growthSeconds;
      const stage = mature ? 2 : plot.crop && plot.growth >= C.crops[plot.crop].growthSeconds / 3 ? 1 : 0;
      const name = plot.crop ? C.crops[plot.crop].name : plot.tilled ? '耕地' : '待开垦土地';
      const object: WorldObject = { ...definition, kind: plot.crop ? 'crop' : 'plot', name, radius: GRID_SIZE / 2, width: GRID_SIZE, depth: GRID_SIZE,
        markerY: plot.tilled ? .20 : .12, anchor: { x: definition.x, y: plot.crop ? .5 : plot.tilled ? .20 : .12, z: definition.z } };
      show(object, `${plot.tilled}-${neighbours}-${plot.crop}-${stage}-${mature}`, () => {
        const soil = template(plot.tilled ? `tilled-${neighbours}` : 'untilled', () => {
          if (plot.tilled) createFarmModel(scene, p, neighbours);
          else roundedBox(scene, 'farm-cell', [GRID_SIZE - .06, .10, GRID_SIZE - .06], [0, .055, 0], p.grass, .08);
        });
        return plot.crop ? [...soil, ...cropTemplate(plot.crop, stage)] : soil;
      });
    }
    for (const id of instances.keys()) if (id.startsWith('goods-') && !economy.state.goods.some(g => g.id === id && g.state === 'ground')) remove(id);
    for (const goods of economy.state.goods) if (goods.state === 'ground') {
      const kind = groundGoodsKind(goods), name = goods.crop ? C.crops[goods.crop].name : RESOURCE_NAMES[goods.resource];
      const elevation = economy.state.plots.some(plot => Math.abs(plot.x-goods.x) < GRID_SIZE/2 && Math.abs(plot.z-goods.z) < GRID_SIZE/2) ? .20 : 0;
      show({ ...goods, kind: 'goods', name: `待入库${name}`, radius: .55, anchor: { x: goods.x, y: elevation+.5, z: goods.z } }, `${kind}-${goods.x}-${goods.z}-${elevation}`,
        () => template('goods-' + kind, () => createGroundGoodsModel(scene, p, carrot, rockMaterial, goods)), 1, 0, elevation);
    }
    for (const id of instances.keys()) if (id.startsWith('site-') && !economy.state.sites.some(s => s.id === id)) remove(id);
    for (const site of economy.state.sites) {
      const built = economy.state.buildings.includes(site.id), task = economy.taskFor(site.id);
      const state = built ? 'built' : task ? 'construction' : 'site';
      if (built && site.kind === 'campfire') {
        if (instances.get(site.id)?.state !== 'built') { remove(site.id); instances.set(site.id, { state: 'built', meshes: [] }); fires.add(site); }
        objects.set(site.id, { id: site.id, x: site.x, z: site.z, kind: 'building', name: '火堆', radius: CAMPFIRE_SHAPE.radius, anchor: { x: site.x, y: surfaceHeight(site.x,site.z)+1.6, z: site.z } });
        continue;
      }
      show({ ...site, kind: built ? 'building' : 'site', name: built ? BUILDING_TYPES[site.kind].name : `${BUILDING_TYPES[site.kind].name}用地`, radius: site.width / 2,
        markerY: .12, anchor: { x: site.x + (built ? 0 : site.width * .25), y: built ? site.kind==='tower'?site.height:1.2 : .2, z: built ? site.z - site.depth / 2 : site.z + site.depth * .15 } }, state,
      () => built && site.kind !== 'tower' ? houseTemplate({ ...site, id: site.kind }, `${site.kind}-${state}`) : template(`${site.kind}-${state}`, () => {
        if(built&&site.kind==='tower'){createTowerModel(scene,p);return;}
        if (built) { referenceHouse(scene, p, { ...site, id: site.kind, x: 0, z: 0 }, false); return; }
        roundedBox(scene, 'building-footprint', [site.width, .07, site.depth], [0, .035, 0], p.pathLight, .08);
        for (const x of [-site.width / 2, site.width / 2]) for (const z of [-site.depth / 2, site.depth / 2]) {
          roundedBox(scene, 'layout-stake', [.12, task ? .9 : .3, .12], [x, task ? .45 : .15, z], p.timberLight, .03);
        }
        if (task) for (let i = 0; i < 3; i++) roundedBox(scene, 'construction-timber', [1.25, .16, .21], [-.2, .16 + i * .16, .25], p.timber, .035);
      }));
      if (built&&site.kind!=='tower') doors.add(site, site.kind === 'warehouse');
    }
    obstacles = economyObstacles(economy.state.depleted, economy.state.sites, economy.state.buildings);
    obstaclesWithFields = [...obstacles, ...economy.state.plots.map(plot => ({
      kind: 'box' as const, x: plot.x, z: plot.z, halfWidth: GRID_SIZE / 2, halfDepth: GRID_SIZE / 2,
    }))];
    return true;
  }
  function workPoints(target: string, from?: Point, repair=false): { points: Point[]; target: Point } | undefined {
    if (target === 'warehouse'&&!repair) {
      const doors = economy.warehouseDoors().sort((a, b) => from ? Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z) : 0);
      if(!doors.length)return;
      return { target: doors[0], points: doors.flatMap(door => [door, { x: door.x - .8, z: door.z }, { x: door.x + .8, z: door.z }]) };
    }
    const goods = economy.state.goods.find(g => g.id === target);
    if (goods) return { target: goods, points: [{ x: goods.x, z: goods.z }] };
    const plot = economy.plot(target), node = RESOURCE_NODES.find(n => n.id === target), site = economy.state.sites.find(s => s.id === target)??(repair?BUILDINGS.find(b=>b.id===target):undefined);
    const source = plot ?? node ?? site; if (!source) return;
    if (site) return { target: site, points: [
      { x: site.x, z: site.z - site.depth / 2 - .65 }, { x: site.x - site.width / 2 - .65, z: site.z },
      { x: site.x + site.width / 2 + .65, z: site.z }, { x: site.x, z: site.z + site.depth / 2 + .65 },
    ] };
    const distance = node ? node.radius + .65 : GRID_SIZE / 2 + .12;
    return { target: source, points: Array.from({ length: 8 }, (_, i) => ({ x: source.x + Math.sin(i * Math.PI / 4) * distance, z: source.z + Math.cos(i * Math.PI / 4) * distance })) };
  }
  sync();
  return { sync, obstacles: (avoidFields = false): readonly Obstacle[] => avoidFields ? obstaclesWithFields : obstacles, workPoints };
}
