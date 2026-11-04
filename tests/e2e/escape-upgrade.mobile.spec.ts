import {test,expect} from '@playwright/test';
import {Economy,encodeEconomy} from '../../src/game/economy.ts';
import {openGame,snapshot} from './helpers.ts';

test('farmers and dogs run away after actual hits despite manual grace',async({page},info)=>{
  test.setTimeout(120000);const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  for(const u of e.state.combat.units)if(u.team==='home')u.position={x:50,z:-70};
  const starts={farmer:{x:4,z:-3},dog:{x:0,z:-5}};
  for(const [id,point] of Object.entries(starts)){e.state.residents[id]={position:point};e.state.vitals[id].manualUntil=1000;}
  for(const [id,victim] of [['enemy-guard','farmer'],['enemy-sentry','dog']] as const){
    const u=e.state.combat.units.find(u=>u.id===id)!,p=starts[victim];u.position={x:p.x+1,z:p.z};u.order='attack';u.target=victim;
  }
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);
  await expect.poll(async()=>{
    const s=await snapshot(page);return Object.entries(starts).every(([id,start])=>s.economy.vitals[id].hp!<(id==='dog'?80:100)&&Math.hypot(s.residents.find(r=>r.id===id)!.position.x-start.x,s.residents.find(r=>r.id===id)!.position.z-start.z)>2);
  },{timeout:45000}).toBe(true);
  const a=await snapshot(page),poses=a.residents.filter(r=>r.id==='farmer'||r.id==='dog');
  expect(poses.some(r=>r.motion==='run')).toBe(true);await page.screenshot({path:info.outputPath('farmer-dog-escape.png')});
  await expect.poll(async()=>{
    const s=await snapshot(page);return poses.every(p=>{const r=s.residents.find(r=>r.id===p.id)!;return Math.hypot(r.position.x-p.position.x,r.position.z-p.position.z)>1;});
  },{timeout:20000}).toBe(true);
  await page.screenshot({path:info.outputPath('escape-continuing.png')});expect(errors).toEqual([]);
});

test('both armies show a level-up effect on real damage and the effect pauses with the game',async({page},info)=>{
  test.setTimeout(90000);const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;
  const a=e.state.combat.units.find(u=>u.id==='infantry')!,b=e.state.combat.units.find(u=>u.id==='enemy-guard')!;
  a.position={x:4,z:-2};b.position={x:5.2,z:-2};a.order=b.order='attack';a.target=b.id;b.target=a.id;a.commandTarget=b.id;a.experience=b.experience=199;
  await page.addInitScript(save=>{
    localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');
    let seen=0;const watch=()=>{if(window.__DEMO__&&document.querySelectorAll('.level-number:not([hidden])').length>=2&&++seen>=3){document.getElementById('settings')!.click();return;}requestAnimationFrame(watch);};requestAnimationFrame(watch);
  },encodeEconomy(e));
  const errors=await openGame(page);await expect(page.locator('#settings-dialog')).toBeVisible();
  const labels=page.locator('.level-number:not([hidden])');await expect(labels).toHaveCount(2);
  expect(await labels.allTextContents()).toEqual(['Lv. 2','Lv. 2']);
  for(const text of await page.locator('.damage-number:not([hidden])').allTextContents())expect(text).toMatch(/^\d+$/);
  const before=await labels.evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.cssText));
  await page.waitForTimeout(250);expect(await labels.evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.cssText))).toEqual(before);
  const hide=await page.addStyleTag({content:'#settings-dialog { visibility:hidden; } #settings-dialog::backdrop { background:transparent; backdrop-filter:none; }'});
  await page.screenshot({path:info.outputPath('both-teams-upgrade.png')});await hide.evaluate(el=>(el as HTMLElement).remove());
  await page.locator('#continue-game').click();await expect(labels).toHaveCount(0);
  expect((await page.evaluate(()=>window.__DEMO__!.frameSnapshot())).levels.shown).toBe(2);expect(errors).toEqual([]);
});
