import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import trunkGeometry from './tree-trunk.json' with { type: 'json' };
import trunkLOD from './tree-trunk-lod.json' with { type: 'json' };
import { landscapePreview } from './landscape-mode.ts';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { seededRandom } from './landscape-layout.ts';

export type TreeDetail = 'near' | 'medium' | 'far';

/** Screen coverage works with both map zoom and differently scaled instances.
 * Babylon retains the original instance for picking, disposal and shadows;
 * the two LOD meshes remain blocked from independent scene rendering. */
export function attachTreeLOD(source: Mesh, medium: Mesh, far: Mesh) {
  // Babylon 9.32.1's WebGL mono-pass instance cache lets an independent shadow
  // LOD overwrite a main-view batch when two tree sizes select different LODs.
  // Use the engine's existing per-pass storage (the WebGPU default). There is
  // no public switch yet; keep this adapter covered by real WebGL draw checks.
  for (const mesh of [source, medium, far]) mesh._instanceDataStorage.useMonoDataStorageRenderPass = false;
  source.useLODScreenCoverage = true;
  source.addLODLevel(.04, medium);
  source.addLODLevel(.004, far);
}

/** Reference: the rounded broadleaf tree in the approved terrain/plant sheet. */
export function createTreeMaterials(scene: Scene) {
  const foliage = new StandardMaterial('tree-foliage', scene);
  foliage.diffuseColor = Color3.White();
  foliage.specularColor = Color3.Black();
  const bark = new StandardMaterial('tree-bark', scene);
  bark.diffuseColor = Color3.White();
  bark.specularColor = Color3.Black();
  if (landscapePreview) {
    // One shared, seamless painted leaf map for all crowns and all LODs.
    // Small leaf groups live in the texture rather than separate geometry.
    const texture = new DynamicTexture('woodland-canopy-leaves', 512, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const ctx = texture.getContext() as CanvasRenderingContext2D, random = seededRandom(919);
    ctx.fillStyle = '#c7d4a8'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 260; i++) {
      const x = random() * 512, y = random() * 512, angle = random() * Math.PI * 2;
      const size = 7 + random() * 10;
      ctx.fillStyle = ['#edf0c7', '#95ad7a', '#b3c695', '#e2e8b7'][i % 4];
      for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
        ctx.save(); ctx.translate(x + dx, y + dy); ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(-size, 0); ctx.quadraticCurveTo(0, -size * .8, size, 0);
        ctx.quadraticCurveTo(0, size * .35, -size, 0); ctx.fill(); ctx.restore();
      }
    }
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.update(); foliage.diffuseTexture = texture;
  }
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

export function createReferenceTree(scene: Scene, materials: ReturnType<typeof createTreeMaterials>, x = 0, z = 0, scale = 1, variation = 0, detail: TreeDetail = 'near') {
  const meshes: Mesh[] = [];
  const trunk = new Mesh('tree-trunk', scene);
  const data = new VertexData();
  const geometry = detail === 'near' ? trunkGeometry : trunkLOD[detail];
  data.positions = geometry.positions; data.normals = geometry.normals; data.indices = geometry.indices;
  data.applyToMesh(trunk); trunk.material = materials.bark;
  if (landscapePreview) gradient(trunk, '#6c6341', '#948351', '#baaa6d');
  else gradient(trunk, '#b67435', '#cb8c45', '#dda452');
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
    const crown = MeshBuilder.CreateSphere('tree-crown', { diameter: 1, segments: { near: 24, medium: 10, far: 4 }[detail] }, scene);
    crown.scaling.set(sx, sy, sz); crown.position.set(cx, cy, cz);
    crown.rotation.z = Math.sin(i * 2.4) * 0.12;
    crown.material = materials.foliage;
    const hue = variation % 3;
    if (landscapePreview) gradient(crown, '#4d7055', hue === 1 ? '#91ac6c' : '#84a061', hue === 2 ? '#c2cd87' : '#b7c680');
    else gradient(crown, '#469b58', hue === 1 ? '#65b943' : '#5fb442', hue === 2 ? '#b9dc54' : '#bde052');
    meshes.push(crown);
  }
  for (const mesh of meshes) {
    mesh.scaling.scaleInPlace(scale); mesh.position.scaleInPlace(scale); mesh.position.x += x; mesh.position.z += z;
    mesh.isPickable = false;
  }
  return meshes;
}
