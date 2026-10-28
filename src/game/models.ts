import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

export function createPalette(scene: Scene) {
  const colors = {
    grass: '#a8bd7b', grassLight: '#b6c78b', grassDark: '#97af72', earth: '#b19b7c',
    path: '#ddc79c', pathLight: '#ebd8ae', cream: '#f4e6c8', plaster: '#ead9b5',
    terracotta: '#ba765d', roofLight: '#cf8a6c', roofDark: '#9e624e', sage: '#718d79',
    timber: '#947558', timberLight: '#b49570', woodDark: '#665948', window: '#7f9d9a',
    leaf: '#789b65', leafLight: '#9db776', leafDark: '#608566', golden: '#c4b46b',
    stone: '#b7b9a5', stoneLight: '#d0cfb8', soil: '#9a7b5b', water: '#83b9af',
    waterLight: '#b1d4c4', flower: '#e8ba97', linen: '#f2dfb1', shirt: '#788c9c',
    pants: '#5d7069', skin: '#e5b992', hair: '#6d5947', boot: '#705c49', blush: '#ca8d77',
  };
  return Object.fromEntries(Object.entries(colors).map(([name, color]) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor = Color3.Black();
    material.freeze();
    return [name, material];
  })) as Record<keyof typeof colors, StandardMaterial>;
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
