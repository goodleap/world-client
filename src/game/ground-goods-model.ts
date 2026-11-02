import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Palette } from './models.ts';
import type { Goods } from './economy.ts';
import { createCropModel } from './crop-model.ts';
import { createLandscapeRock } from './landscape-rock.ts';
import { ellipsoid } from './environment-shapes.ts';

export const groundGoodsKind = (goods: Pick<Goods, 'resource' | 'crop'>) => goods.resource === 'food' ? goods.crop ?? 'food' : goods.resource;

/** Representative objects per batch, independent of resource quantity. The
 * economy world merges by material and instances each cached template. */
export function createGroundGoodsModel(scene: Scene, p: Palette, carrot: StandardMaterial, rock: StandardMaterial, goods: Pick<Goods, 'resource' | 'crop'>) {
  function layMeshes(meshes: Mesh[], yaw: number, x = 0, z = 0) {
    const turn = Matrix.RotationYawPitchRoll(yaw, Math.PI / 2, 0);
    for (const m of meshes) { m.bakeCurrentTransformIntoVertices(); m.bakeTransformIntoVertices(turn); }
    const bounds = meshes.map(m => m.getBoundingInfo().boundingBox);
    const bottom = Math.min(...bounds.map(b => b.minimum.y));
    const cx = (Math.min(...bounds.map(b => b.minimum.x)) + Math.max(...bounds.map(b => b.maximum.x))) / 2;
    const cz = (Math.min(...bounds.map(b => b.minimum.z)) + Math.max(...bounds.map(b => b.maximum.z))) / 2;
    for (const m of meshes) m.position.set(x-cx, .005-bottom, z-cz);
  }
  function laid(build: () => void, yaw: number, x = 0, z = 0) {
    const first = scene.meshes.length; build();
    layMeshes(scene.meshes.slice(first).filter((m): m is Mesh => m instanceof Mesh),yaw,x,z);
  }
  const kind = groundGoodsKind(goods);
  if (kind === 'carrot') {
    laid(() => createCropModel(scene, p, carrot, 'carrot', 2), -.22, -.21, -.05);
    laid(() => createCropModel(scene, p, carrot, 'carrot', 2), .18, .21, .08);
  } else if (kind === 'wheat') {
    laid(() => createCropModel(scene, p, carrot, 'wheat', 2), -.35);
  } else if (kind === 'stone' || kind === 'iron') {
    const parts=createLandscapeRock(scene,rock,kind==='iron');
    for (const [i,m] of parts.entries()) {
      m.scaling.setAll(i===0?.45:.65);
      layMeshes([m], .25+i*.7, [-.12,.30,-.31][i], [.08,-.18,-.26][i]);
    }
  } else if (kind === 'wood') {
    const first=scene.meshes.length;
    for (const [i, z] of [-.17, .17, 0].entries()) {
      const y = i === 2 ? .39 : .155, length = i === 1 ? .90 : 1.05;
      const log = MeshBuilder.CreateCylinder('felled-log', { height: length, diameter: .30, tessellation: 12 }, scene);
      log.rotation.z = Math.PI / 2; log.position.set(0, y, z); log.material = p.timber;
      for (const side of [-1, 1]) {
        const end = MeshBuilder.CreateCylinder('log-cut-end', { height: .012, diameter: .245, tessellation: 12 }, scene);
        end.rotation.z = Math.PI / 2; end.position.set(side * (length / 2 + .002), y, z); end.material = p.timberLight;
        const core = MeshBuilder.CreateCylinder('log-growth-ring', { height: .014, diameter: .13, tessellation: 12 }, scene);
        core.rotation.z = Math.PI / 2; core.position.copyFrom(end.position); core.material = p.timber;
      }
    }
    for (const m of scene.meshes.slice(first)) if (m instanceof Mesh) {
      m.bakeCurrentTransformIntoVertices(); m.bakeTransformIntoVertices(Matrix.RotationY(.48));
    }
  } else {
    // Food with no crop provenance (camp supplies / loot) is a small grain sack.
    ellipsoid(scene, 'grain-sack', [.54, .46, .43], [0, .235, 0], p.linen, 12);
    const lip = MeshBuilder.CreateTorus('sack-mouth', { diameter: .32, thickness: .075, tessellation: 12 }, scene);
    lip.position.y = .44; lip.material = p.linen;
    for (const [x,z] of [[-.08,-.03],[.06,-.07],[0,.06]]) ellipsoid(scene, 'loose-grain', [.14,.11,.12], [x,.46,z], p.golden, 8);
  }
}
