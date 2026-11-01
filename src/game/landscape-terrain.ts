import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Palette } from './models.ts';
import { LANDSCAPE, MAP_SIZE, GRID_SIZE } from './world-data.ts';
import { ROAD_PATHS, ROAD_HALF_WIDTH, roadHalfWidthAt } from './road-layout.ts';
import { roundedBox } from './environment-shapes.ts';
import { seededRandom } from './landscape-layout.ts';

const color = (hex: string) => Color3.FromHexString(hex);

/** Native opaque terrain/ribbons and mipmapped painted color maps: no screen
 * filters, reflection pass, per-frame texture painting or tessellated grass. */
export function createLandscapeTerrain(scene: Scene, palette: Palette) {
  const layout = LANDSCAPE;
  roundedBox(scene, 'earth-bank', [MAP_SIZE, .85, MAP_SIZE], [0, -.53, 0], palette.earth, .28);
  const random = seededRandom(layout.seed);
  function texture(name: string, size: number) {
    const t = new DynamicTexture(name, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.anisotropicFilteringLevel = Math.min(8, scene.getEngine().getCaps().maxAnisotropy || 1);
    return t;
  }
  const size = 2048, pixels = size / MAP_SIZE;
  const colors = texture('woodland-ground-colors', size), ctx = colors.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#82965b'; ctx.fillRect(0, 0, size, size);
  // Ground +z maps to UV v=1, the top of an invertY DynamicTexture.
  ctx.save(); ctx.translate(size / 2, size / 2); ctx.scale(pixels, -pixels);
  function patch(x: number, z: number, radius: number, color: string, stretch = 1) {
    ctx.save(); ctx.translate(x, z); ctx.rotate(random() * Math.PI); ctx.scale(1, stretch);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, color); gradient.addColorStop(.55, color); gradient.addColorStop(1, color.slice(0, 7) + '00');
    ctx.fillStyle = gradient; ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
  }
  for (let i = 0; i < 150; i++) patch((random() - .5) * MAP_SIZE, (random() - .5) * MAP_SIZE,
    2 + random() * 7, ['#b6b77a55', '#526e4d40', '#a3ae6d50'][i % 3], .5 + random() * .6);
  // Forest soil follows the generated vegetation rather than a repeated tile.
  for (const tree of layout.trees) patch(tree.x, tree.z, tree.scale * 3.5, '#335d4390', .85);
  for (const rock of layout.rocks) patch(rock.x, rock.z, rock.scale * 1.7, '#66734f65', .8);
  for (let i = 0; i < 14000; i++) {
    const x = (random() - .5) * MAP_SIZE, z = (random() - .5) * MAP_SIZE;
    const length = .09 + random() * .23;
    ctx.strokeStyle = i % 4 ? '#c2c99742' : '#44664945'; ctx.lineWidth = .035 + random() * .025;
    ctx.beginPath(); ctx.moveTo(x - .1, z); ctx.quadraticCurveTo(x - .06, z - length * .65, x - .14, z - length);
    ctx.moveTo(x, z); ctx.quadraticCurveTo(x + .06, z - length * .7, x + .03, z - length * 1.15); ctx.stroke();
  }
  ctx.restore(); colors.update();
  const meadow = new StandardMaterial('meadow', scene);
  meadow.diffuseTexture = colors; meadow.specularColor = Color3.Black();
  const detail = texture('woodland-meadow-strokes', 512), strokes = detail.getContext() as CanvasRenderingContext2D;
  strokes.fillStyle = '#808080'; strokes.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 110; i++) {
    const x = random() * 512, y = random() * 512, length = 5 + random() * 9;
    strokes.strokeStyle = i % 3 ? 'rgb(176,128,128)' : 'rgb(95,128,128)'; strokes.lineWidth = 1.6;
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      strokes.beginPath(); strokes.moveTo(x + dx - 3, y + dy);
      strokes.quadraticCurveTo(x + dx - 3, y + dy - length * .6, x + dx - 5, y + dy - length);
      strokes.moveTo(x + dx + 2, y + dy); strokes.quadraticCurveTo(x + dx + 6, y + dy - length * .55, x + dx + 6, y + dy - length * .8); strokes.stroke();
    }
  }
  const packed = strokes.getImageData(0, 0, 512, 512);
  for (let i = 3; i < packed.data.length; i += 4) packed.data[i] = 128;
  strokes.putImageData(packed, 0, 0);
  detail.wrapU = detail.wrapV = Texture.WRAP_ADDRESSMODE; detail.uScale = detail.vScale = MAP_SIZE / 7; detail.update();
  meadow.detailMap.texture = detail; meadow.detailMap.isEnabled = true;
  meadow.detailMap.diffuseBlendLevel = .55; meadow.detailMap.bumpLevel = 0;
  const ground = MeshBuilder.CreateGround('meadow', { width: MAP_SIZE, height: MAP_SIZE }, scene);
  ground.position.y = .012; ground.material = meadow; ground.receiveShadows = true;

  const sand = texture('woodland-road-grain', 256), grain = sand.getContext() as CanvasRenderingContext2D;
  grain.fillStyle = '#ffffff'; grain.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 500; i++) {
    const shade = Math.round(225 + random() * 26);
    grain.fillStyle = `rgb(${shade},${shade},${shade})`;
    grain.beginPath(); grain.ellipse(random() * 256, random() * 256, 1 + random() * 2, .7, 0, 0, Math.PI * 2); grain.fill();
  }
  sand.wrapU = sand.wrapV = Texture.WRAP_ADDRESSMODE; sand.update();
  const layers = [
    { width: 1, color: '#849360', y: .023 },
    { width: .93, color: '#a3a579', y: .028 },
    { width: .84, color: '#c8bd8b', y: .034 },
  ];
  for (const [index, layer] of layers.entries()) {
    const mat = new StandardMaterial(`woodland-road-${index}`, scene);
    mat.diffuseColor = color(layer.color); mat.specularColor = Color3.Black(); mat.diffuseTexture = sand;
    for (const path of ROAD_PATHS) {
      const rows = [-1, 1].map(side => path.map((p, i) => {
        const tangent = path[Math.min(i + 1, path.length - 1)].subtract(path[Math.max(0, i - 1)]).normalize();
        const half = roadHalfWidthAt(p) * layer.width;
        return new Vector3(Math.max(-MAP_SIZE / 2, Math.min(MAP_SIZE / 2, p.x + tangent.z * half * side)), layer.y,
          Math.max(-MAP_SIZE / 2, Math.min(MAP_SIZE / 2, p.z - tangent.x * half * side)));
      }));
      const road = MeshBuilder.CreateRibbon('woodland-road', { pathArray: rows, sideOrientation: Mesh.DOUBLESIDE }, scene);
      const positions = road.getVerticesData(VertexBuffer.PositionKind)!, uvs: number[] = [];
      for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] / 5, positions[i + 2] / 5);
      road.setVerticesData(VertexBuffer.UVKind, uvs); road.material = mat; road.receiveShadows = true;
    }
    // A small rounded meeting place joins all approaches without a sharp notch.
    const junction = MeshBuilder.CreateDisc('village-road-junction', { radius: 2.1 * layer.width, tessellation: 64 }, scene);
    junction.rotation.x = Math.PI / 2; junction.position.set(0, layer.y + .001, GRID_SIZE);
    junction.material = mat; junction.receiveShadows = true;
  }
  return { paths: ROAD_PATHS, roadHalfWidth: ROAD_HALF_WIDTH };
}

