import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Curve3 } from '@babylonjs/core/Maths/math.path';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Palette } from './models.ts';
import { MAP_SIZE, GRID_SIZE, ROADS } from './world-data.ts';
import { roundedBox } from './environment-shapes.ts';

/** World-scale color variation and small seamless detail maps shared by the terrain. */
export function createTerrain(scene: Scene, palette: Palette) {
  roundedBox(scene, 'earth-bank', [MAP_SIZE, .85, MAP_SIZE], [0, -.53, 0], palette.earth, .28);
  roundedBox(scene, 'grass-sod', [MAP_SIZE, .17, MAP_SIZE], [0, -.08, 0], palette.grass, .08);
  let seed = 1037;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const makeTexture = (name: string, size: number) => {
    const texture = new DynamicTexture(name, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    texture.anisotropicFilteringLevel = Math.min(8, scene.getEngine().getCaps().maxAnisotropy || 1);
    return texture;
  };
  const colorMap = makeTexture('meadow-colors', 1024);
  const ctx = colorMap.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#88b83b'; ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 650; i++) {
    const x = random() * 1024, y = random() * 1024, radius = 15 + random() * 45;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, i % 3 ? '#b0cf553b' : '#579c3030'); gradient.addColorStop(1, '#8aba3d00');
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  colorMap.update();
  const detail = makeTexture('terrain-detail', 512), grain = detail.getContext() as CanvasRenderingContext2D;
  grain.fillStyle = '#808080'; grain.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1800; i++) {
    const x = random() * 512, y = random() * 512, radius = 1 + random() * 3, shade = Math.round(100 + random() * 56);
    grain.fillStyle = `rgb(${shade},128,128)`;
    // Wrap edge marks so repetition has no seams. DetailMap uses red for color.
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      grain.beginPath(); grain.ellipse(x + dx, y + dy, radius, radius * .5, .4, 0, 2 * Math.PI); grain.fill();
    }
  }
  const grassDetail = makeTexture('meadow-leaves', 512), leaves = grassDetail.getContext() as CanvasRenderingContext2D;
  leaves.fillStyle = '#808080'; leaves.fillRect(0, 0, 512, 512);
  // Little curved leaf strokes remain at grass scale as the map grows. Native
  // mipmaps blend them into the meadow at overview distance without shimmer.
  for (let i = 0; i < 440; i++) {
    const x = random() * 512, y = random() * 512, angle = random() * Math.PI * 2;
    const size = 4 + random() * 6, shade = Math.round(i % 3 ? 84 + random() * 20 : 158 + random() * 20);
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      leaves.save(); leaves.translate(x + dx, y + dy); leaves.rotate(angle);
      leaves.fillStyle = `rgb(${shade},128,128)`;
      for (const side of [-1, 0, 1]) {
        leaves.beginPath(); leaves.moveTo(0, 0);
        leaves.quadraticCurveTo(side * size * .8 - 2, -size * .35, side * size, -size * (side ? .7 : 1));
        leaves.quadraticCurveTo(side * size * .5 + 2, -size * .2, 0, 0); leaves.fill();
      }
      leaves.restore();
    }
  }
  for (const texture of [detail, grassDetail]) {
    // DetailMap packs normals in alpha/green. Both must stay neutral even with
    // bumpLevel = 0; opaque alpha would create a zero-length surface normal.
    const context = texture.getContext(), packed = context.getImageData(0, 0, 512, 512);
    for (let i = 3; i < packed.data.length; i += 4) packed.data[i] = 128;
    context.putImageData(packed, 0, 0);
    // DynamicTexture defaults to CLAMP: scaling alone stretches its edge pixel
    // over almost the entire map. Both detail layers must explicitly repeat.
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = texture.vScale = MAP_SIZE / (4 * GRID_SIZE);
    texture.update();
  }
  function material(name: string, color: string, strength: number, texture = detail) {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.FromHexString(color); m.specularColor = Color3.Black();
    if (strength) {
      m.detailMap.texture = texture; m.detailMap.isEnabled = true;
      m.detailMap.diffuseBlendLevel = strength; m.detailMap.bumpLevel = 0;
    }
    return m;
  }
  const meadow = material('meadow', '#ffffff', .65, grassDetail); meadow.diffuseTexture = colorMap;
  const ground = MeshBuilder.CreateGround('meadow', { width: MAP_SIZE, height: MAP_SIZE }, scene);
  ground.position.y = .012; ground.material = meadow; ground.receiveShadows = true;

  // The exact same quadratic paths as the former canvas painting, represented
  // by native ribbons so road silhouettes keep their resolution at every zoom.
  const paths = ROADS.map(road => {
    const point = (p: { x: number; z: number }) => new Vector3(p.x, 0, p.z);
    const points = [point(road[0])];
    for (let i = 1; i < road.length; i++) {
      const control = point(road[i - 1]), end = Vector3.Center(control, point(road[i]));
      const start = points.at(-1)!;
      const samples = Math.max(4, Math.ceil((Vector3.Distance(start, control) + Vector3.Distance(control, end)) / GRID_SIZE));
      points.push(...Curve3.CreateQuadraticBezier(start, control, end, samples).getPoints().slice(1));
    }
    points.push(point(road.at(-1)!)); return points;
  });
  const layers = [
    { name: 'road-edge', color: '#759d32', width: 20, y: .019, detail: 0 },
    { name: 'road-bank', color: '#d8ad62', width: 18, y: .026, detail: .18 },
    { name: 'road-sand', color: '#e9bb71', width: 16, y: .033, detail: .25 },
  ];
  for (const layer of layers) {
    // Vertex colors enter the same stage as the original painted diffuse map,
    // keeping the sand colors unchanged under the existing daylight exposure.
    const roadMaterial = material(layer.name, '#ffffff', layer.detail), color = Color3.FromHexString(layer.color);
    for (const points of paths) {
      const halfWidth = layer.width / 1024 * MAP_SIZE / 2;
      const pathArray = [-1, 1].map(side => points.map((point, i) => {
        const tangent = points[Math.min(points.length - 1, i + 1)].subtract(points[Math.max(0, i - 1)]).normalize();
        const bound = (n: number) => Math.max(-MAP_SIZE / 2, Math.min(MAP_SIZE / 2, n));
        return new Vector3(bound(point.x + tangent.z * halfWidth * side), layer.y, bound(point.z - tangent.x * halfWidth * side));
      }));
      const ribbon = MeshBuilder.CreateRibbon(layer.name, { pathArray, sideOrientation: Mesh.DOUBLESIDE }, scene);
      const positions = ribbon.getVerticesData(VertexBuffer.PositionKind)!, uvs: number[] = [], colors: number[] = [];
      for (let i = 0; i < positions.length; i += 3) {
        uvs.push(positions[i] / MAP_SIZE + .5, positions[i + 2] / MAP_SIZE + .5);
        colors.push(color.r, color.g, color.b, 1);
      }
      ribbon.setVerticesData(VertexBuffer.UVKind, uvs); ribbon.setVerticesData(VertexBuffer.ColorKind, colors);
      ribbon.material = roadMaterial; ribbon.receiveShadows = true;
    }
  }
  return { paths, roadHalfWidth: layers[0].width / 1024 * MAP_SIZE / 2 };
}
