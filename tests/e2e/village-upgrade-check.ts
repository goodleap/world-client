import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { openGame, snapshot, panTo, selectUnit } from './helpers.ts';

export async function checkVillageUpgrade(page: Page, info: TestInfo, touch: boolean) {
  info.setTimeout(180000);
  const e=new Economy();e.setLeadership(false);e.setAutoRepair(false);e.state.raids.nextAt=1000;
  e.state.inventory={wood:80,stone:80,food:80,iron:20};
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  const infantry=e.state.combat.units.find(u=>u.id==='infantry')!;
  infantry.experience=250;infantry.hp=100;e.state.upgrades.arms=2;
  e.damageBuilding('cottage',60);
  await page.addInitScript(save=>{
    if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);
    localStorage.setItem('world-shadows-enabled','false');
  },encodeEconomy(e));
  const errors=await openGame(page);
  const mounted=(await snapshot(page)).residents.filter(r=>r.id.startsWith('enemy-')&&r.role==='cavalry');
  expect(mounted.length).toBeGreaterThan(0);
  for(const r of mounted){expect(r.model).toBeTruthy();expect(r.legacyVisible).toBe(false);expect(r.bodyRadius).toBe(.6);}
  for(const id of ['farmer','infantry','archer','cavalry','dog']){
    const actor=(await snapshot(page)).residents.find(r=>r.id===id)!;
    await panTo(page,actor.position,touch);await selectUnit(page,id,touch);
    await page.locator('#clear-selection').click();
  }
  await panTo(page,{x:5,z:-6},touch);
  await page.screenshot({path:info.outputPath('four-bed-farms.png'),scale:'css'});
  await page.locator('#home-resources').click();await page.getByRole('tab',{name:'人口',exact:true}).click();
  const soldier=page.locator('#group-candidates [data-resident="infantry"]');
  await expect(soldier.locator('[data-stat="level"]')).toHaveText('2级 · 50/400');
  await expect(soldier.locator('[data-stat="health"]')).toHaveText('100/132');
  await expect(soldier.locator('[data-stat="combat"]')).toHaveText('22.5 / 13');
  await expect(page.locator('#group-candidates [data-resident="farmer"] [data-stat="level"]')).toHaveCount(0);
  const original=page.viewportSize()!;
  for(const size of touch?[{width:320,height:568},{width:844,height:390}]:[original]){
    await page.setViewportSize(size);
    expect(await page.locator('.population-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    for(const cell of await soldier.locator('td,th').all())expect(await cell.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`levels-${size.width}.png`),scale:'css'});
    await page.getByRole('tab',{name:'建筑',exact:true}).click();
    await expect(page.locator('#auto-repair')).toBeInViewport();
    expect(await page.locator('.building-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`buildings-${size.width}.png`),scale:'css'});
    await page.getByRole('tab',{name:'人口',exact:true}).click();
  }
  await page.setViewportSize(original);await page.getByRole('tab',{name:'建筑',exact:true}).click();
  await expect(page.locator('[data-building="warehouse"] button').filter({hasText:'维修'})).toHaveCount(0);
  await expect(page.locator('[data-building="plot-0"] button').filter({hasText:'维修'})).toHaveCount(0);
  const damaged=page.locator('[data-building="cottage"]');await expect(damaged.getByRole('button',{name:/^维修/})).toBeEnabled();
  await page.locator('#auto-repair').check();
  await expect(damaged.getByRole('button',{name:/取消维修/})).toBeVisible();
  expect((await snapshot(page)).economy.tasks.filter(t=>t.kind==='repair'&&t.target==='cottage')).toHaveLength(1);
  await page.locator('#auto-repair').uncheck();
  expect((await snapshot(page)).economy.autoRepair).toBe(false);
  await damaged.getByRole('button',{name:/取消维修/}).click();
  await page.locator('#auto-repair').check();
  await page.reload();await page.getByRole('button',{name:'继续游戏',exact:true}).click();
  await expect(page.locator('#loading')).toHaveClass(/loaded/,{timeout:90000});
  const saved=await snapshot(page);
  expect(saved.economy.autoRepair).toBe(true);
  expect(saved.combat.units.find(u=>u.id==='infantry')!.experience).toBe(250);
  expect(saved.economy.tasks.filter(t=>t.kind==='repair'&&t.target==='cottage'&&t.status!=='cancelled')).toHaveLength(1);
  expect(errors).toEqual([]);
}
