import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Palette } from './models.ts';
import { LANDSCAPE, MAP_SIZE, MAP_WIDTH, MAP_DEPTH, GRID_SIZE } from './world-data.ts';
import { ROAD_PATHS, ROAD_HALF_WIDTH, roadHalfWidthAt } from './road-layout.ts';
import { createLandformMeshes } from './landform-meshes.ts';
import { seededRandom } from './landscape-layout.ts';
import { terrainHeight } from './terrain-height.ts';
import { insidePolygon } from './polygon.ts';
import { BIOME_COLORS } from './biomes.ts';
import { landscapeTexture } from './landscape-textures.ts';
import earcut from 'earcut';


const color = (hex: string) => Color3.FromHexString(hex);

/** Native opaque terrain/ribbons and mipmapped painted color maps: no screen
 * filters, reflection pass, per-frame texture painting or tessellated grass. */
export function createLandscapeTerrain(scene: Scene, _palette: Palette) {
  const layout = LANDSCAPE;
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
    // Roads are paint on the native heightfield, so ramps cannot expose a
    // different surface between the road's edge vertices. All layers share the
    // same authored curves and widths used by placement and navigation.
    for (const layer of [{width:1.12,color:'#8b9e52'},{width:1,color:'#b4a16e'},{width:.87,color:'#c4ac79'}]) {
      ctx.fillStyle=layer.color;
      for(const path of ROAD_PATHS){
        const sides=[-1,1].map(side=>path.map((p,i)=>{
          const t=path[Math.min(i+1,path.length-1)].subtract(path[Math.max(0,i-1)]).normalize();
          const width=roadHalfWidthAt(p)*layer.width*(1+.045*Math.sin(p.x*1.1+p.z*.7));
          return{x:p.x+t.z*width*side,z:p.z-t.x*width*side};
        }));
        ctx.beginPath();for(const [i,p] of [...sides[0],...sides[1].reverse()].entries())i?ctx.lineTo(p.x,p.z):ctx.moveTo(p.x,p.z);
        ctx.closePath();ctx.fill();
        for(const p of [path[0],path.at(-1)!]){ctx.beginPath();ctx.arc(p.x,p.z,roadHalfWidthAt(p)*layer.width,0,Math.PI*2);ctx.fill();}
      }
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
  createLandformMeshes(scene,meadow);

  return { paths: ROAD_PATHS, roadHalfWidth: ROAD_HALF_WIDTH };
}

export function createLandscapeWater(scene: Scene) {
  // Native indexed polygons preserve concave bays, stream bends and holes.
  // Shore ribbons use the identical boundary used for movement/building tests.
  const meshes:Mesh[]=[];
  for(const area of LANDSCAPE.reaches){
    const mesh=MeshBuilder.CreatePolygon('water-reach',{shape:area.points.map(p=>new Vector3(p.x,0,p.z)),holes:area.holes?.map(h=>h.points.map(p=>new Vector3(p.x,0,p.z))),sideOrientation:Mesh.DOUBLESIDE},scene,earcut);
    const positions=mesh.getVerticesData('position')!,colors:number[]=[],uvs:number[]=[];
    for(let i=0;i<positions.length;i+=3){const x=positions[i],z=positions[i+2];positions[i+1]=area.level+.038;
      const c=color(z<0?'#5b9d91':'#3e9ca6');colors.push(c.r,c.g,c.b,1);uvs.push(x/9,z/9);}
    mesh.setVerticesData('position',positions);mesh.setVerticesData('color',colors);mesh.setVerticesData('uv',uvs);
    mesh.setVerticesData('normal',Array.from({length:positions.length},(_,i)=>i%3===1?1:0));meshes.push(mesh);
    if(area.level>0)for(let i=0;i<area.points.length;i++){
      const a=area.points[i],b=area.points[(i+1)%area.points.length],cut=(area.level>2?26.8:17.3)*GRID_SIZE;
      if(Math.abs(a.z-cut)>.0001||Math.abs(b.z-cut)>.0001)continue;
      const lower=area.level>2?1.65:0;
      const fall=MeshBuilder.CreateRibbon('creek-cascade',{pathArray:[
        [new Vector3(a.x,area.level+.05,a.z),new Vector3(b.x,area.level+.05,b.z)],
        [new Vector3(a.x,lower+.04,a.z-.35),new Vector3(b.x,lower+.04,b.z-.35)]
      ],sideOrientation:Mesh.DOUBLESIDE},scene);
      fall.setVerticesData('color',Array.from({length:fall.getTotalVertices()},(_,j)=>j<2?[.64,.87,.84,1]:[.25,.66,.7,1]).flat());meshes.push(fall);
      const foam=MeshBuilder.CreateRibbon('cascade-foam',{pathArray:[-.38,-.8].map(d=>[new Vector3(a.x,lower+.06,a.z+d),new Vector3(b.x,lower+.06,b.z+d)]),sideOrientation:Mesh.DOUBLESIDE},scene);
      foam.setVerticesData('color',Array.from({length:foam.getTotalVertices()},()=>[.72,.9,.83,1]).flat());meshes.push(foam);
    }
  }
  for(const area of LANDSCAPE.waterAreas){
    const bands=[[-1.0,'#8a9d5b'],[-.5,'#beb186'],[0,'#a5b79c'],[.4,'#69b5af']] as const;
    const directions=area.points.map((p,i)=>{const a=area.points[(i-1+area.points.length)%area.points.length],b=area.points[(i+1)%area.points.length],d=Math.hypot(b.x-a.x,b.z-a.z)||1;
      let nx=-(b.z-a.z)/d,nz=(b.x-a.x)/d;if(!insidePolygon({x:p.x+nx*.1,z:p.z+nz*.1},area)){nx=-nx;nz=-nz;}return{x:nx,z:nz};});
    const shore=MeshBuilder.CreateRibbon('natural-water-bank',{pathArray:bands.map(([offset],row)=>area.points.map((p,i)=>{
      const width=1+.25*Math.sin(p.x*.8+p.z*.35),x=p.x+directions[i].x*offset*width,z=p.z+directions[i].z*offset*width,water=LANDSCAPE.waterLevel(p);
      const y=row===0?terrainHeight(x,z)+.025:row===1?water*.5+terrainHeight(x,z)*.5+.06:water+.05;
      return new Vector3(x,y,z);
    })),closePath:true,sideOrientation:Mesh.DOUBLESIDE},scene);
    const data=shore.getVerticesData('position')!,tints:number[]=[],uvs:number[]=[],stride=area.points.length+1;
    for(let i=0;i<data.length/3;i++){const c=color(bands[Math.floor((i%(stride*bands.length))/stride)][1]);tints.push(c.r,c.g,c.b,1);uvs.push(data[i*3]/9,data[i*3+2]/9);}
    shore.setVerticesData('color',tints);shore.setVerticesData('uv',uvs);meshes.push(shore);
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
