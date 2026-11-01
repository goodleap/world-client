import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';

/** One rounded, asymmetric boulder study. The native sphere supplies topology;
 * broad shape changes and vertex color give worn faces without tiny geometry. */
export function createLandscapeRock(scene: Scene, material: StandardMaterial) {
  const shapes = [
    { x: -.08, z: .08, width: .61, depth: .50, height: 1.45, phase: .7 },
    { x: .43, z: -.25, width: .30, depth: .27, height: .50, phase: 2.4 },
    { x: -.43, z: -.28, width: .26, depth: .23, height: .35, phase: 4.1 },
  ];
  return shapes.map((shape, index) => {
    const mesh = MeshBuilder.CreateSphere('woodland-boulder-' + index, { diameter: 2, segments: 10 }, scene);
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!, colors: number[] = [];
    const low = Color3.FromHexString('#646f5a'), high = Color3.FromHexString('#b7b8a0');
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const wobble = 1 + .10 * Math.sin(x * 4 + z * 2 + shape.phase) + .07 * Math.cos(z * 5 - y * 2);
      const height = Math.max(0, (y + .83) / 1.83);
      positions[i] = shape.x + x * shape.width * wobble + height * .07;
      positions[i + 1] = .025 + Math.min(height, .90 + x * .12 + z * .05) * shape.height;
      positions[i + 2] = shape.z + z * shape.depth * wobble;
      const shade = Math.max(0, Math.min(1, height * .82 + .10 * Math.sin(x * 9 + y * 7 + z * 5)));
      const c = Color3.Lerp(low, high, shade); colors.push(c.r, c.g, c.b, 1);
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, mesh.getIndices()!, normals);
    mesh.setVerticesData(VertexBuffer.PositionKind, positions); mesh.setVerticesData(VertexBuffer.NormalKind, normals);
    mesh.setVerticesData(VertexBuffer.ColorKind, colors); mesh.refreshBoundingInfo();
    mesh.material = material;
    return mesh;
  });
}

export function createLandscapeRockMaterial(scene: Scene) {
  const material = new StandardMaterial('woodland-rock', scene);
  material.diffuseColor = Color3.White(); material.specularColor = Color3.Black();
  return material;
}
