import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { clearArrowArc } from '../src/game/projectile-sight.ts';
import { TOWER_SHAPE } from '../src/game/tower-shape.ts';
const ground=()=>0,from={x:0,y:TOWER_SHAPE.deck+1.25,z:0},to={x:10,y:1.25,z:0};
const box=(x:number,height:number)=>({minimum:new Vector3(x-1,0,-1),maximum:new Vector3(x+1,height,1)});
test('elevated arrows clear an adjacent tower but high cover still blocks the actual arc',()=>{
  assert(clearArrowArc(from,to,[box(3,TOWER_SHAPE.height)],ground));
  assert(!clearArrowArc(from,to,[box(3,6)],ground));
  assert(!clearArrowArc({...from,y:1.25},to,[box(3,TOWER_SHAPE.height)],ground));
  assert(clearArrowArc(from,to,[box(15,20)],ground),'cover beyond target does not block a finite segment');
});
test('arrow cover uses terrain height instead of treating all walking exclusions as tall walls',()=>{
  assert(clearArrowArc(from,to,[],()=>.3));
  assert(!clearArrowArc(from,to,[],x=>x>4&&x<6?6:0));
});
