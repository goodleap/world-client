import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { BUILDINGS, createLandGrid, FENCES, TREES } from './world-data.ts';
import { box, cylinder, softBox, sphere } from './models.ts';
import type { Palette } from './models.ts';

function buildRoof(scene: Scene, p: Palette, x: number, z: number, width: number, depth: number, height: number, rise: number, green = false) {
  const half = (width + 0.65) / 2;
  const pitch = Math.atan2(rise, half);
  for (const side of [-1, 1]) {
    const slab = softBox(scene, 'roof', [Math.hypot(half, rise), 0.2, depth + 0.75], [x + side * half / 2, height + rise / 2, z], green ? p.sage : p.terracotta, 0.06);
    slab.rotation.z = -side * pitch;
    for (let row = 0; row < 3; row++) {
      const t = (row + 0.5) / 3;
      const trim = box(scene, 'roof-course', [0.035, 0.03, depth + 0.71], [x + side * half * t, height + rise * (1 - t) + 0.17, z], green ? p.sage : p.roofLight);
      trim.rotation.z = -side * pitch;
    }
  }
  softBox(scene, 'roof-ridge', [0.24, 0.22, depth + 0.9], [x, height + rise + 0.04, z], green ? p.sage : p.roofLight, 0.07);
}

function buildHouse(scene: Scene, p: Palette, b: typeof BUILDINGS[number]) {
  const { x, z, width: w, depth: d, height: h } = b;
  softBox(scene, b.id + '-foundation', [w + 0.25, 0.23, d + 0.25], [x, 0.1, z], p.stone, 0.08);
  softBox(scene, b.id + '-walls', [w, h, d], [x, h / 2 + 0.15, z], p.cream, 0.12);
  const gable = new Mesh('gable', scene);
  const data = new VertexData();
  data.positions = [-w / 2, 0, -d / 2, w / 2, 0, -d / 2, 0, 1.1, -d / 2,
    -w / 2, 0, d / 2, w / 2, 0, d / 2, 0, 1.1, d / 2];
  data.indices = [0, 1, 2, 3, 5, 4, 0, 5, 3, 0, 2, 5, 1, 5, 2, 1, 4, 5];
  data.uvs = new Array(12).fill(0);
  const normals: number[] = [];
  VertexData.ComputeNormals(data.positions, data.indices, normals);
  data.normals = normals;
  data.applyToMesh(gable);
  gable.convertToFlatShadedMesh();
  gable.position.set(x, h + 0.15, z);
  gable.material = p.plaster;
  buildRoof(scene, p, x, z, w, d, h + 0.15, 1.1, b.roof === 'sage');
  const front = z - d / 2;
  softBox(scene, 'doorframe', [0.95, 1.75, 0.12], [x - 0.25, 0.96, front - 0.07], p.timber, 0.05);
  softBox(scene, 'door', [0.73, 1.52, 0.09], [x - 0.25, 0.88, front - 0.15], p.sage, 0.035);
  sphere(scene, 'doorknob', [0.09, 0.09, 0.09], [x - 0.02, 0.9, front - 0.22], p.linen);
  softBox(scene, 'doorstep', [1.4, 0.19, 0.7], [x - 0.25, 0.1, front - 0.43], p.stoneLight, 0.07);
  const windowXs = w > 4 ? [x - 1.45, x + 1.2] : [x + 0.9];
  for (const wx of windowXs) {
    box(scene, 'window-frame', [0.77, 0.93, 0.12], [wx, 1.6, front - 0.08], p.timberLight);
    box(scene, 'window-glass', [0.59, 0.74, 0.07], [wx, 1.6, front - 0.16], p.window);
    box(scene, 'window-mullion', [0.06, 0.78, 0.06], [wx, 1.6, front - 0.21], p.cream);
    box(scene, 'window-mullion', [0.63, 0.06, 0.06], [wx, 1.6, front - 0.21], p.cream);
    softBox(scene, 'window-box', [0.88, 0.23, 0.38], [wx, 1.03, front - 0.19], p.timber, 0.05);
    for (let i = 0; i < 3; i++) {
      sphere(scene, 'window-leaves', [0.3, 0.3, 0.3], [wx + (i - 1) * 0.23, 1.24, front - 0.2], p.leaf);
      sphere(scene, 'window-flower', [0.12, 0.15, 0.12], [wx + (i - 1) * 0.23, 1.39, front - 0.25], p.flower);
    }
  }
  // Side window makes the house read as a complete three-dimensional model.
  box(scene, 'side-window-frame', [0.12, 0.9, 0.8], [x + w / 2 + 0.03, 1.5, z], p.timberLight);
  box(scene, 'side-window-glass', [0.08, 0.7, 0.6], [x + w / 2 + 0.12, 1.5, z], p.window);
  box(scene, 'side-window-bar', [0.06, 0.74, 0.06], [x + w / 2 + 0.18, 1.5, z], p.cream);
  if (b.id === 'cottage') {
    softBox(scene, 'chimney', [0.6, 1.35, 0.65], [x + 1, h + 1.08, z + 0.8], p.plaster, 0.04);
    softBox(scene, 'chimney-cap', [0.75, 0.18, 0.8], [x + 1, h + 1.8, z + 0.8], p.stone, 0.04);
    for (let i = 0; i < 4; i++) box(scene, 'chimney-brick', [0.2, 0.1, 0.02], [x + 0.9 + (i % 2) * 0.17, h + 0.95 + i * 0.18, z + 0.46], p.terracotta);
  }
}

