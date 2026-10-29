import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import trunkGeometry from './tree-trunk.json';

/** Reference: the rounded broadleaf tree in the approved terrain/plant sheet. */
export function createTreeMaterials(scene: Scene) {
  const foliage = new StandardMaterial('tree-foliage', scene);
  foliage.diffuseColor = Color3.White();
  foliage.specularColor = Color3.Black();
  const bark = new StandardMaterial('tree-bark', scene);
  bark.diffuseColor = Color3.White();
  bark.specularColor = Color3.Black();
  return { foliage, bark };
}

function gradient(mesh: Mesh, bottom: string, middle: string, top: string) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const low = Color3.FromHexString(bottom), mid = Color3.FromHexString(middle), high = Color3.FromHexString(top);
  let min = Infinity, max = -Infinity;
  for (let i = 1; i < positions.length; i += 3) { min = Math.min(min, positions[i]); max = Math.max(max, positions[i]); }
  const colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const t = (positions[i + 1] - min) / Math.max(0.001, max - min);
    const c = t < 0.52 ? Color3.Lerp(low, mid, t / 0.52) : Color3.Lerp(mid, high, (t - 0.52) / 0.48);
    colors.push(c.r, c.g, c.b, 1);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

export function createReferenceTree(scene: Scene, materials: ReturnType<typeof createTreeMaterials>, x = 0, z = 0, scale = 1, variation = 0) {
  const meshes: Mesh[] = [];
  const trunk = new Mesh('tree-trunk', scene);
  const data = new VertexData();
  data.positions = trunkGeometry.positions; data.normals = trunkGeometry.normals; data.indices = trunkGeometry.indices;
  data.applyToMesh(trunk); trunk.material = materials.bark;
  gradient(trunk, '#b67435', '#cb8c45', '#dda452');
  meshes.push(trunk);
  // Overlapping, asymmetrical lobes form one rounded crown, with visible forks below.
  const lobes = [
    [0.07, 3.3, 0.4, 1.75, 1.62, 1.6],
    [-0.75, 2.98, 0.23, 1.75, 1.63, 1.72],
    [0.9, 2.91, 0.3, 1.7, 1.65, 1.63],
    [-1.06, 2.31, -0.12, 1.57, 1.48, 1.57],
    [1.04, 2.3, -0.03, 1.62, 1.51, 1.6],
    [0.02, 2.89, -0.45, 2.03, 1.87, 1.75],
  ];
  for (const [i, lobe] of lobes.entries()) {
    const [cx, cy, cz, sx, sy, sz] = lobe;
    const crown = MeshBuilder.CreateSphere('tree-crown', { diameter: 1, segments: 24 }, scene);
    crown.scaling.set(sx, sy, sz); crown.position.set(cx, cy, cz);
    crown.rotation.z = Math.sin(i * 2.4) * 0.12;
    crown.material = materials.foliage;
    const hue = variation % 3;
    gradient(crown, '#469b58', hue === 1 ? '#65b943' : '#5fb442', hue === 2 ? '#b9dc54' : '#bde052');
    meshes.push(crown);
  }
  for (const mesh of meshes) {
    mesh.scaling.scaleInPlace(scale); mesh.position.scaleInPlace(scale); mesh.position.x += x; mesh.position.z += z;
    mesh.isPickable = false;
  }
  return meshes;
}
