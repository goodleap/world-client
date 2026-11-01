import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import '@babylonjs/core/Meshes/instancedMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { Palette } from './models.ts';
import type { Obstacle, Point } from './movement.ts';
import type { WorldObject } from './world-selection.ts';
import type { Economy } from './economy.ts';
import { ECONOMY_CONFIG as C, RESOURCE_NODES, economyObstacles } from './economy-config.ts';
import { TREES, GRID_SIZE } from './world-data.ts';
import { attachTreeLOD, createReferenceTree, createTreeMaterials } from './tree.ts';
import { BUILDING_TYPES } from './construction.ts';
import { referenceHouse } from './buildings.ts';
import { ellipsoid, roundedBox, tintHeight } from './environment-shapes.ts';
import { createLandscapeRock, createLandscapeRockMaterial } from './landscape-rock.ts';
import type { CampfireView } from './campfire-view.ts';
import { CAMPFIRE_SHAPE } from './campfire-shape.ts';
import type { BuildingDoors } from './building-doors.ts';

/** Mutable objects use Babylon instances. Removing one tree/crop leaves the
 * shared geometry, other instances and static scenery batches intact. */
export function createEconomyWorld(scene: Scene, p: Palette, shadows: ShadowGenerator, economy: Economy, objects: Map<string, WorldObject>, doors: BuildingDoors, fires: CampfireView) {
  const templates = new Map<string, Mesh[]>();
  const instances = new Map<string, { state: string; meshes: AbstractMesh[] }>();
  const treeMaterials = createTreeMaterials(scene);
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
      return source;
    });
    templates.set(name, sources); return sources;
  }
  function treeTemplate(tone: number) {
    const name = 'tree-' + tone, cached = templates.get(name);
    if (cached) return cached;
    const levels = (['near', 'medium', 'far'] as const).map(detail => template(detail === 'near' ? name : `${name}-${detail}`,
      () => { createReferenceTree(scene, treeMaterials, 0, 0, 1, tone, detail); }));
    for (const source of levels[0]) attachTreeLOD(source,
      levels[1].find(mesh => mesh.material === source.material)!, levels[2].find(mesh => mesh.material === source.material)!);
    return levels[0];
  }
  function remove(id: string) {
    doors.remove(id); fires.remove(id);
    for (const mesh of instances.get(id)?.meshes ?? []) { shadows.removeShadowCaster(mesh, false); mesh.dispose(); }
    instances.delete(id); objects.delete(id);
  }
  function show(object: WorldObject, state: string, sources: () => Mesh[], scale = 1, rotation = 0) {
    objects.set(object.id, object);
    if (instances.get(object.id)?.state === state) return;
    remove(object.id); objects.set(object.id, object);
    const meshes = sources().map(source => {
      const mesh = source.createInstance(object.id + '-' + source.name);
      mesh.position.set(object.x, 0, object.z); mesh.scaling.setAll(scale);
      mesh.rotation.y = rotation;
      mesh.metadata = { worldObjectId: object.id }; mesh.isPickable = true; mesh.receiveShadows = true;
      // Flat soil/grass beds still receive shadows. Casting these shallow
      // surfaces into a map-wide shadow atlas causes diagonal self-shadow acne.
      if (source.getBoundingInfo().boundingBox.maximum.y * scale > .24) shadows.addShadowCaster(mesh, false);
      mesh.computeWorldMatrix(true); return mesh;
    });
    instances.set(object.id, { state, meshes });
  }
  function cropTemplate(kind: 'carrot' | 'wheat', stage: number) {
    return template(`${kind}-${stage}`, () => {
      const size = [.35, .65, 1][stage];
      if (kind === 'carrot') {
        ellipsoid(scene, 'carrot', [.37 * size, .4 * size, .37 * size], [0, .10 + .16 * size, 0], carrot, 12);
        for (let i = -1; i <= 1; i++) {
          const leaf = ellipsoid(scene, 'carrot-leaf', [.19 * size, .5 * size, .14 * size], [i * .13 * size, .10 + .51 * size, 0], i % 2 ? p.leaf : p.leafLight, 12);
          leaf.rotation.z = i * -.5; tintHeight(leaf, '#539d54', '#ffffff');
        }
      } else for (let i = -1; i <= 1; i++) {
        const stem = MeshBuilder.CreateCylinder('wheat-stem', { height: .65 * size, diameter: .035, tessellation: 8 }, scene);
        stem.position.set(i * .15 * size, .10 + .325 * size, 0); stem.material = p.leafLight;
        for (let k = 0; k < 3; k++) {
          const ear = ellipsoid(scene, 'wheat-ear', [.13 * size, .21 * size, .13 * size], [(i * .15 + (k % 2 - .5) * .07) * size, .10 + (.60 + k * .1) * size, 0], stage < 2 ? p.leafLight : k % 2 ? p.golden : p.linen, 12);
          ear.rotation.z = (k % 2 - .5) * .7;
        }
      }
    });
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
        show({ id: node.id, kind: 'tree', name: '阔叶树', x: tree.x, z: tree.z, radius: 1.5 * tree.scale,
          anchor: { x: tree.x, y: 2.9 * tree.scale, z: tree.z - .45 * tree.scale } }, 'tree',
        () => treeTemplate(tree.tone), tree.scale, tree.rotation);
      } else show({ id: node.id, kind: 'rock', name: '石材', x: node.x, z: node.z, radius: .75 * node.scale,
        anchor: { x: node.x, y: .75, z: node.z } }, 'rock', () => template('rock', () => {
        createLandscapeRock(scene, rockMaterial);
      }), node.scale, node.rotation);
    }
    for (const id of instances.keys()) if (id.startsWith('plot-') && !economy.plot(id)) remove(id);
    for (const plot of economy.state.plots) {
      const definition = plot;
      const mature = !!plot.crop && plot.growth >= C.crops[plot.crop].growthSeconds;
      const stage = mature ? 2 : plot.crop && plot.growth >= C.crops[plot.crop].growthSeconds / 3 ? 1 : 0;
      const name = plot.crop ? C.crops[plot.crop].name : plot.tilled ? '耕地' : '待开垦土地';
      const object: WorldObject = { ...definition, kind: plot.crop ? 'crop' : 'plot', name, radius: GRID_SIZE / 2, width: GRID_SIZE, depth: GRID_SIZE,
        markerY: .12, anchor: { x: definition.x, y: plot.crop ? .5 : .12, z: definition.z } };
      show(object, `${plot.tilled}-${plot.crop}-${stage}-${mature}`, () => {
        const soil = template(plot.tilled ? 'tilled' : 'untilled', () => {
          roundedBox(scene, 'farm-cell', [GRID_SIZE - .06, .10, GRID_SIZE - .06], [0, .055, 0], plot.tilled ? p.soil : p.grass, .08);
          if (plot.tilled) for (const x of [-.33, 0, .33]) roundedBox(scene, 'furrow', [.20, .08, 1.05], [x, .13, 0], p.soil, .04);
        });
        return plot.crop ? [...soil, ...cropTemplate(plot.crop, stage)] : soil;
      });
    }
    for (const id of instances.keys()) if (id.startsWith('goods-') && !economy.state.goods.some(g => g.id === id && g.state === 'ground')) remove(id);
    for (const goods of economy.state.goods) if (goods.state === 'ground') {
      show({ ...goods, kind: 'goods', name: '待入库资源', radius: .4, anchor: { x: goods.x, y: .5, z: goods.z } }, `${goods.resource}-${goods.x}-${goods.z}`,
        () => template('goods-' + goods.resource, () => {
          for (let i = 0; i < 3; i++) roundedBox(scene, 'resource-pile', [.35, .25, .35], [(i % 2 - .5) * .25, .15 + (i === 2 ? .2 : 0), 0], goods.resource === 'food' ? p.golden : goods.resource === 'wood' ? p.timber : p.stone, .08);
        }));
    }
    for (const id of instances.keys()) if (id.startsWith('site-') && !economy.state.sites.some(s => s.id === id)) remove(id);
    for (const site of economy.state.sites) {
      const built = economy.state.buildings.includes(site.id), task = economy.taskFor(site.id);
      const state = built ? 'built' : task ? 'construction' : 'site';
      if (built && site.kind === 'campfire') {
        if (instances.get(site.id)?.state !== 'built') { remove(site.id); instances.set(site.id, { state: 'built', meshes: [] }); fires.add(site); }
        objects.set(site.id, { id: site.id, x: site.x, z: site.z, kind: 'building', name: '火堆', radius: CAMPFIRE_SHAPE.radius, anchor: { x: site.x, y: 1.6, z: site.z } });
        continue;
      }
      show({ ...site, kind: built ? 'building' : 'site', name: built ? BUILDING_TYPES[site.kind].name : `${BUILDING_TYPES[site.kind].name}用地`, radius: site.width / 2,
        markerY: .12, anchor: { x: site.x + (built ? 0 : site.width * .25), y: built ? 1.2 : .2, z: built ? site.z - site.depth / 2 : site.z + site.depth * .15 } }, state,
      () => template(`${site.kind}-${state}`, () => {
        if (built) { referenceHouse(scene, p, { ...site, id: site.kind, x: 0, z: 0 }, false); return; }
        roundedBox(scene, 'building-footprint', [site.width, .07, site.depth], [0, .035, 0], p.pathLight, .08);
        for (const x of [-site.width / 2, site.width / 2]) for (const z of [-site.depth / 2, site.depth / 2]) {
          roundedBox(scene, 'layout-stake', [.12, task ? .9 : .3, .12], [x, task ? .45 : .15, z], p.timberLight, .03);
        }
        if (task) for (let i = 0; i < 3; i++) roundedBox(scene, 'construction-timber', [1.25, .16, .21], [-.2, .16 + i * .16, .25], p.timber, .035);
      }));
      if (built) doors.add(site, site.kind === 'warehouse');
    }
    obstacles = economyObstacles(economy.state.depleted, economy.state.sites, economy.state.buildings);
    obstaclesWithFields = [...obstacles, ...economy.state.plots.map(plot => ({
      kind: 'box' as const, x: plot.x, z: plot.z, halfWidth: GRID_SIZE / 2, halfDepth: GRID_SIZE / 2,
    }))];
    return true;
  }
  function workPoints(target: string, from?: Point): { points: Point[]; target: Point } | undefined {
    if (target === 'warehouse') {
      const doors = economy.warehouseDoors().sort((a, b) => from ? Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z) : 0);
      return { target: doors[0], points: doors.flatMap(door => [door, { x: door.x - .8, z: door.z }, { x: door.x + .8, z: door.z }]) };
    }
    const goods = economy.state.goods.find(g => g.id === target);
    if (goods) return { target: goods, points: [{ x: goods.x, z: goods.z }] };
    const plot = economy.plot(target), node = RESOURCE_NODES.find(n => n.id === target), site = economy.state.sites.find(s => s.id === target);
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
