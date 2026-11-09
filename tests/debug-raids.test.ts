import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { MAP_DEVELOPMENT } from '../src/game/opening-profile.ts';
import { Economy, initialEconomy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { Combat } from '../src/game/combat.ts';
import { DebugRaids, DEBUG_RAID_ENTRANCES, RAID_DESTINATION } from '../src/game/debug-raids.ts';
import { DEBUG_RAID_CONFIG as C } from '../src/game/raid-state.ts';
import { DEATH_END } from '../src/game/death.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { isBlocked } from '../src/game/movement.ts';
import { segmentIsClear } from '../src/game/wander.ts';
import { HOME_CENTER, WORLD_BOUNDS } from '../src/game/world-data.ts';
import { Raids } from '../src/game/raids.ts';
import { RESIDENTS } from '../src/game/resident-data.ts';
import { buildingInfo } from '../src/game/building-state.ts';
import { usePathPlanner } from '../src/game/path-planner.ts';

if(!MAP_DEVELOPMENT){
  test('debug assault checks with the map-development opening and native navigation',()=>{
    execFileSync(process.execPath,['--import',new URL('./native-test-runtime.ts',import.meta.url).href,'--test','--test-isolation=none',import.meta.filename],{
      env:{...process.env,VITE_MAP_DEVELOPMENT:'true'},timeout:60000,stdio:'pipe',
    });
  });
}else{
  const setup=(e=new Economy(initialEconomy(4,true)))=>{
    const c=new Combat(e.state.combat,e,()=>[]),r=new DebugRaids(e,c,()=>[]);
    // Keep producer tests independent of combat/route timings; existing troops
    // stay alive in a separate staging area while new waves enter the map.
    const tick=()=>{
      e.state.seconds+=.25;r.update();
      c.state.units.forEach((u,i)=>{u.position={x:30+(i%12)*1.7,z:8+Math.floor(i/12)*1.7};});
    };
    return {e,c,r,tick};
  };
  test('debug waves overlap, retain partial-batch progress on reload and keep the bounded population replenished',()=>{
    let s=setup();
    while(s.e.state.seconds<6)s.tick();
    assert(s.r);assert(s.e.state.raids.pendingCount>0);
    const ids=[...s.e.state.raids.soldiers],wave=s.e.state.raids.wave,remaining=s.e.state.raids.pendingCount;
    const restored=decodeEconomy(encodeEconomy(s.e));
    assert.equal(restored.state.raids.pendingCount,remaining);assert.equal(restored.state.raids.wave,wave);
    s=setup(restored);while(s.e.state.seconds<70)s.tick();
    assert.equal(s.c.state.units.length,C.maxSoldiers);
    assert(ids.every(id=>s.e.state.raids.soldiers.includes(id)),'later batches do not erase earlier living enemies');
    assert.deepEqual(new Set(s.c.state.units.map(u=>u.role)),new Set(['infantry','archer','cavalry']));
    const victim=s.c.state.units[0];victim.life='defeated';victim.hp=0;victim.diedAt=s.e.state.seconds;
    const before=[...s.e.state.raids.soldiers];
    for(let i=0;i<DEATH_END*4-1;i++)s.tick();
    assert(s.c.unit(victim.id),'retain the full fall/hold/sink sequence');
    for(let i=0;i<45;i++)s.tick();
    assert(!s.c.unit(victim.id));assert(!s.e.state.vitals[victim.id]);
    assert.equal(s.c.state.units.length,C.maxSoldiers);
    assert(s.e.state.raids.soldiers.some(id=>!before.includes(id)),'losses are replenished');
    assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(s.e)));
  });
  test('debug permission gates spawning and pending Worker searches cannot leak half-created troops',()=>{
    const normal=setup(new Economy(initialEconomy(4)));normal.e.state.seconds=1000;normal.r.update();
    assert.equal(normal.c.state.units.length,0);
    const e=new Economy(initialEconomy(4,true)),solids=economyObstacles([],[],[]),c=new Combat(e.state.combat,e,()=>solids);
    const r=new DebugRaids(e,c,()=>solids);e.state.seconds=6;e.state.raids.wave=1;
    const release=usePathPlanner(()=>null);
    try{for(let i=0;i<12;i++)r.update();assert.equal(c.state.units.length,0);assert.equal(e.state.raids.wave,1);}
    finally{release();}
    assert.doesNotThrow(()=>decodeEconomy(encodeEconomy(e)));
  });
  test('all edge entrances connect to the relocated home, and raiders actually advance and damage it',()=>{
    const solids=economyObstacles([],[],[]);
    for(let wave=0;wave<DEBUG_RAID_ENTRANCES.length;wave++){
      const e=new Economy(initialEconomy(4,true)),c=new Combat(e.state.combat,e,()=>solids),r=new DebugRaids(e,c,()=>solids);
      e.state.raids.wave=wave;e.state.seconds=6;
      for(let i=0;i<100&&!c.state.units.length;i++){e.state.seconds+=.25;r.update();}
      const u=c.state.units[0];assert(u,`entrance ${wave}`);
      assert(Math.hypot(u.home.x-HOME_CENTER.x,u.home.z-HOME_CENTER.z)>45);
      assert(!isBlocked(u.position,.72,solids));
      let previous=u.position;
      for(const point of u.route){assert(segmentIsClear(previous,point,.72,WORLD_BOUNDS,solids));previous=point;}
      const start={...u.position};
      for(let i=0;i<40;i++){e.state.seconds+=.05;c.update(.05);}
      assert(Math.hypot(u.position.x-start.x,u.position.z-start.z)>2,'follows the real map corridor');
      assert(!isBlocked(u.position,.4,solids));
    }
    const e=new Economy(initialEconomy(4,true)),c=new Combat(e.state.combat,e,()=>solids),producer=new DebugRaids(e,c,()=>solids);
    e.state.seconds=6;producer.update();const u=c.state.units[0];assert(u);
    // Isolate arrival/attack behavior from the long edge-to-home journey.
    u.position={x:HOME_CENTER.x,z:HOME_CENTER.z-HOME_CENTER.depth/2-.8};u.route=[];u.goal={...RAID_DESTINATION};
    c.setResidentPositions(()=>({x:60,z:60}));
    for(let i=0;i<80;i++){e.state.seconds+=.05;c.update(.05);}
    assert(buildingInfo(e.state,'home-center')!.hp<1500,'attacks the actual relocated building');
    assert.equal(u.target,'home-center');
    const people={status:(id:string)=>({position:RESIDENTS.find(r=>r.id===id)!.spawn,moving:false}),command:()=>false,release(){},resting(){},neighbours:()=>[]};
    const raids=new Raids(e,c,people,()=>solids,()=>false),before=encodeEconomy(e);
    raids.update(0);raids.update(-1);assert.equal(encodeEconomy(e),before,'pause does not spawn or advance timers');
    e.state.seconds+=180;raids.update(.05);assert.notEqual(u.order,'retreat','debug attackers do not time out');
  });
}
