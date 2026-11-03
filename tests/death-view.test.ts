import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { DeathView, MountedDeathView } from '../src/game/death-view.ts';
import type { MountedDeathProfile } from '../src/game/death-view.ts';
import { Skeleton } from '@babylonjs/core/Bones/skeleton.js';
import { Bone } from '@babylonjs/core/Bones/bone.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import { DEATH_END, deathAge, deathPhase } from '../src/game/death.ts';
import { Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { Combat } from '../src/game/combat.ts';
import { newWolf } from '../src/game/raid-state.ts';
import { Raids } from '../src/game/raids.ts';

test('native fall grounds posed geometry, holds, freezes and sinks completely; an old corpse remains gone', () => {
 const engine=new NullEngine(), scene=new Scene(engine), root=new TransformNode('actor',scene);
 const mesh=MeshBuilder.CreateBox('body',{height:2,width:1,depth:.6},scene); mesh.parent=root;mesh.position.y=1;
 const view=new DeathView(root); let poses=0;
 for(const age of [0,.2,.6,1,2.6]) {
  view.sample(age,.4,[mesh],()=>poses++); mesh.computeWorldMatrix(true);
  assert(Math.abs(mesh.getBoundingInfo().boundingBox.minimumWorld.y-.015)<.01);
 }
 assert.equal(poses,1); assert.equal(deathPhase(1),'hold');
 const frozen=view.snapshot(); view.sample(2.6,.4,[mesh],()=>poses++); assert.deepEqual(view.snapshot(),frozen);
 view.sample(4,.4,[mesh],()=>poses++); assert(view.snapshot().y<frozen.y);
 view.sample(DEATH_END,.4,[mesh],()=>poses++); assert(!root.isEnabled()); assert.equal(view.snapshot().phase,'gone');
 assert.equal(deathAge(undefined,0),DEATH_END); view.reset(); assert.equal(view.snapshot().phase,'alive');
 scene.dispose();engine.dispose();
});
test('death stage survives every reload, future timestamps fail, and wolf loot settles only once while its corpse remains', () => {
 const e=new Economy();e.state.seconds=100;
 const c=new Combat(e.state.combat,e,()=>[]);c.hurt('infantry',9999,'enemy-guard');
 for(const elapsed of [.3,1.6,3.8,6]) {
  e.state.seconds=100+elapsed;const saved=decodeEconomy(encodeEconomy(e));
  const u=saved.state.combat.units.find(u=>u.id==='infantry')!;
  assert.equal(deathPhase(deathAge(u.diedAt,saved.state.seconds)),deathPhase(elapsed)); assert.equal(u.hp,0);
 }
 const invalid=JSON.parse(encodeEconomy(e));invalid.combat.units[0].diedAt=999;assert.throws(()=>decodeEconomy(JSON.stringify(invalid)));
 const w=newWolf('wolf-1-0',{x:-5,z:-4});
 Object.assign(e.state.raids,{phase:'raid',wave:1,startedAt:100,origin:{x:-5,z:-4},wolves:[w]});
 const people={status:()=>({position:{x:0,z:0},moving:false,working:false,speed:0}),command:()=>false,release:()=>{},resting:()=>{},neighbours:()=>[]};
 const raids=new Raids(e,c,people,()=>[],()=>true); c.hurt(w.id,9999,'infantry'); raids.update(.05);
 assert.equal(w.life,'defeated'); assert(w.settled); assert.equal(deathAge(w.diedAt,e.state.seconds),0);
 const goods=structuredClone(e.state.goods);const restored=decodeEconomy(encodeEconomy(e));
 const next=new Combat(restored.state.combat,restored,()=>[]), waves=new Raids(restored,next,people,()=>[],()=>true);
 restored.advance(.2); waves.update(.2);assert.deepEqual(restored.state.goods,goods);
});
test('mounted grounding is prepared once and shared without skin readback at either death',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),profiles:MountedDeathProfile={};let reads=0;
 try{
  const make=(id:string)=>{
   const root=new TransformNode(id,scene),rider=MeshBuilder.CreateBox(id+'-rider',{height:1.4,depth:.5,width:.5},scene),mount=MeshBuilder.CreateBox(id+'-horse',{height:1,depth:2,width:.7},scene);
   rider.parent=mount.parent=root;rider.position.y=1.8;mount.position.y=.5;
   mount.skeleton=new Skeleton(id+'-horse-rig',id,scene);new Bone('Horse.root',mount.skeleton);
   for(const mesh of [rider,mount]){const read=mesh.getPositionData.bind(mesh);mesh.getPositionData=(...args)=>{reads++;return read(...args);};}
   const track=new Animation('unfold','position.y',60,Animation.ANIMATIONTYPE_FLOAT,Animation.ANIMATIONLOOPMODE_CONSTANT);
   track.setKeys([{frame:0,value:1.8},{frame:36,value:1}]);const posture=new AnimationGroup(id+'-posture',scene);posture.addTargetedAnimation(track,rider);
   return {root,meshes:[rider,mount],posture,view:new MountedDeathView(root,profiles)};
  };
  const a=make('first');a.view.prepare(.4,a.meshes,()=>{},a.posture);assert(a.view.prepared);assert(reads>=26);
  assert(a.meshes.every(m=>m.parent===a.root),'preparation restores living hierarchy');
  const preparedReads=reads,b=make('recruit');b.root.position.x=10;b.view.prepare(1.2,b.meshes,()=>{},b.posture);
  a.view.sample(.2,.4,a.meshes,()=>{},a.posture);const frozen=a.view.snapshot();
  b.view.sample(4,1.2,b.meshes,()=>{},b.posture);assert.deepEqual(a.view.snapshot(),frozen,'another rider cannot advance the first death');
  for(const age of [0,.2,.4,.6,1,3,5]){a.view.sample(age,.4,a.meshes,()=>{},a.posture);b.view.sample(age,1.2,b.meshes,()=>{},b.posture);assert.equal(a.view.snapshot().y,b.view.snapshot().y);}
  assert.equal(reads,preparedReads,'both real deaths reuse the immutable grounding profile');
 }finally{scene.dispose();engine.dispose();}
});

test('human falls forward in its own facing and ends face down with ground contact', () => {
 for (const facing of [0, Math.PI / 2, Math.PI, -.7]) {
  const engine = new NullEngine(), scene = new Scene(engine), root = new TransformNode('person', scene);
  const mesh = MeshBuilder.CreateBox('body', { height: 2, width: .8, depth: .5 }, scene); mesh.parent = root; mesh.position.y = 1;
  const view = new DeathView(root, { prone: true });
  view.sample(.6, facing, [mesh], () => {}); root.computeWorldMatrix(true); mesh.computeWorldMatrix(true);
  const face = Vector3.TransformNormal(new Vector3(0, 0, 1), root.getWorldMatrix());
  assert(face.y < -.999, 'the face points at the ground');
  const length = Vector3.TransformNormal(new Vector3(0, 1, 0), root.getWorldMatrix());
  assert(Math.abs(length.x - Math.sin(facing)) < 1e-5 && Math.abs(length.z - Math.cos(facing)) < 1e-5, 'fall follows the heading');
  assert(Math.abs(mesh.getBoundingInfo().boundingBox.minimumWorld.y - .015) < .01);
  scene.dispose(); engine.dispose();
 }
});
