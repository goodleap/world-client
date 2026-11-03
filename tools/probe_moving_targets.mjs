// Deterministic open-ground return scenario; run with Node 24.
import {Economy} from '../src/game/economy.ts';
import {Combat, fighterStats} from '../src/game/combat.ts';
for(const id of ['infantry','cavalry','archer']){
 const e=new Economy();e.setLeadership(false);const c=new Combat(e.state.combat,e,()=>[]);
 for(const u of c.state.units){u.life='defeated';u.hp=0;u.diedAt=0;u.order='hold';}
 const a=c.unit(id),b=c.unit('enemy-guard');
 for(const u of [a,b]){u.life='active';u.hp=fighterStats(u).hp;u.diedAt=undefined;}
 b.position={x:b.home.x+20,z:b.home.z};b.order='hold';b.goal={...b.home};b.route=[{...b.home}];b.cooldown=8;
 a.position={x:b.position.x+fighterStats(a).range+.1,z:b.position.z};
 c.attack([a.id],b.id);let attacks=0,hits=0,serial=0,hp=b.hp,firstHit=null;const start={...a.position};
 for(let i=0;i<100&&b.hp;i++){
  e.state.seconds+=.05;c.update(.05);
  if(a.attack&&a.attack.id!==serial){serial=a.attack.id;attacks++;}
  if(b.hp<hp){hits++;firstHit??=e.state.seconds;}hp=b.hp;
 }
 console.log(JSON.stringify({role:id,attacks,hits,firstHit,hp:b.hp,attackerTravel:+Math.hypot(a.position.x-start.x,a.position.z-start.z).toFixed(2),remainingReturn:+Math.hypot(b.position.x-b.home.x,b.position.z-b.home.z).toFixed(2)}));
}
