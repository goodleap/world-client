import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { Combat } from '../../src/game/combat.ts';
import { newWolf } from '../../src/game/raid-state.ts';
import { openGame, snapshot } from './helpers.ts';

test('dead soldiers, enemy and wolf hold, pause, resume saved sinking and disappear without repeat loot', async ({ page }, info) => {
 test.setTimeout(180000);
 const e=new Economy();e.setLeadership(false);e.state.seconds=100;
 const c=new Combat(e.state.combat,e,()=>[]);
 for(const [i,id] of ['infantry','archer','cavalry','enemy-guard'].entries()) {
  const u=c.unit(id)!;u.position={x:-3+i*2.5,z:-3};c.hurt(id,10000,'enemy-sentry');
 }
 const wolf=newWolf('wolf-1-0',{x:0,z:-6});wolf.hp=0;wolf.life='defeated';wolf.diedAt=100;
 Object.assign(e.state.raids,{wave:1,phase:'raid',origin:{x:0,z:-6},startedAt:100,wolves:[wolf]});
 await page.addInitScript(value=>{localStorage.setItem('world-shadows-enabled','false');if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',value);},encodeEconomy(e));
 const errors=await openGame(page);
 await expect.poll(async()=>(await snapshot(page)).residents.find(r=>r.id==='cavalry')!.death.phase).toBe('hold');
 await page.locator('#settings').click(); const held=await snapshot(page);
 await page.waitForTimeout(800);expect((await snapshot(page)).residents.map(r=>r.death)).toEqual(held.residents.map(r=>r.death));
 expect(held.combat.units.find(u=>u.id==='cavalry')).toMatchObject({hp:0,life:'defeated',route:[]});
 const food=held.economy.goods.filter(g=>g.resource==='food').reduce((n,g)=>n+g.amount,0);expect(food).toBe(2);
 await page.locator('#continue-game').click();
 await page.screenshot({path:info.outputPath('dead-units-hold.png')});
 await expect.poll(async()=>(await snapshot(page)).residents.find(r=>r.id==='cavalry')!.death.phase).toBe('sink');
 await page.locator('#settings').click();const sinking=await snapshot(page);
 const corpse=sinking.residents.find(r=>r.id==='cavalry')!;
 expect(corpse.death.y).toBeLessThan(held.residents.find(r=>r.id==='cavalry')!.death.y);
 await page.locator('#return-menu').click();await page.reload();await page.locator('#continue-save').click();
 await expect(page.locator('#loading')).toHaveClass(/loaded/,{timeout:60000});await page.locator('#settings').click();
 let s=await snapshot(page);expect(s.residents.find(r=>r.id==='cavalry')!.death.age).toBeGreaterThanOrEqual(corpse.death.age);
 expect(s.economy.goods.filter(g=>g.resource==='food').reduce((n,g)=>n+g.amount,0)).toBe(food);
 await page.locator('#continue-game').click();
 await expect.poll(async()=>(await snapshot(page)).residents.find(r=>r.id==='cavalry')!.death.phase).toBe('gone');
 s=await snapshot(page);expect(s.residents.filter(r=>['infantry','archer','cavalry','enemy-guard'].includes(r.id)).every(r=>!r.death.visible)).toBe(true);
 expect(s.economy.raids.wolves[0]).toMatchObject({life:'defeated',hp:0,settled:true});
 await page.screenshot({path:info.outputPath('dead-units-gone.png')});expect(errors).toEqual([]);
});
