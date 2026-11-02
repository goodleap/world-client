import {expect} from '@playwright/test';
import type {Page,TestInfo} from '@playwright/test';
import {Economy,encodeEconomy} from '../../src/game/economy.ts';
import {buildingAt} from '../../src/game/construction.ts';
import {newTower} from '../../src/game/towers.ts';
import {openGame,snapshot,panTo,clickGround} from './helpers.ts';

export async function checkPerformanceTower(page:Page,info:TestInfo,touch:boolean){
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=600;
  const site=buildingAt('tower',{x:18,z:0},'site-0');e.state.sites.push(site);e.state.buildings.push(site.id);e.state.nextSiteId=1;e.state.towers.push(newTower(site));
  for(const u of e.state.combat.units){u.position={x:u.team==='home'?-45:45,z:45};u.order='hold';}
  e.state.combat.units.find(u=>u.id==='archer')!.position={x:site.x,z:site.z-6};
  await page.addInitScript(save=>{if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);},encodeEconomy(e));
  const errors=await openGame(page);
  await page.locator('#settings').click();await page.locator('#settings-graphics').click();
  const frozen=(await snapshot(page)).economy.seconds,readings=[];
  for(const [mode,scale,mapSize] of [['standard',1,touch?1024:2048],['saving',.8,touch?512:1024],['minimum',.65,touch?1024:2048]] as const){
    await page.locator('#performance-mode').selectOption(mode);
    await expect.poll(async()=>(await snapshot(page)).graphics.mode).toBe(mode);
    const s=await snapshot(page);readings.push({graphics:s.graphics,shadows:{enabled:s.shadows.enabled,mapSize:s.shadows.mapSize}});
    expect(Math.abs(s.size.width-page.viewportSize()!.width*scale)).toBeLessThanOrEqual(1);
    expect(s.shadows.enabled).toBe(mode!=='minimum');expect(s.shadows.mapSize).toBe(mapSize);expect(s.economy.seconds).toBe(frozen);
  }
  await expect(page.locator('#shadows-enabled')).toBeDisabled();
  await page.screenshot({path:info.outputPath('performance-settings.png'),scale:'css'});
  await page.locator('#graphics-back').click();await page.locator('#continue-game').click();
  await panTo(page,site,touch);
  // Pick the solid roof through the real native mesh hit test, also at 65% rendering resolution.
  await clickGround(page,site,touch,6.6);
  await expect(page.locator('[data-action="tower-garrison"]')).toBeVisible();
  await page.locator('[data-action="tower-garrison"]').click();
  await expect.poll(async()=>(await snapshot(page)).economy.towers[0].phase,{timeout:30000}).toBe('occupied');
  let s=await snapshot(page);expect(s.residents.find(r=>r.id==='archer')!.elevation).toBe(3.15);
  await page.screenshot({path:info.outputPath('tower-game.png'),scale:'css'});
  await page.locator('[data-action="tower-select"]').click();
  await expect(page.locator('#resident-selection')).toContainText('塔上驻守');
  await page.screenshot({path:info.outputPath('archer-garrison.png'),scale:'css'});
  await page.locator('#settings').click();s=await snapshot(page);
  await page.waitForTimeout(500);expect((await snapshot(page)).economy.seconds).toBe(s.economy.seconds);
  await page.locator('#return-menu').click();await page.reload();await page.locator('#continue-save').click();
  await expect(page.locator('#loading')).toHaveClass(/loaded/,{timeout:90000});
  expect((await snapshot(page)).graphics.mode).toBe('minimum');expect((await snapshot(page)).economy.towers[0].phase).toBe('occupied');
  await panTo(page,site,touch);await clickGround(page,site,touch,6.6);
  await page.locator('[data-action="tower-evict"]').click();
  await expect.poll(async()=>(await snapshot(page)).economy.towers[0].phase).toBe('empty');
  await expect.poll(async()=>(await snapshot(page)).residents.find(r=>r.id==='archer')!.elevation).toBe(0);
  await info.attach('graphics-readings',{body:JSON.stringify(readings,null,2),contentType:'application/json'});
  expect(errors).toEqual([]);
}
