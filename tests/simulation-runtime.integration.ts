import test from 'node:test';
import assert from 'node:assert/strict';
import {initialEconomy,Economy,decodeEconomy} from '../src/game/economy.ts';
import {createSimulation} from '../src/game/simulation.ts';
import {simulationView,createSimulationPublisher,applySimulationPatch,updateEconomyReplica} from '../src/game/simulation-state.ts';
import {createFighter,fighterStats} from '../src/game/combat.ts';
import {newResident} from '../src/game/resident-data.ts';
import {initialVital} from '../src/game/vitals.ts';
import {RAID_DESTINATION} from '../src/game/debug-raids.ts';

test('authoritative simulation replicates moves, recruitment, groups and save/reload without losing commands',async()=>{
  const state=initialEconomy(391,true);state.steward.enabled=false;state.raids.nextAt=100000;state.raids.warningAt=100000;
  const sim=await createSimulation(state);let saved='';
  try{
    const view=structuredClone(simulationView(sim)),publisher=createSimulationPublisher(view),replica=new Economy(structuredClone(state));
    assert((await sim.command({type:'move',ids:['farmer'],point:{x:9,z:2}})).ok);
    for(let i=0;i<100;i++){sim.step(.05);applySimulationPatch(view,publisher.diff(simulationView(sim)));updateEconomyReplica(replica,view);}
    const p=sim.residents.farmerPosition();assert(Math.hypot(p.x-9,p.z-2)<.05);
    assert.deepEqual(JSON.parse(JSON.stringify(view)),JSON.parse(JSON.stringify(simulationView(sim))));
    for(const role of ['infantry','archer','cavalry'] as const)await sim.command({type:'home',action:{type:'recruit',role}});
    for(let i=0;i<120;i++)sim.step(.05);
    assert.deepEqual(state.recruitment.roster.map(r=>r.role),['infantry','archer','cavalry']);
    const ids=state.recruitment.roster.map(r=>r.id);
    assert((await sim.command({type:'home',action:{type:'group',index:0,members:ids}})).ok);
    assert((await sim.command({type:'move',ids,point:{x:8,z:1},group:0})).ok);
    applySimulationPatch(view,publisher.diff(simulationView(sim)));updateEconomyReplica(replica,view);
    assert.equal(replica.state.combat.units.length,3);assert.deepEqual(replica.state.groups[0],ids);
    saved=sim.save();assert.equal(decodeEconomy(saved).state.seconds,state.seconds);
  }finally{sim.dispose();}
  const loaded=decodeEconomy(saved),again=await createSimulation(loaded.state);
  try{const before=loaded.state.seconds;again.step(.05);assert.equal(loaded.state.seconds,before+.05);assert.equal(again.combat.state.units.length,3);
    assert(again.combat.state.units.some(u=>u.goal||u.route.length),'formation command survives reload');
  }finally{again.dispose();}
});

test('each incoming soldier marches at its own speed before acquiring a target',async()=>{
  for(const role of ['infantry','archer','cavalry'] as const){
    const state=initialEconomy(391,true);state.steward.enabled=false;state.raids.nextAt=state.raids.warningAt=100000;
    const u=createFighter(newResident(role,`enemy-raid-${role}-1-0`,{x:-23.6,z:-54.03}));
    u.goal={...RAID_DESTINATION};state.combat.units.push(u);state.vitals[u.id]=initialVital(u.id);
    state.raids.phase='raid';state.raids.wave=1;state.raids.soldiers=[u.id];
    const sim=await createSimulation(state);
    try{for(let i=0;i<60;i++){
      sim.step(.05);
      if(i>30){
        assert.equal(u.order,'guard');assert(!u.target);
        assert(Math.abs(u.speed-fighterStats(u).speed)<.02,`${role} assault must not inherit patrol speed: ${u.speed}`);
      }
    }}finally{sim.dispose();}
  }
});
