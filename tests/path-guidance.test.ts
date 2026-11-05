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

test('route symbols retain their surface dimensions on cross, uphill and diagonal slopes',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
    const points=(height:(x:number,z:number)=>number)=>{
      const view=createPathGuidance(scene,height),endpoint={x:0,z:8};
      view.update('farmer',{x:0,z:0},[endpoint]);assert.deepEqual(view.snapshot().endpoint,endpoint);
      return Array.from(scene.meshes.at(-1)!.getVerticesData(VertexBuffer.PositionKind)!);
    };
    const flat=points(()=>0),distance=(p:number[],a:number,b:number)=>Math.hypot(...[0,1,2].map(k=>p[a*3+k]-p[b*3+k]));
    for(const [hx,hz] of [[2,0],[0,2],[1.5,-1]]){
      const slope=points((x,z)=>hx*x+hz*z);assert.equal(slope.length,flat.length);
      // First arrow: all vertex pairs must retain the same shape, not merely its XZ footprint.
      for(let a=0;a<90;a++)for(let b=a+1;b<90;b++)assert(Math.abs(distance(flat,a,b)-distance(slope,a,b))<1e-5);
      // The destination diamond's four border strips keep their thickness too.
      const end=flat.length/3-16;
      for(let a=end;a<flat.length/3;a++)for(let b=a+1;b<flat.length/3;b++)assert(Math.abs(distance(flat,a,b)-distance(slope,a,b))<1e-5);
      for(let i=0;i<slope.length;i+=3)assert(Math.abs(slope[i+1]-hx*slope[i]-hz*slope[i+2]-.095)<1e-5);
    }
  }finally{scene.dispose();engine.dispose();}
});