export function buildWorld(scene: Scene, p: Palette, shadows: ShadowGenerator) {
  const before = new Set(scene.meshes);
  const ground = softBox(scene, 'island-soil', [25.4, 1.2, 27.4], [0, -0.72, 0], p.earth, 0.3);
  const turf = softBox(scene, 'island-grass', [25.6, 0.32, 27.6], [0, -0.13, 0], p.grass, 0.12);
  ground.receiveShadows = true;
  turf.receiveShadows = true;
  const land = createLandGrid();
  for (const cell of land) {
    if (cell.type === 'path') {
      box(scene, 'path', [1.005, 0.025, 1.005], [cell.x + 0.5, 0.038, cell.z + 0.5], p.path);
    } else if (cell.type === 'grass' && (cell.x * 17 + cell.z * 11) % 13 === 0) {
      const patch = cylinder(scene, 'grass-patch', 0.012, 1.2, 1.2, [cell.x + 0.5, 0.04, cell.z + 0.5], p.grassLight, 7);
      patch.scaling.z = 0.65;
    }
  }
  for (const b of BUILDINGS) buildHouse(scene, p, b);
  for (const tree of TREES) {
    const { x, z, scale: s, tone } = tree;
    cylinder(scene, 'tree-trunk', 2.4 * s, 0.42 * s, 0.22 * s, [x, 1.2 * s, z], p.timber, 7);
    const branch = cylinder(scene, 'tree-branch', 1.1 * s, 0.16 * s, 0.09 * s, [x + 0.25 * s, 1.85 * s, z], p.timber, 6);
    branch.rotation.z = -0.5;
    const leaf = [p.leaf, p.leafLight, p.golden][tone];
    sphere(scene, 'tree-crown', [2.6 * s, 2.7 * s, 2.5 * s], [x, 3.0 * s, z], leaf);
    sphere(scene, 'tree-crown-side', [1.8 * s, 1.9 * s, 1.9 * s], [x - 0.7 * s, 2.4 * s, z + 0.25], leaf);
    sphere(scene, 'tree-crown-top', [1.7 * s, 1.8 * s, 1.8 * s], [x + 0.65 * s, 3.3 * s, z - 0.15], leaf);
  }
  // Low garden beds and three distinct crops, all built from reusable primitives.
  softBox(scene, 'garden-border', [4.7, 0.18, 4.2], [4.8, 0.12, -2], p.timberLight, 0.08);
  softBox(scene, 'garden-soil', [4.45, 0.19, 3.95], [4.8, 0.15, -2], p.soil, 0.08);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 3.15 + col * 0.82, z = -3.25 + row * 1.22;
      if (row === 0) {
        sphere(scene, 'cabbage', [0.62, 0.49, 0.58], [x, 0.48, z], p.leafLight);
        sphere(scene, 'cabbage-heart', [0.36, 0.32, 0.36], [x, 0.66, z], p.leaf);
      } else if (row === 1) {
        for (let i = -1; i <= 1; i++) {
          const leaf = sphere(scene, 'sprout', [0.15, 0.55, 0.19], [x + i * 0.1, 0.55, z], p.leafDark);
          leaf.rotation.z = i * -0.45;
        }
      } else {
        for (let i = -1; i <= 1; i++) {
          cylinder(scene, 'wheat-stem', 0.67, 0.045, 0.025, [x + i * 0.16, 0.58, z], p.golden, 5);
          sphere(scene, 'wheat-ear', [0.15, 0.28, 0.15], [x + i * 0.16, 0.95, z], p.linen);
        }
      }
    }
  }
  // Faceted pond rim, lily pads and small stones.
  cylinder(scene, 'pond-bank', 0.04, 5.1, 5.1, [-7.2, 0.04, -3.7], p.stoneLight, 16);
  const water = cylinder(scene, 'pond-water', 0.04, 4.3, 4.3, [-7.2, 0.07, -3.7], p.water, 16);
  for (let i = 0; i < 4; i++) {
    const ripple = MeshBuilder.CreateTorus('pond-ripple', { diameter: 0.55 + i * 0.32, thickness: 0.018, tessellation: 24 }, scene);
    ripple.position.set(-7.5, 0.102, -3.4); ripple.scaling.z = 0.7; ripple.material = p.waterLight;
  }
  for (const [x, z] of [[-8.3, -3.7], [-6.3, -4.2], [-7.8, -2.8]]) {
    cylinder(scene, 'lily-pad', 0.025, 0.48, 0.48, [x, 0.115, z], p.leaf, 8);
  }
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4;
    sphere(scene, 'pond-stone', [0.4 + (i % 2) * 0.25, 0.28, 0.4], [-7.2 + Math.sin(a) * 2.45, 0.18, -3.7 + Math.cos(a) * 2.45], p.stone);
  }
  // Open stone well with timber posts and a small roof.
  cylinder(scene, 'well-water', 0.12, 1.5, 1.5, [1.5, 0.3, 7.2], p.water, 12);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 10; i++) {
      const a = (i + (row % 2) * 0.5) * Math.PI / 5;
      const stone = softBox(scene, 'well-stone', [0.46, 0.25, 0.33], [1.5 + Math.sin(a) * 0.76, 0.17 + row * 0.24, 7.2 + Math.cos(a) * 0.76], i % 2 ? p.stone : p.stoneLight, 0.05);
      stone.rotation.y = a;
    }
  }
  for (const x of [0.6, 2.4]) box(scene, 'well-post', [0.18, 2.3, 0.2], [x, 1.15, 7.2], p.timber);
  buildRoof(scene, p, 1.5, 7.2, 2.1, 1.45, 2.25, 0.55, true);
  cylinder(scene, 'well-rope', 1, 0.035, 0.035, [1.5, 1.6, 7.2], p.woodDark, 5);
  cylinder(scene, 'well-bucket', 0.33, 0.31, 0.4, [1.5, 1.1, 7.2], p.timberLight, 8);
  // Short fences leave deliberate, walkable openings.
  for (const { x, z } of FENCES) {
    softBox(scene, 'fence-post', [0.18, 0.85, 0.18], [x, 0.44, z], p.timberLight, 0.04);
    for (const y of [0.33, 0.63]) box(scene, 'fence-rail', [1.8, 0.12, 0.11], [x + 0.86, y, z], p.timberLight);
  }
  // Ground details use a deterministic sequence, keeping the layout reproducible.
  for (let i = 0; i < 58; i++) {
    const x = Math.sin(i * 19.31) * 11, z = Math.cos(i * 7.73) * 12;
    const cell = land.find((c) => c.x === Math.floor(x) && c.z === Math.floor(z));
    if (cell?.type !== 'grass') continue;
    const blade = cylinder(scene, 'meadow-grass', 0.22, 0.1, 0, [x, 0.12, z], i % 3 ? p.grassDark : p.linen, 4);
    blade.rotation.z = 0.2;
    if (i % 4 === 0) sphere(scene, 'meadow-flower', [0.15, 0.12, 0.15], [x, 0.3, z], p.flower);
  }
  // Warm path stones at the entrance.
  for (let i = 0; i < 6; i++) {
    const stone = softBox(scene, 'stepping-stone', [0.8, 0.07, 0.56], [(i % 2 - 0.5) * 0.35, 0.09, -9 + i * 0.7], p.pathLight, 0.03);
    stone.rotation.y = Math.sin(i) * 0.16;
  }
  // Batch immutable world geometry by material to keep mobile draw calls bounded.
  const groups = new Map<NonNullable<Mesh['material']>, Mesh[]>();
  for (const mesh of scene.meshes) {
    if (before.has(mesh) || !(mesh instanceof Mesh) || !mesh.material) continue;
    const group = groups.get(mesh.material) ?? [];
    group.push(mesh); groups.set(mesh.material, group);
  }
  for (const [material, meshes] of groups) {
    const merged = meshes.length > 1 ? Mesh.MergeMeshes(meshes, true, true) : meshes[0];
    if (merged) merged.name = `world-${material.name}`;
  }
  for (const mesh of scene.meshes) {
    if (before.has(mesh)) continue;
    mesh.isPickable = false;
    mesh.receiveShadows = ['grass', 'grassLight', 'grassDark', 'path', 'pathLight', 'earth', 'soil', 'water', 'stoneLight'].includes(mesh.material?.name ?? '');
    mesh.freezeWorldMatrix();
    if (mesh !== ground && mesh !== turf && mesh !== water && mesh.getBoundingInfo().boundingBox.maximumWorld.y > 0.2) {
      shadows.addShadowCaster(mesh);
    }
  }
  return { land };
}
