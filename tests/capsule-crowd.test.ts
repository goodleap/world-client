import test from 'node:test';import assert from 'node:assert/strict';
import {bodyAtClear,bodySegmentClear,bodyTurnClear,bodyObstacle,CAVALRY_BODY} from '../src/game/body-shape.ts';
import {findPath} from '../src/game/pathfinding.ts';import {createRouteState,stepRoute,yieldPoint} from '../src/game/route-following.ts';
import {isBlocked} from '../src/game/movement.ts';import type {Obstacle,Point} from '../src/game/movement.ts';
const bounds={minX:-8,maxX:8,minZ:-8,maxZ:8},radius=CAVALRY_BODY.radius,body={halfLength:CAVALRY_BODY.halfLength,heading:0};
const walls:Obstacle[]=[{kind:'box',x:-2,z:0,halfWidth:1.4,halfDepth:3},{kind:'box',x:2,z:0,halfWidth:1.4,halfDepth:3}];
test('a mounted capsule fits a straight 1.2-wide passage but rejects sideways turns and nose penetration',()=>{
  assert(bodySegmentClear({x:0,z:-5},{x:0,z:5},radius,body,bounds,walls));
  assert(!bodyTurnClear({x:0,z:0},radius,body,Math.PI/2,bounds,walls));
  assert(!bodyAtClear({x:0,z:0},radius,body,bounds,[{kind:'box',x:0,z:1,halfWidth:.3,halfDepth:.2}]));
  const capsule=bodyObstacle({x:0,z:0},radius,body);
  assert(isBlocked({x:0,z:1},.2,[capsule]));assert(!isBlocked({x:.8,z:0},.2,[capsule]));
});
test('orientation-aware search and follower navigate around a wall without clipping during turns',()=>{
  const solids:Obstacle[]=[{kind:'box',x:0,z:0,halfWidth:1.2,halfDepth:1.2}];
  let position={x:-4,z:0},b={...body,heading:Math.PI/2};const destination={x:4,z:0};
  const route=findPath(position,destination,radius,bounds,solids,.5,b);assert(route?.length);
  const state=createRouteState();for(let i=0;i<800&&route.length;i++){
    const next=stepRoute('cavalry',position,route,state,.05,2,radius,bounds,solids,[],b);
    position=next.position;b={...b,heading:next.facing??b.heading};assert(bodyAtClear(position,radius,b,bounds,solids));
  }
  assert.equal(route.length,0);assert(Math.hypot(position.x-4,position.z)<.02);
});
test('an idle friend yields from a route and a following column clears the narrow passage',()=>{
  const actors=[{id:'lead',p:{x:0,z:-4},route:[{x:0,z:4}],state:createRouteState(),moving:false},{id:'rear',p:{x:0,z:-5.3},route:[{x:0,z:5.5}],state:createRouteState(),moving:false}];
  let idle:Point={x:0,z:4},idleRoute:Point[]=[],yielded=false;const idleState=createRouteState();
  for(let i=0;i<800&&(actors.some(a=>a.route.length)||idleRoute.length);i++){
    for(const a of actors){const others=actors.filter(b=>b!==a).map(b=>({id:b.id,position:b.p,radius:.4,moving:b.moving,purposeful:!!b.route.length,waiting:b.state.waiting,heading:0}));
      const next=stepRoute(a.id,a.p,a.route,a.state,.05,2,.4,bounds,walls,[...others,{id:'idle',position:idle,radius:.4,moving:!!idleRoute.length,purposeful:!!idleRoute.length,waiting:false,yield:(from,toward)=>{const p=yieldPoint(idle,from,toward,.4,bounds,walls,[...others,{id:a.id,position:a.p,radius:.4,moving:true,purposeful:true,waiting:false}]);if(p){idleRoute=[p];yielded=true;return true;}return false;}}]);a.p=next.position;a.moving=Math.hypot(next.velocity.x,next.velocity.z)>.01;
    }
    const next=stepRoute('idle',idle,idleRoute,idleState,.05,2,.4,bounds,walls,actors.map(a=>({id:a.id,position:a.p,radius:.4,moving:a.moving,purposeful:true,waiting:a.state.waiting})));idle=next.position;
    assert(Math.hypot(actors[0].p.x-actors[1].p.x,actors[0].p.z-actors[1].p.z)>=.8-1e-7);
  }
  assert(yielded);assert(actors.every(a=>a.route.length===0));
});
test('mounted arrival reserves the entire capsule, including the nose and tail',async()=>{
  const {planMoveDestination}=await import('../src/game/work-navigation.ts');
  const neighbour={position:{x:0,z:1},radius:.35},start={x:0,z:-4};
  const planned=planMoveDestination(start,{x:0,z:0},radius,bounds,[],[neighbour],body);assert(planned?.length);
  const {validateNavigation}=await import('../src/game/navigation-plan.ts');
  const route=validateNavigation({start,goal:{x:0,z:0},radius,bounds,solids:[],neighbours:[neighbour],body},planned);assert(route?.length);
  const end=route.at(-1)!,before=route.at(-2)??start,heading=Math.atan2(end.x-before.x,end.z-before.z);
  assert(bodyAtClear(end,radius+.08,{...body,heading},bounds,[bodyObstacle(neighbour.position,neighbour.radius)]));
});
