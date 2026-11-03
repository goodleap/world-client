import assert from 'node:assert/strict';
import test from 'node:test';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { objectAtFace, selectionRanges, isWorldPickable } from '../src/game/world-selection.ts';

test('ray picks retain logical identities after transforming and batching different objects', () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  try {
    const parts = [-4, -2, 0, 2, 4].map((x, index) => {
      const mesh = index % 2 ? MeshBuilder.CreateSphere('round', { diameter: 1 }, scene) : MeshBuilder.CreateBox('box', { size: 1 }, scene);
      mesh.material = new StandardMaterial('surface-' + index, scene);
      mesh.position.x = x; mesh.rotation.y = index * .2;
      mesh.metadata = { worldObjectId: ['tree-a', undefined, 'crop-a', 'tree-a', 'house-a'][index] };
      return mesh;
    });
    for (const mesh of parts) mesh.computeWorldMatrix(true);
    const ranges = selectionRanges(parts);
    const merged = Mesh.MergeMeshes(parts, true, true)!;
    merged.computeWorldMatrix(true);
    for (const [index, x] of [-4, -2, 0, 2, 4].entries()) {
      const pick = scene.pickWithRay(new Ray(new Vector3(x, 3, 0), new Vector3(0, -1, 0)), mesh => mesh === merged)!;
      assert.ok(pick.hit);
      assert.equal(objectAtFace(ranges, pick.faceId), ['tree-a', undefined, 'crop-a', 'tree-a', 'house-a'][index]);
    }
    assert.equal(objectAtFace(ranges, -1), undefined);
  } finally { scene.dispose(); engine.dispose(); }
});

test('render-only building LODs cannot steal ground clicks, while the true building remains selectable',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const source=MeshBuilder.CreateBox('building',{size:2},scene);source.position.x=10;source.metadata={worldObjectId:'warehouse'};
    const lod=MeshBuilder.CreateBox('lod',{size:2},scene);lod.metadata={worldObjectId:'warehouse',buildingLOD:'map'};lod.isPickable=false;
    source.computeWorldMatrix(true);lod.computeWorldMatrix(true);
    const ray=new Ray(new Vector3(0,5,0),new Vector3(0,-1,0));
    assert(scene.pickWithRay(ray,m=>!!m.metadata?.worldObjectId)?.hit,'old custom predicate bypasses isPickable');
    assert(!scene.pickWithRay(ray,isWorldPickable)?.hit);
    assert.equal(scene.pickWithRay(new Ray(new Vector3(10,5,0),new Vector3(0,-1,0)),isWorldPickable)?.pickedMesh,source);
    source.setEnabled(false);assert(!scene.pickWithRay(new Ray(new Vector3(10,5,0),new Vector3(0,-1,0)),isWorldPickable)?.hit);
  }finally{scene.dispose();engine.dispose();}
});
