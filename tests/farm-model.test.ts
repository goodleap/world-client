import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { createFarmModel, farmGridKey, farmNeighbourMask } from '../src/game/farm-model.ts';
import { createPalette } from '../src/game/models.ts';
import { GRID_SIZE } from '../src/game/world-data.ts';

const half=GRID_SIZE/2;
function vertex(mesh:Mesh,x:number,z:number){
  const p=mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for(let i=0;i<p.length;i+=3)if(Math.abs(p[i]-x)<1e-6&&Math.abs(p[i+2]-z)<1e-6){
    return [p[i+1],...mesh.getVerticesData(VertexBuffer.NormalKind)!.slice(i,i+3),
      ...mesh.getVerticesData(VertexBuffer.ColorKind)!.slice(i/3*4,i/3*4+3)];
  }
  throw new Error('missing edge vertex');
}
test('individual beds retain raised centers and joined soil troughs, including four-way and L-shaped joins',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),palette=createPalette(scene);
  try{
    for(const layout of [[[0,0],[1,0]],[[0,0],[0,1]],[[0,0],[1,0],[0,1]],[[0,0],[1,0],[0,1],[1,1]]]){
      const points=layout.map(([x,z])=>({x:x*GRID_SIZE,z:z*GRID_SIZE})),tilled=new Set(points.map(farmGridKey));
      const meshes=points.map(p=>{const mesh=createFarmModel(scene,palette,farmNeighbourMask(p,tilled));mesh.position.set(p.x,0,p.z);mesh.computeWorldMatrix(true);return mesh;});
      // Most of the cell is raised soil; only a narrow shoulder reaches the
      // joining trough. This catches reintroducing the former wide margins.
      const nearEdge=Math.sin(11*Math.PI/32)*half;
      for(const mesh of meshes)for(const [x,z]of [[nearEdge,0],[-nearEdge,0],[0,nearEdge],[0,-nearEdge]]){
        assert(vertex(mesh,x,z)[0]>.17,'bed fills the cell nearly to its edges');
      }
      for(let a=0;a<points.length;a++)for(let b=a+1;b<points.length;b++){
        const dx=(points[b].x-points[a].x)/GRID_SIZE,dz=(points[b].z-points[a].z)/GRID_SIZE;
        if(Math.abs(dx)+Math.abs(dz)!==1)continue;
        for(let n=-16;n<=16;n++){
          const q=Math.sin(n*Math.PI/32)*half,v=vertex(meshes[a],dx?dx*half:q,dz?dz*half:q),w=vertex(meshes[b],dx?-dx*half:q,dz?-dz*half:q);
          for(let i=0;i<v.length;i++)assert(Math.abs(v[i]-w[i])<1e-5,`seam mismatch ${layout} sample ${n}, component ${i}: ${v[i]} / ${w[i]}`);
          if(!n){
            assert(v[0]>.04&&v[0]<.08,'shared edge is a low soil trough above the meadow');
            assert(vertex(meshes[a],0,0)[0]-v[0]>.10,'each bed retains its own raised center');
          }
        }
      }
      if(layout.length===4)for(const dx of [-.001,.001])for(const dz of [-.001,.001]){
        const hit=scene.pickWithRay(new Ray(new Vector3(half+dx,1,half+dz),new Vector3(0,-1,0)),m=>meshes.some(mesh=>mesh===m));
        assert(hit?.hit&&hit.pickedPoint!.y>.04&&hit.pickedPoint!.y<.08,'four-way join stays a soil trough without a hole');
      }
      meshes.forEach(m=>m.dispose());
    }
  }finally{scene.dispose();engine.dispose();}
});
test('tilling or removing a neighbour changes only affected adjacency and restores the rounded outer edge',()=>{
  const a={x:-2.5*GRID_SIZE,z:1.5*GRID_SIZE},b={x:a.x+GRID_SIZE,z:a.z};
  const tilled=new Set([farmGridKey(a)]),isolated=farmNeighbourMask(a,tilled);
  tilled.add(farmGridKey(b));const connected=farmNeighbourMask(a,tilled);assert.notEqual(connected,isolated);
  tilled.delete(farmGridKey(b));assert.equal(farmNeighbourMask(a,tilled),isolated);
  const engine=new NullEngine(),scene=new Scene(engine),palette=createPalette(scene);
  try{
    const single=createFarmModel(scene,palette,isolated),joined=createFarmModel(scene,palette,connected);
    assert(vertex(single,half,0)[0]<0);assert(vertex(joined,half,0)[0]>.04&&vertex(joined,half,0)[0]<.08);
    assert.deepEqual(vertex(single,0,0),vertex(joined,0,0),'joining a neighbour preserves the original mound top');
    assert.deepEqual(vertex(single,-half,0),vertex(joined,-half,0));
  }finally{scene.dispose();engine.dispose();}
});
