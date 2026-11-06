import test from 'node:test';
import assert from 'node:assert/strict';
import { immutableObstacles,combineObstacles } from '../src/game/navigation-geometry.ts';
import { isBlocked,sweepIsBlocked } from '../src/game/movement.ts';
import type { Obstacle } from '../src/game/movement.ts';
import { polygonArea } from '../src/game/polygon.ts';
import { collisionMetrics } from '../src/game/obstacle-index.ts';

test('indexed collision matches full exact checks including holes, negative cells and long sweeps',()=>{
  const raw:Obstacle[]=Array.from({length:200},(_,i)=>i%2?{kind:'circle',x:(i%20)*5-50,z:Math.floor(i/20)*5-25,radius:.7}:
    {kind:'box',x:(i%20)*5-50,z:Math.floor(i/20)*5-25,halfWidth:1,halfDepth:.6});
  raw.push({kind:'polygon',...polygonArea([{x:-12,z:-12},{x:12,z:-12},{x:12,z:12},{x:-12,z:12}]),
    holes:[polygonArea([{x:-10,z:-10},{x:10,z:-10},{x:10,z:10},{x:-10,z:10}])]});
  const indexed=immutableObstacles(raw),before=collisionMetrics();
  let seed=1;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let i=0;i<800;i++){
    const a={x:random()*110-55,z:random()*70-35},b={x:random()*110-55,z:random()*70-35},radius=.25+random();
    assert.equal(isBlocked(a,radius,indexed),isBlocked(a,radius,raw));
    assert.equal(sweepIsBlocked(a,b,radius,indexed),sweepIsBlocked(a,b,radius,raw));
  }
  assert.equal(collisionMetrics().indexBuilds-before.indexBuilds,1);
  const mutable:Obstacle[]=[{kind:'circle',x:70,z:70,radius:1}];
  const combined=combineObstacles(indexed,mutable);
  assert.equal(isBlocked({x:70,z:70},.4,combined),true);
  mutable[0].x=100;
  assert.equal(isBlocked({x:70,z:70},.4,combined),false);
  assert.equal(isBlocked({x:100,z:70},.4,combined),true);
});
