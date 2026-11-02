import { test,expect } from '@playwright/test';
import { Economy,encodeEconomy } from '../../src/game/economy.ts';
import { openGame,selectUnit,snapshot,panTo } from './helpers.ts';

test('a successful farmer task releases selection but briefly retains its real route, including pause',async({page},info)=>{
  test.setTimeout(150000);
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=600;e.state.residents.farmer={position:{x:-7,z:-1}};
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);await panTo(page,{x:-3,z:-2},true);await selectUnit(page,'farmer',true);
  await panTo(page,{x:2,z:-3},true);
  const plot=(await snapshot(page)).objects.find(o=>o.id==='plot-0')!;await page.touchscreen.tap(plot.screen.x,plot.screen.y);
  expect((await snapshot(page)).selection.resident).toBeUndefined();
  await expect.poll(async()=>(await snapshot(page)).pathGuidance.visible).toBe(true);
  expect((await snapshot(page)).pathGuidance.selected).toBe('farmer');
  await page.screenshot({path:info.outputPath('accepted-work-route.png'),scale:'css'});
  await page.locator('#settings').click();const frozen=(await snapshot(page)).pathGuidance;
  await page.waitForTimeout(500);expect((await snapshot(page)).pathGuidance).toEqual(frozen);
  await page.getByRole('button',{name:'继续游戏',exact:true}).click();
  await expect.poll(async()=>(await snapshot(page)).pathGuidance.visible,{timeout:20000}).toBe(false);
  expect((await snapshot(page)).economy.tasks.some(t=>t.worker==='farmer')).toBe(true);
  expect(errors).toEqual([]);
});
