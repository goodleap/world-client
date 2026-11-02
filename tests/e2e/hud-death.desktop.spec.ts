import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { Combat } from '../../src/game/combat.ts';
import { openGame, snapshot, selectUnit } from './helpers.ts';

test('corner controls, compact stock/time, permanent death and focus styling survive viewport changes and reload', async ({ page }, info) => {
 test.setTimeout(150000);
 const e = new Economy(); e.setLeadership(false); e.state.seconds = 4354;
 const c = new Combat(e.state.combat, e, () => []); c.hurt('infantry', 9999, 'enemy-guard');
 e.state.goods.push({id:'goods-99',resource:'wood',amount:100,x:0,z:0,state:'ground'}); e.state.nextId=100;
 await page.addInitScript(value => {if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1', value);}, encodeEconomy(e));
 const errors=await openGame(page);
 await expect(page.locator('#population')).toHaveText('人口 5');
 await expect(page.locator('#resource-summary')).toContainText(`木 ${e.state.inventory.wood}`);
 await expect(page.locator('#game-time')).toHaveText(/^01:12:/);
 await expect(page.locator('#building-toggle')).toHaveText('建造');
 await expect(page.locator('[data-resident="infantry"]')).toBeHidden();
 for(const [width,height] of [[1280,900],[393,851],[320,640],[844,390]]) {
  await page.setViewportSize({width,height});
  const boxes=await page.locator('#home-resources,#settings,#building-toggle,#reset').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return {id:el.id,x:b.x,y:b.y,w:b.width,h:b.height};}));
  const get=(id:string)=>boxes.find(b=>b.id===id)!; const a=get('home-resources'),s=get('settings'),b=get('building-toggle'),r=get('reset');
  expect([a.h,b.h,r.h]).toEqual([s.h,s.h,s.h]); expect(a.x).toBe(b.x); expect(s.x).toBe(r.x); expect(a.y).toBe(s.y); expect(b.y).toBe(r.y);
  expect(width-r.x-r.w).toBe(a.x); expect(height-r.y-r.h).toBe(a.y);
  const weather=(await page.locator('.weather').boundingBox())!; expect(weather.x+weather.width).toBeLessThanOrEqual(s.x-4);
  await page.locator('#settings').focus(); expect(await page.locator('#settings').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
  await page.screenshot({path:info.outputPath(`hud-${width}.png`)});
 }
 await page.locator('#settings').click(); const frozen=await snapshot(page), clock=await page.locator('#game-time').textContent();
 await page.waitForTimeout(1100); expect((await snapshot(page)).economy.seconds).toBe(frozen.economy.seconds); await expect(page.locator('#game-time')).toHaveText(clock!);
 await page.locator('#return-menu').click(); await page.reload(); await page.locator('#continue-save').click();
 await expect(page.locator('#loading')).toHaveClass(/loaded/,{timeout:60000});
 expect((await snapshot(page)).combat.units.find(u=>u.id==='infantry')).toMatchObject({life:'defeated',hp:0,route:[]});
 await page.setViewportSize({width:1280,height:900}); await selectUnit(page,'archer');
 expect((await snapshot(page)).selection.resident).toBe('archer'); expect(errors).toEqual([]);
});
