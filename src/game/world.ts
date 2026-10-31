import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { BUILDINGS, createLandGrid, FENCES, TREES, MAP_SIZE, GRID_SIZE, POND, ROADS } from './world-data';
import type { Palette } from './models';
import { ellipsoid, roundedBox, tintHeight } from './environment-shapes';
import { referenceHouse } from './buildings';
import { selectionRanges } from './world-selection.ts';
import { spatialBatches } from './spatial-batching.ts';
import type { WorldObject } from './world-selection.ts';
import type { Economy } from './economy.ts';
import { createEconomyWorld } from './economy-world.ts';

/** Painted ground colors in world coordinates; navigation is separate from the artwork. */
function meadow(scene: Scene, p: Palette) {
  roundedBox(scene, 'earth-bank', [MAP_SIZE, .85, MAP_SIZE], [0, -.53, 0], p.earth, .28);
  roundedBox(scene, 'grass-sod', [MAP_SIZE, .17, MAP_SIZE], [0, -.08, 0], p.grass, .08);
  const texture = new DynamicTexture('meadow-and-sandy-path', { width: 1024, height: 1024 }, scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  let seed = 1037;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = '#88b83b'; ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 650; i++) {
    const x = random() * 1024, y = random() * 1024, radius = 15 + random() * 45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, i % 3 ? '#b0cf553b' : '#579c3030'); g.addColorStop(1, '#8aba3d00');
    ctx.fillStyle = g; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const u = (x: number) => (x / MAP_SIZE + .5) * 1024, v = (z: number) => (.5 - z / MAP_SIZE) * 1024;
  const path = new Path2D();
  for (const road of ROADS) {
    path.moveTo(u(road[0].x), v(road[0].z));
    for (let i = 1; i < road.length; i++) {
      const p = road[i - 1], next = road[i];
      path.quadraticCurveTo(u(p.x), v(p.z), u((p.x + next.x) / 2), v((p.z + next.z) / 2));
    }
    path.lineTo(u(road.at(-1)!.x), v(road.at(-1)!.z));
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#759d32'; ctx.lineWidth = 20; ctx.stroke(path);
  ctx.strokeStyle = '#d8ad62'; ctx.lineWidth = 18; ctx.stroke(path);
  ctx.strokeStyle = '#e9bb71'; ctx.lineWidth = 16; ctx.stroke(path);
  const pixels = ctx.getImageData(0, 0, 1024, 1024).data;
  for (let i = 0; i < 5200; i++) {
    const x = random() * 1024, y = random() * 1024;
    const index = (Math.floor(y) * 1024 + Math.floor(x)) * 4;
    const onPath = pixels[index] > 190 && pixels[index + 2] < 150;
    ctx.fillStyle = onPath ? (i % 3 ? '#f7d18d65' : '#c99c5530') : (i % 3 ? '#c0d95542' : '#57983528');
    ctx.beginPath(); ctx.ellipse(x, y, onPath ? 2 + random() * 6 : 1 + random() * 2, 1 + random() * 3, random() * 3, 0, Math.PI * 2); ctx.fill();
  }
  texture.update();
  const material = new StandardMaterial('meadow', scene); material.diffuseTexture = texture; material.specularColor = Color3.Black();
  const ground = MeshBuilder.CreateGround('meadow', { width: MAP_SIZE, height: MAP_SIZE }, scene);
  ground.position.y = .012; ground.material = material; ground.receiveShadows = true;
}

function grassClump(scene: Scene, p: Palette, x: number, z: number, size = 1) {
  // These tiny rounded decorations need smooth normals, not 1,296 triangles
  // per blade/petal. Eight latitude steps retain their shape at game distance.
  for (let i = 0; i < 4; i++) {
    const blade = ellipsoid(scene, 'round-grass-leaf', [.14 * size, (.4 + i % 2 * .16) * size, .09 * size], [x + (i - 1.5) * .075 * size, .17 * size, z + Math.sin(i * 2) * .07 * size], i % 2 ? p.leafLight : p.leaf, 6);
    blade.rotation.z = (i - 1.5) * -.27; tintHeight(blade, '#63934b', '#ffffff');
  }
}

function daisy(scene: Scene, p: Palette, x: number, z: number, size = 1) {
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5;
    const petal = ellipsoid(scene, 'daisy-petal', [.15 * size, .075 * size, .22 * size], [x + Math.sin(angle) * .12 * size, .13, z + Math.cos(angle) * .12 * size], p.flower, 6);
    petal.rotation.y = angle;
  }
  ellipsoid(scene, 'daisy-center', [.14 * size, .08 * size, .14 * size], [x, .17, z], p.golden, 6);
}

