/** Bounded, reproducible current-map workload. Run with VITE_MAP_DEVELOPMENT=true. */
import { writeFileSync } from 'node:fs';
import { initialEconomy, Economy, encodeEconomy, decodeEconomy } from '../src/game/economy.ts';
import { createSimulation } from '../src/game/simulation.ts';
import { newResident } from '../src/game/resident-data.ts';
import { createFighter } from '../src/game/combat.ts';
import { bodiesFor, initialVital } from '../src/game/vitals.ts';
import { economyObstacles } from '../src/game/economy-config.ts';
import { isBlocked } from '../src/game/movement.ts';
import { createSimulationPublisher, simulationView } from '../src/game/simulation-state.ts';

const small=process.argv.includes('--small'),state=initialEconomy(391,true);
state.steward.enabled=false;state.raids.nextAt=100000;state.raids.warningAt=100000;
const solids=economyObstacles(state.depleted,state.sites,state.buildings),homeCount=small?3:100,enemyCount=small?0:72;
const spots=(left:boolean)=>{const points=[];for(let z=-27;z<=-10;z+=1.6)for(let x=left?-22:5;x<=(left?0:27);x+=1.6)if(!isBlocked({x,z},.72,solids))points.push({x,z});return points;};
for(const [enemy,count,points]of [[false,homeCount,spots(true)],[true,enemyCount,spots(false)]] as const){
  if(points.length<count)throw new Error('Not enough clear workload spawn points: '+points.length);
  for(let i=0;i<count;i++){
    const role=(['infantry','archer','cavalry'] as const)[i%3],id=enemy?`enemy-raid-${role}-${Math.floor(i/12)+1}-${i%12}`:`recruit-${role}-${i+1}`;
    const point=small?{x:2+i*2,z:-2}:points[i],definition=newResident(role,id,point),u=createFighter(definition);
    for(const body of bodiesFor(id))state.vitals[body]=initialVital(body);
    if(enemy)state.raids.soldiers.push(id);else{state.recruitment.roster.push(definition);state.recruitment.nextId=i+2;}
    state.combat.units.push(u);u.order='move';u.goal=small?{x:point.x,z:18}:{x:enemy?-9:12,z:point.z};
    state.vitals[id].manualUntil=100000;
  }
}
state.raids.wave=6;state.raids.phase=enemyCount?'raid':'peace';if(enemyCount)state.raids.origin={...spots(false)[0]};
if(small){state.residents.farmer={position:{x:0,z:-2},manualGoal:{x:0,z:18}};state.vitals.farmer.manualUntil=100000;}
const save=encodeEconomy(new Economy(state));decodeEconomy(save);
writeFileSync(small?'/tmp/worker-small-save.json':'/tmp/worker-175-save.json',save);
if(process.argv.includes('--fixture-only'))process.exit(0);
const start=performance.now(),sim=await createSimulation(state),loadMs=performance.now()-start;
console.log(JSON.stringify({loadMs,initial:sim.diagnostics()}));
const pub=createSimulationPublisher(simulationView(sim)),times:number[]=[],replication:number[]=[];let damage=0,moving=0;
const before=new Map(state.combat.units.map(u=>[u.id,{...u.position,hp:u.hp}]));
try{
  for(let i=0;i<240;i++){
    const begin=performance.now();sim.step(.05);times.push(performance.now()-begin);
    pub.diff(simulationView(sim));replication.push(pub.snapshot().lastMs);
    if(i%60===59)console.log(JSON.stringify({step:i+1,systems:sim.diagnostics()}));
  }
  for(const u of state.combat.units){const p=before.get(u.id);if(p&&Math.hypot(u.position.x-p.x,u.position.z-p.z)>1)moving++;if(p&&u.hp<p.hp)damage++;}
  const sorted=[...times].sort((a,b)=>a-b),result={loadMs,steps:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),
    replicationMeanMs:replication.reduce((a,b)=>a+b,0)/replication.length,moving,damaged:damage,diagnostics:sim.diagnostics()};
  const decoded=decodeEconomy(sim.save());if(Math.abs(decoded.state.seconds-state.seconds)>1e-6)throw new Error('Save time mismatch');
  writeFileSync('/tmp/worker-runtime-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{sim.dispose();}