export function createLandscapeWater(scene: Scene) {
  const lake = LANDSCAPE.lake;
  // The fixed lake is star-shaped about this interior point; tests verify the
  // rings remain inside its shoreline. All bands share one native ribbon draw.
  const center = new Vector3(lake.x + 1.5, .037, lake.z);
  const levels = [
    [1.035, '#81925e'], [1.018, '#b5b186'], [1.003, '#8b9b7c'],
    [1, '#5f9995'], [.975, '#5a9492'], [.92, '#42888f'], [.65, '#32778a'], [0, '#2e7086'],
  ] as const;
  const pathArray = levels.map(([scale]) => lake.points.map(p => new Vector3(
    center.x + (p.x - center.x) * scale, .037, center.z + (p.z - center.z) * scale)));
  const mesh = MeshBuilder.CreateRibbon('woodland-lake', { pathArray, closePath: true, sideOrientation: Mesh.FRONTSIDE }, scene);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!, vertexColors: number[] = [], uvs: number[] = [];
  const stride = lake.points.length + 1;
  for (let i = 0; i < positions.length / 3; i++) {
    const c = color(levels[Math.min(levels.length - 1, Math.floor(i / stride))][1]);
    vertexColors.push(c.r, c.g, c.b, 1); uvs.push(positions[i * 3] / 9, positions[i * 3 + 2] / 9);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, vertexColors); mesh.setVerticesData(VertexBuffer.UVKind, uvs);
  const mat = new StandardMaterial('woodland-water', scene);
  mat.specularColor = Color3.Black(); mat.backFaceCulling = false;
  const ripple = new DynamicTexture('woodland-water-ripples', 512, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = ripple.getContext() as CanvasRenderingContext2D, random = seededRandom(57);
  ctx.fillStyle = '#d8e5e9'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 95; i++) {
    const x = random() * 512, y = random() * 512;
    ctx.strokeStyle = i % 3 ? '#f3fcfda0' : '#9bbdc055'; ctx.lineWidth = 1.5 + random() * 2.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 8, y - 1, x + 13 + random() * 18, y); ctx.stroke();
  }
  ripple.wrapU = ripple.wrapV = Texture.WRAP_ADDRESSMODE; ripple.update();
  mat.diffuseTexture = ripple; mesh.material = mat; mesh.receiveShadows = true;
  return { x: lake.x, z: lake.z, radius: (lake.bounds.maxX - lake.bounds.minX) / 2 };
}