export function buildWorld(scene: Scene, p: Palette, shadows: ShadowGenerator, economy: Economy) {
  const before = new Set(scene.meshes), land = createLandGrid();
  const objects = new Map<string, WorldObject>();
  const register = (object: WorldObject, firstMesh: number) => {
    objects.set(object.id, object);
    for (const mesh of scene.meshes.slice(firstMesh)) mesh.metadata = { worldObjectId: object.id };
  };
  const addObject = (object: WorldObject, build: () => void) => {
    const first = scene.meshes.length; build(); register(object, first);
  };
  meadow(scene, p);
  for (const b of BUILDINGS) addObject({
    id: b.id, kind: 'building', name: b.id === 'cottage' ? '暖阳小屋' : '仓库',
    x: b.x, z: b.z, radius: b.width / 2, width: b.width, depth: b.depth,
    anchor: { x: b.x, y: 1.4, z: b.z - b.depth / 2 - .2 },
  }, () => referenceHouse(scene, p, b));
  for (const tree of TREES) {
    grassClump(scene, p, tree.x + .45, tree.z - .3, .95);
    grassClump(scene, p, tree.x - .35, tree.z - .22, .7);
  }
  // Individual farming cells are managed below as native mutable instances.
  const firstPondMesh = scene.meshes.length;
  const water = MeshBuilder.CreateDisc('pond-water', { radius: POND.radius, tessellation: 64 }, scene);
  water.rotation.x = Math.PI / 2; water.position.set(POND.x, .035, POND.z); water.material = p.water;
  for (let i = 0; i < 60; i++) {
    const a = i * Math.PI * 2 / 60, r = POND.radius + .2;
    const stone = roundedBox(scene, 'pond-stone', [1.5, .6 + i % 3 * .15, 1], [POND.x + Math.sin(a) * r, .3, POND.z + Math.cos(a) * r], i % 3 ? p.stoneLight : p.stone, .2);
    stone.rotation.y = a;
  }
  register({ id: 'pond', kind: 'scenery', name: '湖泊', x: POND.x, z: POND.z, radius: POND.radius,
    anchor: { x: POND.x, y: .05, z: POND.z } }, firstPondMesh);
  for (const [index, { x, z }] of FENCES.entries()) {
    const firstFenceMesh = scene.meshes.length;
    roundedBox(scene, 'fence-post', [.23, .85, .24], [x, .44, z], p.timberLight, .06);
    for (const y of [.33, .63]) roundedBox(scene, 'fence-rail', [1.82, .15, .14], [x + .86, y, z], p.timber, .045);
    ellipsoid(scene, 'fence-peg', [.055, .055, .035], [x, .67, z - .13], p.woodDark);
    register({ id: `fence-${index}`, kind: 'scenery', name: '木栅栏', x: x + .86, z, radius: 1,
      width: 2, depth: .4, anchor: { x: x + .86, y: .63, z },
    }, firstFenceMesh);
  }
  for (let i = 0; i < 220; i++) {
    const x = Math.sin(i * 19.31) * MAP_SIZE * .48, z = Math.cos(i * 7.73) * MAP_SIZE * .48;
    const cell = land.find(c => Math.abs(c.x - x) < GRID_SIZE / 2 && Math.abs(c.z - z) < GRID_SIZE / 2);
    if (cell?.type !== 'grass') continue;
    if (i % 3 === 0) grassClump(scene, p, x, z, .65 + (i % 4) * .12);
    else daisy(scene, p, x, z, .65 + (i % 3) * .13);
  }
  // Existing static batching retains the new vertex colors and smooth normals.
  const groups = new Map<NonNullable<Mesh['material']>, Mesh[]>();
  for (const mesh of scene.meshes) {
    if (before.has(mesh) || !(mesh instanceof Mesh) || !mesh.material) continue;
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
      const castsShadow = material.name !== 'earth' && batch.some(mesh => mesh.getBoundingInfo().boundingBox.maximumWorld.y > .24);
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
    if (before.has(mesh)) continue;
    mesh.isPickable = !!mesh.metadata?.worldFaceRanges?.length;
    // Ground, walls, roofs and plants all participate in the same soft daylight.
    mesh.receiveShadows = true;
    mesh.freezeWorldMatrix();
    if (mesh.metadata?.castsShadow) shadows.addShadowCaster(mesh);
  }
  const economyWorld = createEconomyWorld(scene, p, shadows, economy, objects);
  return { land, objects, ...economyWorld, selectionMeshes: (id: string) => scene.meshes.filter(m => m.metadata?.worldObjectId === id && !m.name.startsWith('selected-')) };
}
