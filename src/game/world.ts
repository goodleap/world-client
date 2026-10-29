import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { BUILDINGS, createLandGrid, FENCES, TREES } from './world-data';
import type { Palette } from './models';
import { ellipsoid, roundedBox, tintHeight } from './environment-shapes';
import { createReferenceTree, createTreeMaterials } from './tree';
import { referenceHouse, tiledRoof } from './buildings';

/** Painted ground colors in world coordinates; navigation is separate from the artwork. */
function meadow(scene: Scene, p: Palette) {
  roundedBox(scene, 'earth-bank', [25.6, .85, 27.6], [0, -.53, 0], p.earth, .28);
  roundedBox(scene, 'grass-sod', [25.6, .17, 27.6], [0, -.08, 0], p.grass, .08);
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
  const u = (x: number) => (x / 25.6 + .5) * 1024, v = (z: number) => (.5 - z / 27.6) * 1024;
  const path = new Path2D();
  path.moveTo(u(0), v(-13.8)); path.bezierCurveTo(u(.25), v(-8), u(-.1), v(-2), u(0), v(1));
  path.bezierCurveTo(u(.1), v(6), u(-.15), v(10), u(0), v(13.8));
  path.moveTo(u(-6.5), v(1)); path.bezierCurveTo(u(-3), v(.85), u(2), v(1.1), u(7.3), v(1));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#759d32'; ctx.lineWidth = 96; ctx.stroke(path);
  ctx.strokeStyle = '#d8ad62'; ctx.lineWidth = 90; ctx.stroke(path);
  ctx.strokeStyle = '#e9bb71'; ctx.lineWidth = 82; ctx.stroke(path);
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
  const ground = MeshBuilder.CreateGround('meadow', { width: 25.6, height: 27.6 }, scene);
  ground.position.y = .012; ground.material = material; ground.receiveShadows = true;
}

function grassClump(scene: Scene, p: Palette, x: number, z: number, size = 1) {
  for (let i = 0; i < 4; i++) {
    const blade = ellipsoid(scene, 'round-grass-leaf', [.14 * size, (.4 + i % 2 * .16) * size, .09 * size], [x + (i - 1.5) * .075 * size, .17 * size, z + Math.sin(i * 2) * .07 * size], i % 2 ? p.leafLight : p.leaf);
    blade.rotation.z = (i - 1.5) * -.27; tintHeight(blade, '#63934b', '#ffffff');
  }
}

function daisy(scene: Scene, p: Palette, x: number, z: number, size = 1) {
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5;
    const petal = ellipsoid(scene, 'daisy-petal', [.15 * size, .075 * size, .22 * size], [x + Math.sin(angle) * .12 * size, .13, z + Math.cos(angle) * .12 * size], p.flower);
    petal.rotation.y = angle;
  }
  ellipsoid(scene, 'daisy-center', [.14 * size, .08 * size, .14 * size], [x, .17, z], p.golden);
}

