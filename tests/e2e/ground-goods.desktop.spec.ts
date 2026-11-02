import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import type { Goods } from '../../src/game/economy.ts';
import { openGame, snapshot } from './helpers.ts';

test('natural ground goods render, remain separate from stock, reload and haul through their real pick meshes', async({page}, info) => {
  test.setTimeout(180000);
  const e=new Economy(); e.setLeadership(false);
  const kinds: Pick<Goods,'resource'|'crop'>[]=[{resource:'food',crop:'carrot'},{resource:'food',crop:'wheat'},{resource:'wood'},{resource:'stone'},{resource:'iron'},{resource:'food'}];
  e.state.goods=kinds.map((kind,i)=>({...kind,id:`goods-${i+1}`,amount:i===0?8:i===1?12:4,state:'ground',x:-3+(i%3)*3,z:-6-Math.floor(i/3)*2}));
  e.state.nextId=7;
  for(const [i,u] of e.state.combat.units.filter(u=>u.team==='home').entries()) u.position={x:i===1?7:-7,z:i*1.8};
  await page.addInitScript(save=>{
    localStorage.setItem('world-shadows-enabled','false');
    if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);
  },encodeEconomy(e));
  const errors=await openGame(page);
  expect((await snapshot(page)).economy.goods).toEqual(e.state.goods);
  expect((await snapshot(page)).objects.filter(o=>o.kind==='goods').map(o=>o.name)).toEqual(['待入库胡萝卜','待入库小麦','待入库木材','待入库石材','待入库铁矿','待入库粮食']);
  for(const [width,height] of [[1280,900],[393,852]]) {
    await page.setViewportSize({width,height});
    await page.screenshot({path:info.outputPath(`ground-goods-${width}.png`),scale:'css'});
  }
  await page.locator('#settings').click();await page.locator('#return-menu').click();await page.reload();await page.locator('#continue-save').click();
  await expect(page.locator('#loading')).toHaveClass(/loaded/,{timeout:60000});
  expect((await snapshot(page)).economy.goods).toEqual(e.state.goods);
  expect((await snapshot(page)).economy.inventory).toEqual(e.state.inventory);
  const frame=(await snapshot(page)).frames;
  await page.setViewportSize({width:1280,height:900});
  await expect.poll(async()=> (await snapshot(page)).frames).toBeGreaterThan(frame);
  const wood=e.state.goods[2], anchor=(await snapshot(page)).objects.find(o=>o.id===wood.id)!.screen;
  await page.mouse.click(anchor.x,anchor.y);
  expect((await snapshot(page)).selection.object?.id).toBe(wood.id);
  await page.locator('[data-action=haul]').click();
  await expect.poll(async()=> (await snapshot(page)).economy.goods.find(g=>g.id===wood.id)?.state,{timeout:45000}).toBe('transit');
  expect((await snapshot(page)).objects.some(o=>o.id===wood.id)).toBe(false);
  await expect.poll(async()=> (await snapshot(page)).economy.inventory.wood,{timeout:60000}).toBe(e.state.inventory.wood+wood.amount);
  expect((await snapshot(page)).economy.goods.filter(g=>g.crop).map(g=>[g.crop,g.amount])).toEqual([['carrot',8],['wheat',12]]);
  expect(errors).toEqual([]);
});
