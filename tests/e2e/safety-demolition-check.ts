import {expect} from '@playwright/test';import type {Page,TestInfo} from '@playwright/test';
import {Economy,encodeEconomy} from '../../src/game/economy.ts';import {HOME_CENTER,HOME,WAREHOUSE} from '../../src/game/world-data.ts';
import {buildingAt} from '../../src/game/construction.ts';import {openGame,snapshot,panTo,clickGround,selectUnit} from './helpers.ts';
export async function checkSafetyDemolition(page:Page,info:TestInfo,touch:boolean){
  info.setTimeout(240000);const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  const s=buildingAt('house',{x:-10,z:-10},'site-0');e.state.sites.push(s);e.state.buildings.push(s.id);e.state.nextSiteId=1;
  const task=e.request('sow','plot-2','wheat').task!;task.watchPath=[{x:10,z:10}];e.holdDanger(task);e.state.combat.units.find(u=>u.id==='enemy-guard')!.position={x:10,z:10};
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);
  // The three LOD templates previously formed ghost buildings near the origin.
  await panTo(page,{x:0,z:0},touch);
  for(const p of [{x:0,z:1.3},{x:1,z:2.4},{x:-1,z:2.4}]){await clickGround(page,p,touch);expect(['home-center','cottage','warehouse']).not.toContain((await snapshot(page)).selection.object?.id);}
  await page.screenshot({path:info.outputPath('junction-picking.png'),scale:'css'});
  for(const b of [HOME,WAREHOUSE,HOME_CENTER]){await page.keyboard.press('Escape');await panTo(page,b,touch);await clickGround(page,{x:b.x-.35,z:b.z-b.depth/2-.2},touch,1.4);await expect.poll(async()=>(await snapshot(page)).selection.object?.id).toBe(b.id);}
  await page.locator('#home-resources').click();await page.getByRole('tab',{name:'建筑',exact:true}).click();
  const row=page.locator('[data-building="site-0"]');await row.getByRole('button',{name:/拆除/}).click();
  await expect(page.locator('#demolish-dialog')).toBeVisible();await page.screenshot({path:info.outputPath('demolition-confirm.png'),scale:'css'});
  await page.getByRole('button',{name:'取消拆除',exact:true}).click();expect((await snapshot(page)).economy.sites.some(v=>v.id==='site-0')).toBe(true);
  await row.getByRole('button',{name:/拆除/}).click();await page.locator('#demolish-confirm').click();await expect(row).toHaveCount(0);
  const saved=await snapshot(page);expect(saved.economy.sites).toHaveLength(0);expect(saved.economy.goods.some(g=>g.resource==='wood'&&g.state==='ground')).toBe(true);
  await page.screenshot({path:info.outputPath('building-list.png'),scale:'css'});await page.getByRole('button',{name:'关闭家园面板'}).click();
  await panTo(page,{x:-4,z:-4},touch);await selectUnit(page,'cavalry',touch);const before=(await snapshot(page)).combat.units.find(u=>u.id==='cavalry')!.position;
  await clickGround(page,{x:-3.5,z:-1},touch);await expect.poll(async()=>{const u=(await snapshot(page)).combat.units.find(u=>u.id==='cavalry')!;return Math.hypot(u.position.x-before.x,u.position.z-before.z);},{timeout:30000}).toBeGreaterThan(1);
  const poses=[];for(let i=0;i<4;i++){poses.push((await snapshot(page)).combat.units.find(u=>u.id==='cavalry'));await page.waitForTimeout(250);}
  await info.attach('mounted-motion',{body:JSON.stringify(poses),contentType:'application/json'});await page.screenshot({path:info.outputPath('mounted-game.png'),scale:'css'});
  expect(errors).toEqual([]);
}
