import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { openGame, snapshot, selectUnit, panTo } from './helpers.ts';

test('shared Hammer plays during real work, freezes in settings and settles once at the existing work duration', async({page},info)=>{
  test.setTimeout(180000);
  const e=new Economy();e.setLeadership(false);e.state.inventory.wood=30;e.state.inventory.iron=30;
  const job=e.request('arms','warehouse');expect(job.ok).toBe(true);
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);
  await expect.poll(async()=>(await snapshot(page)).farmerModel.motion,{timeout:60000}).toBe('work');
  let s=await snapshot(page);
  expect(s.farmerModel.animations).toContain('Hammer');
  // The game scales native animation time down alongside its 250 ms frame
  // clamp on software GPUs. It must run, but never exceed the normal 2x rate.
  expect(s.farmerModel.effectiveWorkPlaybackRate).toBeGreaterThan(0);
  expect(s.farmerModel.effectiveWorkPlaybackRate).toBeLessThanOrEqual(2);
  await panTo(page,s.residents.find(r=>r.id==='farmer')!.position);
  await selectUnit(page,'farmer');
  await expect(page.locator('#resident-activity')).toHaveText('正在锻制装备');
  const before=await snapshot(page);
  await expect.poll(async()=>(await snapshot(page)).farmerModel.pose).not.toEqual(before.farmerModel.pose);
  await page.locator('#building-toggle').click();
  expect((await snapshot(page)).selection.resident).toBe('farmer');
  await expect(page.locator('#resident-activity')).toHaveText('正在锻制装备');
  await page.screenshot({path:info.outputPath('hammer-working-desktop.png')});
  await page.locator('#settings').click();
  const frozen=await snapshot(page);await page.waitForTimeout(400);
  expect((await snapshot(page)).farmerModel.pose).toEqual(frozen.farmerModel.pose);
  expect((await snapshot(page)).economy).toEqual(frozen.economy);
  await page.locator('#continue-game').click();
  await page.setViewportSize({width:393,height:852});
  await page.screenshot({path:info.outputPath('hammer-working-phone.png'),scale:'css'});
  await expect.poll(async()=>(await snapshot(page)).economy.upgrades.arms,{timeout:90000}).toBe(1);
  s=await snapshot(page);
  expect(s.economy.tasks.find(t=>t.id===job.task!.id)).toMatchObject({progress:16,status:'done'});
  expect(s.economy.inventory).toMatchObject({wood:24,iron:18});
  expect(s.selection.resident).toBe('farmer');
  await expect(page.locator('#resident-activity')).not.toHaveText('正在锻制装备');
  expect(errors).toEqual([]);
});
