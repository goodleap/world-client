import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { createPathGuidance } from '../src/game/path-guidance.ts';
import { UNIT_SELECTION_COLOR } from '../src/game/selection-colors.ts';

test('route arrows stay on the ground while approaching feet fade them, with selection-ring hue',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
    const view=createPathGuidance(scene),route=[{x:0,z:8}];
    view.update('farmer',{x:0,z:0},route);
    const mesh=scene.getMeshByName('selected-route')!, initial=view.snapshot();
    const vertices=Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!);
    const ink=mesh.getVerticesData(VertexBuffer.ColorKind)!, color=Color3.FromHexString(UNIT_SELECTION_COLOR);
    assert(mesh.hasVertexAlpha);assert(Array.from({length:ink.length/4},(_,i)=>i*4).some(i=>Math.abs(ink[i]-color.r)<1e-6 && Math.abs(ink[i+1]-color.g)<1e-6 && Math.abs(ink[i+2]-color.b)<1e-6));
    const near=initial.arrows.find(a=>a.z>1.8&&a.z<3)!;
    view.update('farmer',{x:0,z:1.2},route);
    let current=view.snapshot();
    assert.deepEqual(Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!),vertices);
    assert.deepEqual(current.arrows.map(({x,z})=>({x,z})),initial.arrows.map(({x,z})=>({x,z})));
    assert(current.arrows.find(a=>a.z===near.z)!.alpha>0 && current.arrows.find(a=>a.z===near.z)!.alpha<near.alpha);
    assert.equal(current.arrows.at(-1)!.alpha,initial.arrows.at(-1)!.alpha);
    view.update('farmer',{x:0,z:1.2},route);assert.deepEqual(view.snapshot(),current);
    view.update('farmer',{x:0,z:3},route);current=view.snapshot();
    assert(current.arrows.filter(a=>a.z<=3).every(a=>a.alpha===0));assert.equal(current.revision,initial.revision);
    view.update(undefined);assert(!view.snapshot().visible);assert.deepEqual(view.snapshot().arrows,[]);
  } finally{scene.dispose();engine.dispose()}
});

test('consuming a bend retains arrow positions, while a real replan or another selection rebuilds the route',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
    const view=createPathGuidance(scene),route=[{x:0,z:4},{x:4,z:4}];
    view.update('dog',{x:0,z:0},route);const first=view.snapshot();
    view.update('dog',{x:1,z:4},route.slice(1));const passed=view.snapshot();
    assert.equal(passed.revision,first.revision);
    assert.deepEqual(passed.arrows.map(({x,z})=>({x,z})),first.arrows.map(({x,z})=>({x,z})));
    assert(passed.arrows.filter(a=>a.z<4).every(a=>a.alpha===0));
    view.update('dog',{x:1,z:4},[{x:1,z:6},{x:4,z:6},{x:4,z:4}]);
    assert.equal(view.snapshot().revision,first.revision+1);assert(view.snapshot().arrows.some(a=>a.z>4));
    view.update('farmer',{x:1,z:4},[{x:4,z:4}]);assert.equal(view.snapshot().selected,'farmer');
    view.update('farmer',{x:4,z:4},[]);assert(!view.snapshot().visible);
  }finally{scene.dispose();engine.dispose()}
});
