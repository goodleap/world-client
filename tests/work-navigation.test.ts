import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVE_DESTINATION_RADIUS, planMoveDestination, planWorkApproach } from '../src/game/work-navigation.ts';
import { isBlocked } from '../src/game/movement.ts';
import { segmentIsClear } from '../src/game/wander.ts';
import { createRouteState, stepRoute } from '../src/game/route-following.ts';
const bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
const points = [{ x: 0, z: 0 }, { x: .8, z: 0 }, { x: -.8, z: 0 }];
test('workers reserve different approach points and bypass standing occupants', () => {
  const first = planWorkApproach({ x: 0, z: -3 }, points, .29, bounds, [], []);
  assert.deepEqual(first?.at(-1), points[0]);
  const second = planWorkApproach({ x: 1, z: -3 }, points, .29, bounds, [], [{ position: { x: 0, z: -2 }, radius: .29, destination: first!.at(-1) }]);
  assert.deepEqual(second?.at(-1), points[1]);
  const retargeted = planWorkApproach({ x: 1, z: -1 }, points, .29, bounds, [], [{ position: points[1], radius: .29 }]);
  assert.deepEqual(retargeted?.at(-1), points[0]);
  assert.equal(planWorkApproach({ x: 0, z: -3 }, points, .29, bounds, [], points.map(position => ({ position, radius: .29 }))), undefined);
});

test('neighbouring manual commands reserve separate reachable arrival positions', () => {
  const point = { x: 0, z: 3 }, first = planMoveDestination({ x: -.3, z: -3 }, point, .29, bounds, [], []);
  assert.deepEqual(first?.at(-1), point);
  for (const offset of [0, .01, .3]) {
    const second = planMoveDestination({ x: .3, z: -3 }, { x: offset, z: 3 }, .29, bounds, [], [
      { position: { x: -.3, z: -3 }, radius: .29, destination: first!.at(-1) },
    ]);
    assert(second);
    const goal = second.at(-1)!;
    assert(Math.hypot(goal.x - point.x, goal.z - point.z) >= .66);
    assert(Math.hypot(goal.x - offset, goal.z - 3) < .7, 'keep the command near the clicked ground');
  }
});

test('blocked terrain and nearby map edges resolve to a nearby native body-safe point', () => {
  const point={x:0,z:0}, start={x:-3.5,z:0}, solids=[{kind:'circle' as const,...point,radius:.8}];
  for(const radius of [.29,.54,.6]) {
    const path=planMoveDestination(start,point,radius,bounds,solids,[])!;
    assert(path);const end=path.at(-1)!;
    // Native voxel erosion includes a .1 clearance and voxel rounding. Verify
    // the gameplay contract, not the retired solver's sub-millimetre endpoint.
    assert(Math.hypot(end.x,end.z)>=.8+radius&&Math.hypot(end.x,end.z)<.8+radius+.3);
    assert(!isBlocked(end,radius,solids));assert(Math.hypot(end.x,end.z)<=MOVE_DESTINATION_RADIUS);
    let position=start;const state=createRouteState();
    for(let i=0;i<180&&path.length;i++)position=stepRoute('unit',position,path,state,1/30,3,radius,bounds,solids,[]).position;
    assert.equal(path.length,0);assert(Math.hypot(position.x-end.x,position.z-end.z)<1e-7);
  }
  const edge=planMoveDestination({x:0,z:0},{x:6,z:0},.29,bounds,[],[])!.at(-1)!;
  assert(edge.x<=4.71&&edge.x>4.41);assert.equal(edge.z,0);
});

test('a free but disconnected target falls back on the reachable side, without crossing the wall', () => {
  const start={x:-3,z:0}, point={x:1,z:0};
  const solids=[{kind:'box' as const,x:0,z:0,halfWidth:.3,halfDepth:5}];
  const path=planMoveDestination(start,point,.29,bounds,solids,[])!;
  assert(path);assert(path.at(-1)!.x<=-.59&&path.at(-1)!.x>-.89);
  let previous=start;
  for(const p of path){assert(segmentIsClear(previous,p,.29,bounds,solids));previous=p;}
});

test('no reachable location inside the radius fails, and exact work approaches stay exact', () => {
  const start={x:-4,z:0}, point={x:5,z:0};
  const solids=[{kind:'box' as const,x:-1.2,z:0,halfWidth:.3,halfDepth:5}];
  assert.equal(planMoveDestination(start,point,.29,bounds,solids,[]),undefined);
  assert.equal(planMoveDestination(start,{x:12,z:0},.29,bounds,[],[]),undefined);
  assert.equal(planMoveDestination(start,{x:NaN,z:0},.29,bounds,[],[]),undefined);
  assert.equal(planMoveDestination({x:-8,z:0},{x:0,z:0},.29,{minX:-10,maxX:10,minZ:-10,maxZ:10},[{kind:'circle',x:0,z:0,radius:6.1}],[]),undefined);
  assert.equal(planWorkApproach(start,[{x:0,z:0}],.29,bounds,[{kind:'circle',x:0,z:0,radius:.8}],[]),undefined);
});

test('a click deep in blocked land finds a reachable shore beyond the former three-unit radius',()=>{
  const start={x:-9,z:0},point={x:0,z:0},bounds={minX:-12,maxX:12,minZ:-12,maxZ:12};
  const solids=[{kind:'circle' as const,...point,radius:4.2}];
  for(const radius of [.29,.4,.6]){
    const path=planMoveDestination(start,point,radius,bounds,solids,[])!;assert(path);
    const end=path.at(-1)!;assert(Math.hypot(end.x,end.z)>=4.2+radius&&Math.hypot(end.x,end.z)<4.2+radius+.3);
    assert(Math.hypot(end.x,end.z)>3&&Math.hypot(end.x,end.z)<=6);
    let from=start;for(const p of path){assert(segmentIsClear(from,p,radius,bounds,solids));from=p;}
    assert.equal(planWorkApproach(start,[point],radius,bounds,solids,[]),undefined);
  }
});
