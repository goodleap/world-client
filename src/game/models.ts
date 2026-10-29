import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Scene } from '@babylonjs/core/scene';

export function createPalette(scene: Scene) {
  const colors = {
    grass: '#83ba38', grassLight: '#a5cc44', grassDark: '#5b9e2d', earth: '#b47b3f',
    path: '#e9ba68', pathLight: '#f1ce88', cream: '#f9e6c0', plaster: '#f9e6c0',
    terracotta: '#db512b', roofLight: '#ee6634', roofDark: '#ad3c25', sage: '#247f72',
    timber: '#aa6b30', timberLight: '#c48b43', woodDark: '#784521', window: '#1b777e',
    leaf: '#4ca244', leafLight: '#87bf36', leafDark: '#2f8643', golden: '#e9b73e',
    stone: '#b4b0a3', stoneLight: '#d7d0bb', soil: '#a86637', water: '#26b1ce',
    waterLight: '#90d8df', flower: '#fff5d4', linen: '#f7d182', shirt: '#3475b6',
    pants: '#425b64', skin: '#f9ae78', hair: '#63371e', boot: '#75401f', blush: '#e77d60',
    flax: '#f6dca6', sandCloth: '#d6a765', workCloth: '#ad6c34', leather: '#a85d27',
    leatherDark: '#6f3619', metal: '#9daab3', metalLight: '#d9e1dc', straw: '#e4ba61',
    horse: '#bd7132', dogFur: '#e49a3d', dogCream: '#ffe0a0', nose: '#342721',
  };
  return Object.fromEntries(Object.entries(colors).map(([name, color]) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor = Color3.Black();
    material.freeze();
    return [name, material];
  })) as Record<keyof typeof colors, StandardMaterial>;
}

/** GLB materials are independent of the procedural palette and need their own color tuning. */
export function applyCharacterColors(materials: readonly (Material | null | undefined)[]) {
  const colors: Record<string, [number, number, number]> = {
    skin: [0.98, 0.50, 0.28], 'warm white fabric': [0.95, 0.88, 0.72],
    'farmer shirt blue': [0.07, 0.24, 0.49], 'farmer trousers': [0.08, 0.13, 0.18],
    'brown hair': [0.12, 0.035, 0.012], 'head scarf linen': [0.94, 0.68, 0.38],
    'warm leather': [0.47, 0.20, 0.065], 'dark leather': [0.25, 0.075, 0.025],
    'buckle brass': [0.95, 0.46, 0.08], mouth: [0.65, 0.075, 0.035],
  };
  for (const material of new Set(materials)) {
    if (!(material instanceof PBRMaterial)) continue;
    const color = colors[material.name];
    if (color) material.albedoColor.set(...color);
  }
}

export type Palette = ReturnType<typeof createPalette>;

export function box(scene: Scene, name: string, size: [number, number, number], at: [number, number, number], material: StandardMaterial): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
  mesh.position.set(...at);
  mesh.material = material;
  return mesh;
}

export function sphere(scene: Scene, name: string, size: [number, number, number], at: [number, number, number], material: StandardMaterial): Mesh {
  const mesh = MeshBuilder.CreateIcoSphere(name, { radius: 0.5, subdivisions: 2, flat: true }, scene);
  mesh.scaling.set(...size);
  mesh.position.set(...at);
  mesh.material = material;
  return mesh;
}

export function cylinder(scene: Scene, name: string, height: number, bottom: number, top: number, at: [number, number, number], material: StandardMaterial, sides = 10): Mesh {
  const mesh = MeshBuilder.CreateCylinder(name, { height, diameterBottom: bottom, diameterTop: top, tessellation: sides }, scene);
  mesh.position.set(...at);
  mesh.material = material;
  return mesh;
}

/** Chamfered edges keep procedural objects soft without high polygon counts. */
export function softBox(scene: Scene, name: string, size: [number, number, number], at: [number, number, number], material: StandardMaterial, bevel = 0.12): Mesh {
  const [width, height, depth] = size;
  const b = Math.min(bevel, width / 4, height / 3, depth / 4);
  const positions: number[] = [], indices: number[] = [];
  const ring = (w: number, d: number, y: number) => {
    for (const [x, z] of [[-w + b, -d], [w - b, -d], [w, -d + b], [w, d - b], [w - b, d], [-w + b, d], [-w, d - b], [-w, -d + b]]) {
      positions.push(x, y, z);
    }
  };
  ring(width / 2 - b / 2, depth / 2 - b / 2, -height / 2);
  ring(width / 2, depth / 2, -height / 2 + b);
  ring(width / 2, depth / 2, height / 2 - b);
  ring(width / 2 - b / 2, depth / 2 - b / 2, height / 2);
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < 8; i++) {
      const next = (i + 1) % 8, a = layer * 8 + i, c = layer * 8 + next;
      indices.push(a, a + 8, c + 8, a, c + 8, c);
    }
  }
  positions.push(0, -height / 2, 0, 0, height / 2, 0);
  for (let i = 0; i < 8; i++) indices.push(32, i, (i + 1) % 8, 33, 24 + (i + 1) % 8, 24 + i);
  // Babylon's left-handed mesh convention needs clockwise outward-facing triangles.
  for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const data = new VertexData();
  data.positions = positions; data.indices = indices;
  data.uvs = new Array(positions.length / 3 * 2).fill(0);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.convertToFlatShadedMesh();
  mesh.position.set(...at); mesh.material = material;
  return mesh;
}
