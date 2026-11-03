import test from 'node:test';import assert from 'node:assert/strict';
import {arrowFlight} from '../src/game/arrow-flight.ts';
test('arrows follow the parabola tangent at launch, apex and landing, including tower shots',()=>{
  for(const fromY of [1.25,3.5]){
    const shot={from:{x:0,y:fromY,z:0},to:{x:7,y:1.25,z:2},elapsed:0,duration:1};
    assert.deepEqual(arrowFlight(shot).position,shot.from);assert.deepEqual(arrowFlight({...shot,elapsed:1}).position,shot.to);
    for(const elapsed of [.05,.3,.5,.75,.95]){
      const a=arrowFlight({...shot,elapsed}),b=arrowFlight({...shot,elapsed:elapsed+.00001});
      assert(Math.abs((b.position.y-a.position.y)/.00001-a.tangent.y)<.001);
      const lagged=arrowFlight({...shot,elapsed:elapsed+.1},.1).position;assert(Math.hypot(lagged.x-a.position.x,lagged.y-a.position.y,lagged.z-a.position.z)<1e-9);
    }
    assert(arrowFlight({...shot,elapsed:0}).tangent.y>0);assert(arrowFlight({...shot,elapsed:1}).tangent.y<0);
  }
});
