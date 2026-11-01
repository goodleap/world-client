import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { BUILDINGS, createLandGrid, FENCES, GRID_SIZE } from './world-data';
import type { Palette } from './models';
import { ellipsoid, roundedBox } from './environment-shapes';
import { referenceHouse } from './buildings';
import { selectionRanges } from './world-selection.ts';
import { spatialBatches } from './spatial-batching.ts';
import type { WorldObject } from './world-selection.ts';
import type { Economy } from './economy.ts';
import { createEconomyWorld } from './economy-world.ts';
import { createLandscapeTerrain, createLandscapeWater } from './landscape-terrain.ts';
import { createGroundCover } from './ground-cover.ts';
import { createCampfireView } from './campfire-view.ts';
import { createBuildingDoors } from './building-doors.ts';

export function buildWorld(scene: Scene, p: Palette, shadows: ShadowGenerator, economy: Economy) {
  const before = new Set(scene.meshes), land = createLandGrid();
  const objects = new Map<string, WorldObject>();
  const doors = createBuildingDoors(scene, p, shadows);
  const register = (object: WorldObject, firstMesh: number) => {
    objects.set(object.id, object);
    for (const mesh of scene.meshes.slice(firstMesh)) mesh.metadata = { ...mesh.metadata, worldObjectId: object.id };
  };
  const addObject = (object: WorldObject, build: () => void) => {
    const first = scene.meshes.length; build(); register(object, first);
  };
  createLandscapeTerrain(scene, p);
  for (const b of BUILDINGS) addObject({
    id: b.id, kind: 'building', name: b.id === 'cottage' ? '暖阳小屋' : '仓库',
    x: b.x, z: b.z, radius: b.width / 2, width: b.width, depth: b.depth,
    anchor: { x: b.x, y: 1.4, z: b.z - b.depth / 2 - .2 },
  }, () => { referenceHouse(scene, p, b, false); doors.add(b, b.id === 'warehouse'); });
  // Individual farming cells are managed below as native mutable instances.
  // Water is terrain, like the ground and roads: no selectable object metadata.
  // Its shoreline remains in the movement and construction obstacle data.
  createLandscapeWater(scene);
  for (const [index, { x, z }] of FENCES.entries()) {
    const firstFenceMesh = scene.meshes.length;
    roundedBox(scene, 'fence-post', [.23, .85, .24], [x, .44, z], p.timberLight, .06);
    for (const y of [.33, .63]) roundedBox(scene, 'fence-rail', [1.82, .15, .14], [x + .86, y, z], p.timber, .045);
    ellipsoid(scene, 'fence-peg', [.055, .055, .035], [x, .67, z - .13], p.woodDark);
    register({ id: `fence-${index}`, kind: 'scenery', name: '木栅栏', x: x + .86, z, radius: 1,
      width: 2, depth: .4, anchor: { x: x + .86, y: .63, z },
    }, firstFenceMesh);
  }
  // Existing static batching retains the new vertex colors and smooth normals.
  const groups = new Map<NonNullable<Mesh['material']>, Mesh[]>();
  for (const mesh of scene.meshes) {
    if (before.has(mesh) || !(mesh instanceof Mesh) || !mesh.material || mesh.metadata?.animatedDoor) continue;
    // Babylon requires matching attributes when combining painted and plain parts.
    if (!mesh.isVerticesDataPresent(VertexBuffer.ColorKind)) mesh.setVerticesData(VertexBuffer.ColorKind, new Float32Array(mesh.getTotalVertices() * 4).fill(1));
    if (!mesh.isVerticesDataPresent(VertexBuffer.UVKind)) mesh.setVerticesData(VertexBuffer.UVKind, new Float32Array(mesh.getTotalVertices() * 2));
    const group = groups.get(mesh.material) ?? []; group.push(mesh); groups.set(mesh.material, group);
  }
  for (const [material, meshes] of groups) {
    // Keep decorative grass/flowers out of selectable batches so their closest
    // triangle cannot intercept a click intended for an object behind them.
    const selectable = meshes.filter(mesh => mesh.metadata?.worldObjectId);
    const decoration = meshes.filter(mesh => !mesh.metadata?.worldObjectId);
    const byObject = new Map<string, Mesh[]>();
    for (const mesh of selectable) { const id = mesh.metadata.worldObjectId; const parts = byObject.get(id) ?? []; parts.push(mesh); byObject.set(id, parts); }
    for (const batch of [...byObject.values(), decoration]) {
      if (!batch.length) continue;
      for (const mesh of batch) mesh.computeWorldMatrix(true);
      // Preserve the original caster membership when splitting a batch. A
      // short piece must keep its shadow if the old material batch cast one.
      const castsShadow = material.name !== 'earth' && material.name !== 'forest-bank' && batch.some(mesh => mesh.getBoundingInfo().boundingBox.maximumWorld.y > .24);
      const triangles = batch.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
      // Small batches already cost little vertex work; splitting them would
      // add draw calls without a useful reduction in submitted geometry.
      const cells = triangles > 100_000 ? spatialBatches(batch) : new Map([['', batch]]);
      for (const [cell, parts] of cells) {
        const ranges = selectionRanges(parts);
        const merged = parts.length > 1 ? Mesh.MergeMeshes(parts, true, true) : parts[0];
        if (merged) {
          merged.name = `world-${material.name}${batch === decoration && selectable.length ? '-detail' : ''}${cell ? `-${cell}` : ''}`;
          merged.metadata = { worldFaceRanges: ranges, worldObjectId: ranges[0]?.id, castsShadow };
        }
      }
    }
  }
  for (const mesh of scene.meshes) {
    if (before.has(mesh) || mesh.metadata?.animatedDoor) continue;
    mesh.isPickable = !!mesh.metadata?.worldFaceRanges?.length;
    // Ground, walls, roofs and plants all participate in the same soft daylight.
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    if (mesh.metadata?.castsShadow) shadows.addShadowCaster(mesh);
  }
  const fires = createCampfireView(scene, p, shadows);
  const economyWorld = createEconomyWorld(scene, p, shadows, economy, objects, doors, fires);
  fires.update(economy.state.campfires, 0, { x: 0, z: 0 });
  const cover = createGroundCover(scene);
  const syncCover = () => cover.sync([...economy.state.sites, ...economy.state.plots.map(p => ({ ...p, width: GRID_SIZE, depth: GRID_SIZE }))]);
  syncCover();
  return { land, objects, doors, fires, ...economyWorld,
    sync: () => { const changed = economyWorld.sync(); if (changed) syncCover(); return changed; },
    selectionMeshes: (id: string) => scene.meshes.filter(m => m.metadata?.worldObjectId === id && !m.name.startsWith('selected-')) };
}