export function buildWorld(scene: Scene, p: Palette, shadows: ShadowGenerator) {
  const before = new Set(scene.meshes), land = createLandGrid();
  meadow(scene, p);
  for (const b of BUILDINGS) referenceHouse(scene, p, b);
  const treeMaterials = createTreeMaterials(scene);
  for (const tree of TREES) {
    createReferenceTree(scene, treeMaterials, tree.x, tree.z, tree.scale, tree.tone);
    grassClump(scene, p, tree.x + .45, tree.z - .3, .95); grassClump(scene, p, tree.x - .35, tree.z - .22, .7);
  }
  roundedBox(scene, 'garden-border', [4.7, .19, 4.2], [4.8, .12, -2], p.timberLight, .08);
  roundedBox(scene, 'garden-soil', [4.45, .19, 3.95], [4.8, .15, -2], p.soil, .1);
  const carrot = new StandardMaterial('carrot-orange', scene); carrot.diffuseColor = Color3.FromHexString('#f28328'); carrot.specularColor = Color3.Black();
  for (let row = 0; row < 3; row++) {
    roundedBox(scene, 'soil-ridge', [4.22, .15, .7], [4.8, .28, -3.25 + row * 1.22], p.soil, .07);
    for (let col = 0; col < 5; col++) {
      const x = 3.15 + col * .82, z = -3.25 + row * 1.22;
      if (row < 2) {
        ellipsoid(scene, 'carrot', [.37, .4, .37], [x, .48, z], carrot);
        for (let i = -1; i <= 1; i++) {
          const leaf = ellipsoid(scene, 'carrot-leaf', [.19, .5, .14], [x + i * .13, .83, z], i % 2 ? p.leaf : p.leafLight);
          leaf.rotation.z = i * -.5; tintHeight(leaf, '#539d54', '#ffffff');
        }
      } else for (let i = -1; i <= 1; i++) {
        const stem = MeshBuilder.CreateCylinder('wheat-stem', { height: .65, diameter: .035, tessellation: 8 }, scene);
        stem.position.set(x + i * .15, .59, z); stem.material = p.leafLight;
        for (let k = 0; k < 3; k++) {
          const ear = ellipsoid(scene, 'golden-wheat', [.13, .21, .13], [x + i * .15 + (k % 2 - .5) * .07, .82 + k * .1, z], k % 2 ? p.golden : p.linen);
          ear.rotation.z = (k % 2 - .5) * .7;
        }
      }
    }
  }
  const water = MeshBuilder.CreateDisc('pond-water', { radius: 2.13, tessellation: 64 }, scene);
  water.rotation.x = Math.PI / 2; water.position.set(-7.2, .035, -3.7); water.material = p.water;
  for (let i = 0; i < 20; i++) {
    const a = i * Math.PI * 2 / 20;
    const stone = roundedBox(scene, 'pond-stone', [.57 + (i % 3) * .035, .35 + i % 2 * .07, .43], [-7.2 + Math.sin(a) * 2.2, .17, -3.7 + Math.cos(a) * 2.2], i % 3 ? p.stoneLight : p.stone, .13);
    stone.rotation.y = a; stone.rotation.z = Math.sin(i * 3.8) * .11;
  }
  for (let i = 0; i < 3; i++) {
    const ripple = MeshBuilder.CreateTorus('water-ripple', { diameter: .55 + i * .4, thickness: .012, tessellation: 48 }, scene);
    ripple.position.set(-7.5, .05, -3.5); ripple.scaling.z = .65; ripple.material = p.waterLight;
  }
  for (const [x, z] of [[-8.25, -3.6], [-6.4, -4.4], [-7.5, -2.8]]) {
    const pad = ellipsoid(scene, 'lily-pad', [.55, .025, .43], [x, .06, z], p.leaf); pad.rotation.y = x;
    ellipsoid(scene, 'lily-vein', [.3, .018, .025], [x, .078, z], p.leafLight);
  }
  for (let row = 0; row < 3; row++) for (let i = 0; i < 12; i++) {
    const a = (i + row % 2 * .5) * Math.PI / 6;
    const stone = roundedBox(scene, 'well-stone', [.39, .25, .3], [1.5 + Math.sin(a) * .75, .16 + row * .24, 7.2 + Math.cos(a) * .75], i % 2 ? p.stoneLight : p.stone, .055);
    stone.rotation.y = a;
  }
  const wellWater = MeshBuilder.CreateDisc('well-water', { radius: .65, tessellation: 32 }, scene);
  wellWater.rotation.x = Math.PI / 2; wellWater.position.set(1.5, .2, 7.2); wellWater.material = p.water;
  for (const x of [.6, 2.4]) roundedBox(scene, 'well-post', [.2, 2.4, .22], [x, 1.2, 7.2], p.timber, .04);
  tiledRoof(scene, p, 1.5, 7.2, 2.1, 1.45, 2.35, .55);
  for (const { x, z } of FENCES) {
    roundedBox(scene, 'fence-post', [.23, .85, .24], [x, .44, z], p.timberLight, .06);
    for (const y of [.33, .63]) roundedBox(scene, 'fence-rail', [1.82, .15, .14], [x + .86, y, z], p.timber, .045);
    ellipsoid(scene, 'fence-peg', [.055, .055, .035], [x, .67, z - .13], p.woodDark);
  }
  for (let i = 0; i < 175; i++) {
    const x = Math.sin(i * 19.31) * 11.4, z = Math.cos(i * 7.73) * 12.4;
    const cell = land.find(c => c.x === Math.floor(x) && c.z === Math.floor(z));
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
    const merged = meshes.length > 1 ? Mesh.MergeMeshes(meshes, true, true) : meshes[0];
    if (merged) merged.name = `world-${material.name}`;
  }
  for (const mesh of scene.meshes) {
    if (before.has(mesh)) continue;
    mesh.isPickable = false;
    // Painted crowns/roof tiles carry their own volume shading. Receiving their
    // own shadow map creates false hard bands across these small curved parts.
    mesh.receiveShadows = ['meadow', 'soil', 'stone', 'stoneLight', 'water'].includes(mesh.material?.name ?? '');
    mesh.freezeWorldMatrix();
    if (mesh.getBoundingInfo().boundingBox.maximumWorld.y > .24 && mesh.material?.name !== 'earth') shadows.addShadowCaster(mesh);
  }
  return { land };
}
