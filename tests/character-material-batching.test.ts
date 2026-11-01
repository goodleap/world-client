import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { batchCharacterMaterials } from '../src/game/character-material-batching.ts';

test('material batching preserves linear color, normals and geometry; different surface responses stay separate', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const parts = [0, 1, 2].map(i => {
      const mesh = MeshBuilder.CreateSphere(`part-${i}`, { segments: 4 }, scene);
      const material = new PBRMaterial(`color-${i}`, scene);
      material.albedoColor = new Color3(.2 + i * .2, .3, .5);
      material.metallic = 0; material.roughness = i === 2 ? .3 : .8;
      mesh.material = material;
      mesh.setVerticesData(VertexBuffer.ColorKind, Array.from({ length: mesh.getTotalVertices() }, () => [.5, .75, 1, 1]).flat());
      return mesh;
    });
    const positions = parts.map(m => Array.from(m.getVerticesData(VertexBuffer.PositionKind)!));
    const normals = parts.map(m => Array.from(m.getVerticesData(VertexBuffer.NormalKind)!));
    const colors = parts.map(m => (m.material as PBRMaterial).albedoColor.clone());
    const geometry = parts.map(m => m.geometry);
    const result = batchCharacterMaterials(parts);
    assert.equal(result.replacedMaterials, 2);
    assert.equal(parts[0].material, parts[1].material);
    assert.notEqual(parts[0].material, parts[2].material);
    assert.equal(parts[0].geometry, geometry[0], 'do not duplicate immutable vertex/skin buffers just to add color');
    for (let i = 0; i < 2; i++) {
      const vertex = parts[i].getVerticesData(VertexBuffer.ColorKind)!;
      assert.ok(Math.abs(vertex[0] - colors[i].r * .5) < 1e-7);
      assert.ok(Math.abs(vertex[1] - colors[i].g * .75) < 1e-7);
      assert.equal(vertex[2], colors[i].b);
    }
    assert.deepEqual(parts.map(m => Array.from(m.getVerticesData(VertexBuffer.PositionKind)!)), positions);
    assert.deepEqual(parts.map(m => Array.from(m.getVerticesData(VertexBuffer.NormalKind)!)), normals);
  } finally { scene.dispose(); engine.dispose(); }
});

test('shared geometry keeps same-color parts shared without recoloring excluded or differently colored parts', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const first = MeshBuilder.CreateSphere('first', { segments: 4 }, scene);
    const same = first.clone('same')!, other = first.clone('other')!, excluded = first.clone('excluded')!;
    const red = new PBRMaterial('red', scene), blue = new PBRMaterial('blue', scene), gloss = new PBRMaterial('gloss', scene);
    red.albedoColor.set(.8, .2, .1); blue.albedoColor.set(.1, .2, .8);
    red.roughness = blue.roughness = .8; gloss.roughness = .2;
    first.material = same.material = red; other.material = blue; excluded.material = gloss;
    const originalGeometry = excluded.geometry;
    batchCharacterMaterials([first, same, other, excluded]);
    assert.equal(first.geometry, same.geometry);
    assert.notEqual(first.geometry, other.geometry);
    assert.equal(excluded.geometry, originalGeometry);
    assert.equal(excluded.getVerticesData(VertexBuffer.ColorKind), null);
    const r = first.getVerticesData(VertexBuffer.ColorKind)!, b = other.getVerticesData(VertexBuffer.ColorKind)!;
    assert.ok(r[0] > r[2] && b[0] < b[2]);
    assert.equal(excluded.material, gloss);
  } finally { scene.dispose(); engine.dispose(); }
});
