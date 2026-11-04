import { test, expect } from '@playwright/test';
import { initialEconomy, Economy, encodeEconomy } from '../../src/game/economy.ts';
import { RESOURCE_NODES } from '../../src/game/economy-config.ts';
import { LANDSCAPE } from '../../src/game/world-data.ts';
import { buildingAt } from '../../src/game/construction.ts';
import { openGame, snapshot, panTo, clickGround, selectUnit } from './helpers.ts';

test('region map and resource models render in the playable scene', async ({ page }, info) => {
  test.setTimeout(180_000);
  const state = initialEconomy(); state.steward.enabled = false;
  await page.addInitScript(s => localStorage.setItem('world-basic-economy-v1', JSON.stringify(s)), state);
  const errors = await openGame(page);
  await page.screenshot({ path: info.outputPath('home.png') });
  const bush = RESOURCE_NODES.find(n => n.kind === 'food')!;
  await panTo(page, bush); await clickGround(page, bush, false, .6);
  await expect(page.locator('[data-action="gather"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath('forage.png') });
  await page.mouse.move(640, 450);
  for (let i = 0; i < 10; i++) await page.locator('#game').dispatchEvent('wheel', { deltaY: 240, deltaX: 0, deltaMode: 0 });
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(50);
  await panTo(page, { x: 0, z: 0 });
  await page.screenshot({ path: info.outputPath('map-overview.png') });
  expect(errors).toEqual([]);
});

test('highland pointer commands, farm placement and current-map saves use elevated ground', async ({ page }, info) => {
  test.setTimeout(240_000);
  const e=new Economy();e.setLeadership(false);e.state.seconds=10;e.state.raids.nextAt=1000;
  for(const u of e.state.combat.units)if(u.team==='enemy'){u.life='defeated';u.hp=0;u.diedAt=0;}
  for(const c of e.state.combat.camps)c.cleared=c.rewardGranted=c.discovered=true;
  e.state.combat.cleared=e.state.combat.rewardGranted=e.state.combat.discovered=true;
  for(const w of e.state.raids.wildWolves){w.life='defeated';w.hp=0;w.diedAt=0;w.settled=true;}
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  const plateau=LANDSCAPE.regions.find(r=>r.id==='highland')!;
  e.state.residents.farmer={position:{x:plateau.x,z:plateau.z}};
  await page.addInitScript(save=>{
    if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);
    localStorage.setItem('world-shadows-enabled','false');
  },encodeEconomy(e));
  const errors=await openGame(page);
  await panTo(page,plateau);await selectUnit(page,'farmer');
  const goal={x:plateau.x+2.5,z:plateau.z};await clickGround(page,goal);
  await expect.poll(async()=>{const p=(await snapshot(page)).residents.find(r=>r.id==='farmer')!.position;return Math.hypot(p.x-goal.x,p.z-goal.z);},{timeout:60_000}).toBeLessThan(.15);
  const field=buildingAt('farm',{x:plateau.x-3,z:plateau.z});
  await page.locator('#building-toggle').click();await page.locator('#build-farm').click();await clickGround(page,field);
  await expect.poll(async()=>(await snapshot(page)).economy.plots.some(p=>p.x===field.x&&p.z===field.z)).toBe(true);
  await page.screenshot({path:info.outputPath('highland-move-and-farm.png')});
  await page.locator('#settings').click();const frozen=(await snapshot(page)).economy;
  await page.waitForTimeout(250);expect((await snapshot(page)).economy).toEqual(frozen);
  await page.locator('#return-menu').click();await openGame(page);
  expect((await snapshot(page)).economy.plots.some(p=>p.x===field.x&&p.z===field.z)).toBe(true);
  expect(errors).toEqual([]);
});
