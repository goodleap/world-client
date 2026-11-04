import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { characterActions } from '../src/game/character-actions.ts';

test('native role filtering keeps independent playback and shared immutable tracks, including cavalry fall prerequisites',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),library=new AssetContainer(scene);
  try {
    const root=new TransformNode('body',scene);library.transformNodes.push(root);
    const track=new Animation('shared track','position.x',60,Animation.ANIMATIONTYPE_FLOAT);
    track.setKeys([{frame:0,value:0},{frame:60,value:1}]);
    for(const name of new Set((['base','farmer','infantry','archer','cavalry'] as const).flatMap(role=>[...characterActions(role)]))){
      const group=new AnimationGroup(name,scene);group.addTargetedAnimation(track,root);library.animationGroups.push(group);
    }
    const make=(role:'farmer'|'infantry'|'archer'|'cavalry')=>library.instantiateModelsToScene(n=>n,false,{
      doNotInstantiate:true,predicate:entity=>!(entity instanceof AnimationGroup)||characterActions(role).has(entity.name),
    });
    const farmer=make('farmer'),other=make('farmer'),infantry=make('infantry'),archer=make('archer'),cavalry=make('cavalry');
    assert.deepEqual(farmer.animationGroups.map(g=>g.name),['Walk','Run','Hammer']);
    assert.deepEqual(new Set(infantry.animationGroups.map(g=>g.name)),new Set(['ShieldWalk','ShieldRun','SwordSlash']));
    assert.deepEqual(new Set(archer.animationGroups.map(g=>g.name)),new Set(['CarryWalk','CarryRun','BowShot']));
    for(const action of ['Walk','RideIdle','HorseRideIdle','LanceThrust'])assert(cavalry.animationGroups.some(g=>g.name===action));
    const a=farmer.animationGroups[0],b=other.animationGroups[0];
    assert.notEqual(a,b);assert.equal(a.targetedAnimations[0].animation,b.targetedAnimations[0].animation);
    assert.notEqual(a.targetedAnimations[0].target,b.targetedAnimations[0].target);
    a.start(true).goToFrame(30);assert.equal((a.targetedAnimations[0].target as TransformNode).position.x,.5);
    assert.equal((b.targetedAnimations[0].target as TransformNode).position.x,0);
  }finally{scene.dispose();engine.dispose();}
});
