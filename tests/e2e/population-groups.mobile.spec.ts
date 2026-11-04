import {test,expect} from '@playwright/test';
import {Economy,encodeEconomy,decodeEconomy} from '../../src/game/economy.ts';
import {buildingAt} from '../../src/game/construction.ts';
import {newTower} from '../../src/game/towers.ts';
import {openGame,snapshot} from './helpers.ts';

test('population edits persist immediately, keep layout stable and expose assignments in separate columns',async({page},info)=>{
  test.setTimeout(180000);
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=1000;e.state.groups[0]=['infantry'];
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  const site=buildingAt('tower',{x:-16,z:-10},'site-0'),tower=newTower(site);
  e.state.sites.push(site);e.state.buildings.push(site.id);e.state.towers.push(tower);e.state.nextSiteId=1;
  const archer=e.state.combat.units.find(u=>u.id==='archer')!;
  tower.unit=archer.id;tower.phase='occupied';archer.position={x:tower.x,z:tower.z};archer.experience=200;
  await page.addInitScript(save=>{
    if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);
    localStorage.setItem('world-shadows-enabled','false');
  },encodeEconomy(e));
  const errors=await openGame(page);
  await page.locator('#home-resources').click();await page.locator('#population-tab').click();
  const saved=async()=>decodeEconomy((await page.evaluate(()=>localStorage.getItem('world-basic-economy-v1')))!);
  const row=page.locator('[data-resident="archer"]'),notice=page.locator('#group-notice');
  await expect(page.locator('#save-group')).toHaveCount(0);
  await expect(page.locator('.population-table thead th')).toHaveText(['','名称','等级','编队','安排','生命','体力','攻 / 防']);
  await expect(row.locator('th')).toHaveText('弓兵');
  await expect(row.locator('td[data-stat="level"]')).toContainText('2级');
  await expect(row.locator('td[data-stat="assignment"]')).toHaveText('驻守哨塔');
  await expect(notice).toHaveText('已选 1 / 6');
  const before=await snapshot(page),layout=async()=>Promise.all([
    page.locator('.population-scroll').boundingBox(),notice.boundingBox(),page.locator('#continue-home').boundingBox(),
  ]);
  const original=await layout();
  await page.locator('#group-member-farmer').check();
  await expect(notice).toHaveText('已选 2 / 6');expect(await layout()).toEqual(original);
  expect((await saved()).state.groups[0]).toEqual(['infantry','farmer']);
  await page.locator('#population-filters [data-role="archer"]').click();await page.locator('#group-member-archer').check();
  await expect(notice).toHaveText('已选 3 / 6');
  await page.locator('#group-editor-tabs button').nth(1).click();
  await expect(row.locator('[data-stat="group"]')).toHaveText('1队');
  await page.locator('#group-member-archer').check();
  await expect(row.locator('[data-stat="group"]')).toHaveText('2队');
  expect((await saved()).state.groups.slice(0,2)).toEqual([['infantry','farmer'],['archer']]);
  await page.locator('#group-editor-tabs button').first().click();
  await page.locator('#population-filters [data-role="all"]').click();
  for(const id of ['farmer-2','farmer-leader','archer','cavalry'])await page.locator(`#group-member-${id}`).check();
  const full=await layout();
  await page.locator('#group-member-dog').click();await expect(page.locator('#group-member-dog')).not.toBeChecked();
  await expect(notice).toHaveText('已选 6 / 6 · 已达人数上限');expect(await layout()).toEqual(full);
  expect((await saved()).state.groups[0]).toHaveLength(6);
  await page.locator('#group-member-cavalry').uncheck();await page.locator('#group-member-dog').check();
  await expect(notice).toHaveText('已选 6 / 6');
  await page.locator('#clear-group').click();await expect(notice).toHaveText('已选 0 / 6');
  expect((await saved()).state.groups[0]).toEqual([]);
  await page.locator('#group-editor-tabs button').nth(1).click();await page.locator('#group-member-archer').check();
  const after=await snapshot(page);
  expect(after.economy.seconds).toBe(before.economy.seconds);expect(after.combat).toEqual(before.combat);expect(after.economy.towers).toEqual(before.economy.towers);
  for(const [width,height] of [[320,568],[412,915],[844,390],[1280,900]]){
    await page.setViewportSize({width,height});await expect(page.locator('#continue-home')).toBeInViewport();
    expect(await page.locator('#population-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    const scroll=page.locator('.population-scroll');await row.locator('input').scrollIntoViewIfNeeded();await scroll.evaluate(el=>el.scrollLeft=0);
    const name=await row.locator('th').boundingBox();await scroll.evaluate(el=>el.scrollLeft=el.scrollWidth);
    expect((await row.locator('th').boundingBox())!.x).toBeCloseTo(name!.x,1);
    await expect(page.locator('#group-member-archer')).toBeInViewport();
    await scroll.evaluate(el=>el.scrollLeft=0);
    await page.screenshot({path:info.outputPath(`population-${width}.png`)});
  }
  await page.setViewportSize({width:412,height:915});await openGame(page);
  await page.locator('#home-resources').click();await page.locator('#population-tab').click();
  await page.locator('#group-editor-tabs button').nth(1).click();await expect(page.locator('#group-member-archer')).toBeChecked();
  await expect(row.locator('[data-stat="group"]')).toHaveText('2队');await expect(row.locator('[data-stat="assignment"]')).toHaveText('驻守哨塔');
  expect((await snapshot(page)).economy.groups.slice(0,2)).toEqual([[],['archer']]);expect(errors).toEqual([]);
});
