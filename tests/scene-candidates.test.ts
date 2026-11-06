import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { createSceneCandidates } from '../src/game/scene-candidates.ts';

test('native octree follows camera, moving children, LOD and static object lifecycles', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, .76, 80, Vector3.Zero(), scene);
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA; camera.orthoTop = camera.orthoRight = 8; camera.orthoBottom = camera.orthoLeft = -8;
    for (let i = 0; i < 300; i++) { const m = MeshBuilder.CreateBox('static-' + i, {}, scene); m.position.set(i % 30 * 4 - 60, 0, Math.floor(i / 30) * 4 - 20); m.freezeWorldMatrix(); }
    const root = new TransformNode('moving-root', scene), moving = MeshBuilder.CreateBox('moving', {}, scene); moving.parent = root;
    const near = MeshBuilder.CreateSphere('near', {}, scene), far = MeshBuilder.CreateBox('lod', {}, scene); near.addLODLevel(20, far);
    const index = createSceneCandidates(scene);
    const compare = () => {
      scene.render(); const selected = scene.getActiveMeshCandidates(); const candidates = selected.data.slice(0, selected.length);
      for (const m of scene.meshes) if (!m.isBlocked && m.isVisible && m.isEnabled() && m.isInFrustum(scene.frustumPlanes)) assert.ok(candidates.includes(m), 'visible mesh omitted: ' + m.name);
      assert.ok(!candidates.includes(far), 'LOD proxy must not render independently');
      assert.ok(candidates.includes(moving), 'moving content cannot be culled by stale static bounds');
      return candidates;
    };
    assert.ok(compare().length < 180);
    root.position.x = camera.target.x = 40; compare();
    const added = MeshBuilder.CreateBox('built-house', {}, scene); added.position.x = 40; added.freezeWorldMatrix();
    assert.ok(compare().includes(added)); added.dispose(); assert.ok(!compare().includes(added));
    camera.target.x = -40; root.position.x = -40; compare();
    assert.equal(index.snapshot().rebuilds, 1,'in-bounds construction and removal use native incremental updates');
    assert.equal(index.snapshot().incrementalAdds,1);
    assert.equal(index.snapshot().incrementalRemoves,1);
    const outside=MeshBuilder.CreateBox('outside-original-bounds',{},scene);outside.position.x=camera.target.x=120;outside.freezeWorldMatrix();
    assert.ok(compare().includes(outside));
    assert.equal(index.snapshot().rebuilds,2,'expanded bounds still rebuild before rendering');
    index.dispose();
  } finally { scene.dispose(); engine.dispose(); }
});

test('dynamic additions, removal, imports and delayed callbacks do not rebuild static geometry',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    new ArcRotateCamera('camera',-Math.PI/2,.76,20,Vector3.Zero(),scene);
    const ground=MeshBuilder.CreateBox('fixed',{},scene);ground.freezeWorldMatrix();
    const index=createSceneCandidates(scene);scene.render();
    const selected=()=>{scene.render();const result=scene.getActiveMeshCandidates();return result.data.slice(0,result.length);};
    const count=index.snapshot().rebuilds;
    for(let i=0;i<20;i++){
      const actor=MeshBuilder.CreateBox('actor',{},scene);
      scene.onMeshImportedObservable.notifyObservers(actor);
      const arrow=MeshBuilder.CreateBox('arrow',{},scene);
      assert(selected().includes(actor));assert(selected().includes(arrow));
      actor.position.x=50;arrow.position.x=-50;
      assert(selected().includes(actor),'dynamic imports are not frozen to their spawn bounds');
      actor.dispose();arrow.dispose();
      const replacement=MeshBuilder.CreateBox('replacement',{},scene);
      assert(selected().includes(replacement),'same-frame replacement appears before the deferred event');
      replacement.dispose();
    }
    await new Promise(resolve=>setTimeout(resolve,0));selected();
    // Asset containers import meshes and remove them from the scene before the
    // next render. Babylon's automatic tree insertion must be undone as well.
    const template=MeshBuilder.CreateBox('detached-template',{},scene);
    scene.onMeshImportedObservable.notifyObservers(template);scene.removeMesh(template);
    assert(!selected().includes(template));
    scene.onMeshImportedObservable.notifyObservers(template);
    assert(!selected().includes(template),'an import notification for a detached template is not scene membership');
    template.dispose();
    assert.equal(index.snapshot().rebuilds,count);
    assert.equal(index.snapshot().dynamic,0,'late add callbacks do not resurrect disposed actors');
    assert.equal(index.snapshot().static,1);
    index.dispose();
  }finally{scene.dispose();engine.dispose();}
});

test('explicit refresh reclassifies moved geometry, LOD sources and empty scenes safely',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const camera=new ArcRotateCamera('camera',-Math.PI/2,.76,20,Vector3.Zero(),scene);
    const index=createSceneCandidates(scene);
    scene.render();assert.equal(index.snapshot().static,0);
    const box=MeshBuilder.CreateBox('box',{},scene);box.freezeWorldMatrix();scene.render();
    assert.equal(index.snapshot().static,1);
    box.unfreezeWorldMatrix();box.position.x=camera.target.x=100;index.refresh();scene.render();
    assert.equal(index.snapshot().static,0);assert.equal(index.snapshot().dynamic,1);
    const candidates=scene.getActiveMeshCandidates();assert(candidates.data.slice(0,candidates.length).includes(box));
    const lod=MeshBuilder.CreateBox('lod',{},scene);box.addLODLevel(20,lod);index.refresh();scene.render();
    assert.equal(index.snapshot().dynamic,1);
    box.dispose();lod.dispose();scene.render();assert.equal(index.snapshot().dynamic,0);
    index.dispose();
  }finally{scene.dispose();engine.dispose();}
});
