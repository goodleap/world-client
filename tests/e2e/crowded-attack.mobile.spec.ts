import {test,expect} from '@playwright/test';
import {Economy,encodeEconomy,decodeEconomy} from '../../src/game/economy.ts';
import {newResident} from '../../src/game/resident-data.ts';
import {createFighter} from '../../src/game/combat.ts';
import {initialVital} from '../../src/game/vitals.ts';
import {openGame,snapshot} from './helpers.ts';

test('rear formation member advances while the front occupies every attack position',async({page},info)=>{
  test.setTimeout(120000);const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  for(const u of e.state.combat.units)if(u.team==='home')u.position={x:50,z:-70};
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  for(const id of ['farmer','farmer-2','farmer-leader','dog']){e.state.vitals[id].hp=0;e.state.vitals[id].diedAt=0;}
  const target=e.state.combat.units.find(u=>u.id==='enemy-guard')!,rear=e.state.combat.units.find(u=>u.id==='infantry')!;
  target.position={x:0,z:-2};target.cooldown=8;target.order='attack';
  const ids=[rear.id];
  for(let i=0;i<8;i++){
    const id=`recruit-infantry-${i+1}`,angle=i*Math.PI/4,definition=newResident('infantry',id,{x:Math.cos(angle)*1.35,z:-2+Math.sin(angle)*1.35});
    e.state.recruitment.roster.push(definition);e.state.vitals[id]=initialVital(id);e.state.vitals[id].manualUntil=1000;
    const front=createFighter(definition);front.order='attack';front.target=front.commandTarget=target.id;front.cooldown=8;e.state.combat.units.push(front);ids.push(id);
  }
  e.state.recruitment.nextId=9;e.state.groups[0]=ids.slice(0,6);target.target=ids[1];
  rear.position={x:-6,z:-8};rear.order='attack';rear.target=rear.commandTarget=target.id;rear.cooldown=8;
  decodeEconomy(encodeEconomy(e));
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);await page.locator('#group-shortcuts [data-group="0"]').click();
  const before=await snapshot(page),start=before.residents.find(r=>r.id==='infantry')!;
  await expect.poll(async()=>{
    const s=await snapshot(page),u=s.economy.combat.units.find(u=>u.id===rear.id)!,v=s.economy.combat.units.find(u=>u.id===target.id)!;
    return Math.hypot(u.position.x-v.position.x,u.position.z-v.position.z);
  },{timeout:60000}).toBeLessThan(4);
  const after=await snapshot(page),end=after.residents.find(r=>r.id==='infantry')!;
  expect(Math.hypot(end.position.x-start.position.x,end.position.z-start.position.z)).toBeGreaterThan(3);
  expect(after.economy.combat.units.find(u=>u.id===target.id)!.hp).toBeGreaterThan(0);
  expect(after.economy.combat.units.find(u=>u.id===rear.id)!.commandTarget).toBe(target.id);
  await page.screenshot({path:info.outputPath('rear-joins-front.png')});expect(errors).toEqual([]);
});
