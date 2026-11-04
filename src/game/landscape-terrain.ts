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
import { LANDSCAPE, MAP_SIZE, MAP_WIDTH, MAP_DEPTH, GRID_SIZE } from './world-data.ts';
import { ROAD_PATHS, ROAD_HALF_WIDTH, roadHalfWidthAt } from './road-layout.ts';
import { roundedBox } from './environment-shapes.ts';
import { seededRandom } from './landscape-layout.ts';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { terrainHeight, groundHeight } from './terrain-height.ts';
import { insidePolygon } from './polygon.ts';
import { BIOME_COLORS } from './biomes.ts';
import { landscapeTexture } from './landscape-textures.ts';
import earcut from 'earcut';


const color = (hex: string) => Color3.FromHexString(hex);

/** Native opaque terrain/ribbons and mipmapped painted color maps: no screen
 * filters, reflection pass, per-frame texture painting or tessellated grass. */
export function createLandscapeTerrain(scene: Scene, palette: Palette) {
  const layout = LANDSCAPE;
  roundedBox(scene, 'earth-bank', [MAP_WIDTH, .85, MAP_DEPTH], [0, -.53, 0], palette.earth, .28);
  const random = seededRandom(layout.seed);
  function texture(name: string, size: number) {
    const t = new DynamicTexture(name, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.anisotropicFilteringLevel = Math.min(8, scene.getEngine().getCaps().maxAnisotropy || 1);
    return t;
  }
  const size = 2048;
  const colors = landscapeTexture('woodland-ground-colors', scene) ?? texture('woodland-ground-colors', size);
  if (colors instanceof DynamicTexture) {
    const ctx = colors.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#779b48'; ctx.fillRect(0, 0, size, size);
    // Ground +z maps to UV v=1, the top of an invertY DynamicTexture.
    ctx.save(); ctx.translate(size / 2, size / 2); ctx.scale(size / MAP_WIDTH, -size / MAP_DEPTH);
    function patch(x: number, z: number, radius: number, color: string, stretch = 1) {
      ctx.save(); ctx.translate(x, z); ctx.rotate(random() * Math.PI); ctx.scale(1, stretch);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      gradient.addColorStop(0, color); gradient.addColorStop(.55, color); gradient.addColorStop(1, color.slice(0, 7) + '00');
      ctx.fillStyle = gradient; ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
    }
    for (let i = 0; i < 150; i++) patch((random() - .5) * MAP_WIDTH, (random() - .5) * MAP_DEPTH,
      2 + random() * 7, ['#c0d77c38', '#49793b30', '#abca6235'][i % 3], .5 + random() * .6);
    for (const region of layout.regions) {
      patch(region.x, region.z, Math.max(region.rx, region.rz) * GRID_SIZE,
        BIOME_COLORS[region.biome]+'dd', region.rz/region.rx);
    }
    // Forest soil follows the generated vegetation rather than a repeated tile.
    for (const tree of layout.trees) patch(tree.x, tree.z, tree.scale * 3.5, '#536f3848', .85);
    for (const rock of layout.rocks) patch(rock.x, rock.z, rock.scale * 1.7, '#66734f65', .8);
    for (let i = 0; i < 14000; i++) {
      const x = (random() - .5) * MAP_WIDTH, z = (random() - .5) * MAP_DEPTH;
      const length = .09 + random() * .23;
      ctx.strokeStyle = i % 4 ? '#c2c99742' : '#44664945'; ctx.lineWidth = .035 + random() * .025;
      ctx.beginPath(); ctx.moveTo(x - .1, z); ctx.quadraticCurveTo(x - .06, z - length * .65, x - .14, z - length);
      ctx.moveTo(x, z); ctx.quadraticCurveTo(x + .06, z - length * .7, x + .03, z - length * 1.15); ctx.stroke();
    }
    ctx.restore(); colors.update();
  }
  const meadow = new StandardMaterial('meadow', scene);
  meadow.diffuseTexture = colors; meadow.specularColor = Color3.Black();
  const detail = landscapeTexture('woodland-meadow-strokes', scene) ?? texture('woodland-meadow-strokes', 512);
  if (detail instanceof DynamicTexture) {
    const strokes = detail.getContext() as CanvasRenderingContext2D;
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
    detail.update();
  }
  detail.wrapU = detail.wrapV = Texture.WRAP_ADDRESSMODE; detail.uScale = detail.vScale = MAP_SIZE / 7;
  meadow.detailMap.texture = detail; meadow.detailMap.isEnabled = true;
  meadow.detailMap.diffuseBlendLevel = .55; meadow.detailMap.bumpLevel = 0;
  const ground = MeshBuilder.CreateGround('meadow', { width: MAP_WIDTH, height: MAP_DEPTH, subdivisions: 160 }, scene);
  const vertices=ground.getVerticesData(VertexBuffer.PositionKind)!,normals:number[]=[];
  for(let i=0;i<vertices.length;i+=3)vertices[i+1]=groundHeight(vertices[i],vertices[i+2])+.012;
  VertexData.ComputeNormals(vertices,ground.getIndices()!,normals);
  ground.setVerticesData(VertexBuffer.PositionKind,vertices);ground.setVerticesData(VertexBuffer.NormalKind,normals);
  ground.material = meadow; ground.receiveShadows = true;

  const sand = landscapeTexture('woodland-road-grain', scene) ?? texture('woodland-road-grain', 256);
  if (sand instanceof DynamicTexture) {
    const grain = sand.getContext() as CanvasRenderingContext2D;
    grain.fillStyle = '#ffffff'; grain.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 500; i++) {
      const shade = Math.round(225 + random() * 26);
      grain.fillStyle = `rgb(${shade},${shade},${shade})`;
      grain.beginPath(); grain.ellipse(random() * 256, random() * 256, 1 + random() * 2, .7, 0, 0, Math.PI * 2); grain.fill();
    }
    sand.update();
  }
  sand.wrapU = sand.wrapV = Texture.WRAP_ADDRESSMODE;
  for (const t of [colors, detail, sand]) t.anisotropicFilteringLevel = Math.min(8, scene.getEngine().getCaps().maxAnisotropy || 1);
  const layers = [
    { width: 1, color: '#94a65a', y: .023 },
    { width: .93, color: '#bfac6d', y: .028 },
    { width: .84, color: '#d7b780', y: .034 },
  ];
  for (const [index, layer] of layers.entries()) {
    const mat = new StandardMaterial(`woodland-road-${index}`, scene);
    mat.diffuseColor = color(layer.color); mat.specularColor = Color3.Black(); mat.diffuseTexture = sand;
    for (const path of ROAD_PATHS) {
      const rows = [-1, 1].map(side => path.map((p, i) => {
        const tangent = path[Math.min(i + 1, path.length - 1)].subtract(path[Math.max(0, i - 1)]).normalize();
        const half = roadHalfWidthAt(p) * layer.width;
        return new Vector3(Math.max(-MAP_WIDTH / 2, Math.min(MAP_WIDTH / 2, p.x + tangent.z * half * side)), layer.y,
          Math.max(-MAP_DEPTH / 2, Math.min(MAP_DEPTH / 2, p.z - tangent.x * half * side)));
      }));
      for(const row of rows)for(const v of row)v.y+=terrainHeight(v.x,v.z);
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
  // Native indexed polygons preserve concave bays, stream bends and holes.
  // Shore ribbons use the identical boundary used for movement/building tests.
  const meshes:Mesh[]=[];
  for(const area of LANDSCAPE.waterAreas){
    const shape=area.points.map(p=>new Vector3(p.x,0,p.z));
    const mesh=MeshBuilder.CreatePolygon('landscape-water',{shape,holes:area.holes?.map(h=>h.points.map(p=>new Vector3(p.x,0,p.z))),sideOrientation:Mesh.DOUBLESIDE},scene,earcut);
    const positions=mesh.getVerticesData(VertexBuffer.PositionKind)!,colors:number[]=[],uvs:number[]=[];
    for(let i=0;i<positions.length;i+=3){
      const x=positions[i],z=positions[i+2];positions[i+1]=terrainHeight(x,z)+.038;
      const c=color(z<0?'#62a99b':'#42a4aa');colors.push(c.r,c.g,c.b,1);uvs.push(x/9,z/9);
    }
    mesh.setVerticesData(VertexBuffer.PositionKind,positions);mesh.setVerticesData(VertexBuffer.ColorKind,colors);mesh.setVerticesData(VertexBuffer.UVKind,uvs);
    mesh.setVerticesData(VertexBuffer.NormalKind,Array.from({length:positions.length},(_,i)=>i%3===1?1:0));
    mesh.receiveShadows=true;meshes.push(mesh);
    const bands=[[-.5,'#9aa56b'],[-.25,'#c0b88a'],[0,'#a7b99b'],[.32,'#69b5af']] as const;
    const normals2=area.points.map((p,i)=>{
      const a=area.points[(i-1+area.points.length)%area.points.length],b=area.points[(i+1)%area.points.length];
      const d=Math.hypot(b.x-a.x,b.z-a.z)||1;let nx=-(b.z-a.z)/d,nz=(b.x-a.x)/d;
      if(!insidePolygon({x:p.x+nx*.1,z:p.z+nz*.1},area)){nx=-nx;nz=-nz;}
      return {x:nx,z:nz};
    });
    const shore=MeshBuilder.CreateRibbon('natural-water-bank',{pathArray:bands.map(([offset])=>area.points.map((p,i)=>{
      const x=p.x+normals2[i].x*offset,z=p.z+normals2[i].z*offset;return new Vector3(x,terrainHeight(x,z)+.047,z);
    })),closePath:true,sideOrientation:Mesh.DOUBLESIDE},scene);
    const data=shore.getVerticesData(VertexBuffer.PositionKind)!,tints:number[]=[],shoreUV:number[]=[];
    const stride=area.points.length+1;
    for(let i=0;i<data.length/3;i++){
      const band=Math.floor((i%(stride*bands.length))/stride),c=color(bands[band][1]);tints.push(c.r,c.g,c.b,1);shoreUV.push(data[i*3]/9,data[i*3+2]/9);
    }
    shore.setVerticesData(VertexBuffer.ColorKind,tints);shore.setVerticesData(VertexBuffer.UVKind,shoreUV);
    shore.setVerticesData(VertexBuffer.NormalKind,Array.from({length:data.length},(_,i)=>i%3===1?1:0));
    shore.receiveShadows=true;meshes.push(shore);

  }
  const mat = new StandardMaterial('woodland-water', scene);
  mat.specularColor = Color3.Black(); mat.backFaceCulling = false;
  const ripple = landscapeTexture('woodland-water-ripples', scene) ?? new DynamicTexture('woodland-water-ripples', 512, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  if (ripple instanceof DynamicTexture) {

    const ctx = ripple.getContext() as CanvasRenderingContext2D, random = seededRandom(57);
    ctx.fillStyle = '#d8e5e9'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 95; i++) {
      const x = random() * 512, y = random() * 512;
      ctx.strokeStyle = i % 3 ? '#f3fcfda0' : '#9bbdc055'; ctx.lineWidth = 1.5 + random() * 2.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 8, y - 1, x + 13 + random() * 18, y); ctx.stroke();
    }
    ripple.update();
  }
  ripple.wrapU = ripple.wrapV = Texture.WRAP_ADDRESSMODE;
  mat.diffuseTexture = ripple; for(const mesh of meshes)mesh.material = mat;
}
