import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';

// Exercise the published asset, including actual native skeleton/action binding.
test('authored dog shares three skinned LODs and loops/pauses all four native actions', async () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const source = await LoadAssetContainerAsync(new Uint8Array(readFileSync(new URL('../studies/dog/dog.glb', import.meta.url))), scene, { pluginExtension: '.glb' });
    source.addAllToScene();
    const meshes = source.meshes.filter(m => m.getTotalVertices());
    assert.equal(meshes.length, 3); assert.equal(source.materials.length, 1);
    assert.equal(source.skeletons.length, 1); assert.equal(source.skeletons[0].bones.length, 16);
    assert.ok(meshes.every(m => m.skeleton === meshes[0].skeleton && m.material === meshes[0].material));
    assert.deepEqual(source.animationGroups.map(g => g.name).sort(), ['Feed','Idle','Run','Walk']);
    assert.ok(meshes[0].getTotalIndices() < 50000); assert.ok(meshes[2].getTotalIndices() < 7500);
    const skeleton = source.skeletons[0], bind = skeleton.bones.map(b => b.getBindMatrix().asArray().slice());
    const pose = () => skeleton.bones.map(b => b.getTransformNode()!.getWorldMatrix().asArray().slice());
    const sample = () => { scene.animate(); for (const n of source.transformNodes) n.computeWorldMatrix(true); };
    scene.useConstantAnimationDeltaTime = true;
    for (const group of source.animationGroups) group.stop();
    for (const group of source.animationGroups) {
      let loops = 0; group.onAnimationGroupLoopObservable.add(() => loops++);group.start(true);
      for (let i=0;i<40;i++) sample();
      const moving = pose();scene.animationsEnabled=false;
      for(let i=0;i<10;i++) sample();assert.deepEqual(pose(),moving);
      scene.animationsEnabled=true;
      for(let i=0;i<350;i++) sample();assert.ok(loops>=2,group.name+' must loop');
      group.stop(); assert.equal(group.isPlaying,false);
    }
    assert.deepEqual(skeleton.bones.map(b=>b.getBindMatrix().asArray().slice()),bind);
  } finally {scene.dispose();engine.dispose();}
});
