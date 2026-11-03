import { expect } from '@playwright/test';
import type { Page,TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { Economy,encodeEconomy } from '../../src/game/economy.ts';
import { WAREHOUSE_DOOR } from '../../src/game/world-data.ts';
import { openGame,snapshot,clickGround,panTo } from './helpers.ts';

export async function checkBuildingsNavigation(page:Page,info:TestInfo,touch:boolean){
  info.setTimeout(240000);
  const e=new Economy();e.setLeadership(false);e.state.raids.nextAt=600;e.state.inventory={wood:80,stone:60,food:80,iron:20};
  e.damageBuilding('warehouse',250);e.damageBuilding('cottage',60);e.damageBuilding('home-center',150);
  e.state.residents.farmer={position:{...WAREHOUSE_DOOR}};
  e.state.groups[0]=['infantry','archer','farmer','farmer-2','farmer-leader'];
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  await page.addInitScript(save=>{if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);
  await page.locator('#home-resources').click();await page.getByRole('tab',{name:'建筑',exact:true}).click();
  const row=page.locator('[data-building="warehouse"]');await expect(row.locator('[data-stat="health"]')).toHaveText('750/1000');await expect(row.locator('[data-stat="armor"]')).toHaveText('12');
  if(touch){const original=page.viewportSize()!;for(const [width,height] of [[320,568],[844,390]]){await page.setViewportSize({width,height});
    expect(await page.locator('.building-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(row.getByRole('button')).toBeInViewport();await page.screenshot({path:info.outputPath(`buildings-${width}.png`),scale:'css'});
  }await page.setViewportSize(original);}
  await page.screenshot({path:info.outputPath('buildings.png'),scale:'css'});
  await row.getByRole('button',{name:'维修仓库',exact:true}).click();await expect(row.getByRole('button',{name:'取消维修仓库'})).toBeEnabled();
  const queued=await snapshot(page);expect(queued.economy.inventory.wood).toBe(80);expect(queued.economy.tasks.find(t=>t.kind==='repair')!.repair!.hp).toBe(250);
  await page.getByRole('button',{name:'关闭家园面板'}).click();
  await page.waitForFunction(()=>{const s=window.__DEMO__!.snapshot();if(!s.economy.tasks.some(t=>t.kind==='repair'&&t.status==='working'&&t.progress>1))return false;document.getElementById('settings')!.click();return true;},undefined,{timeout:60000});
  const held=await snapshot(page);expect(held.farmerWork?.status).toBe('working');expect(held.economy.buildingHealth.warehouse).toBe(750);
  await page.waitForTimeout(250);expect((await snapshot(page)).economy.tasks.find(t=>t.kind==='repair')!.progress).toBe(held.economy.tasks.find(t=>t.kind==='repair')!.progress);
  await page.screenshot({path:info.outputPath('repair-paused.png'),scale:'css'});
  await page.reload();await expect(page.locator('#loading')).toHaveAttribute('data-phase','menu');await page.locator('#continue-save').click();await expect(page.locator('#loading')).toHaveClass(/loaded/,{timeout:60000});
  await page.waitForFunction(()=>{const s=window.__DEMO__!.snapshot();if(s.economy.buildingHealth.warehouse!==undefined)return false;document.getElementById('settings')!.click();return true;},undefined,{timeout:90000});
  const fixed=await snapshot(page);expect(fixed.economy.inventory.wood).toBe(77);expect(fixed.economy.inventory.stone).toBe(58);
  expect(fixed.economy.buildingHealth.cottage).toBe(540);expect(fixed.economy.tasks.filter(t=>t.kind==='repair'&&t.status==='done')).toHaveLength(1);
  await page.getByRole('button',{name:'继续游戏',exact:true}).click();await page.locator('[data-group="0"]').click();
  // Keep the whole formation clear of the cliff: constrained terrain is
  // separately covered by nearby-guidance's nearest-reachable fallback check.
  const goal={x:46,z:57};await panTo(page,goal,touch);
  await page.evaluate(()=>{
    const canvas=document.querySelector('canvas')!;
    canvas.addEventListener('click',()=>{
      const started=performance.now(),s=window.__DEMO__!.snapshot();
      const data={initial:s.moveFeedback,pending:s.navigation.pending,frames:0,firstRouteMs:0,completedMs:0};
      (window as unknown as {navCheck:typeof data}).navCheck=data;
      const sample=()=>{const v=window.__DEMO__!.snapshot();data.frames++;
        if(v.pathGuidance.visible&&!data.firstRouteMs)data.firstRouteMs=performance.now()-started;
        if(!v.navigation.pending){data.completedMs=performance.now()-started;return;}requestAnimationFrame(sample);};requestAnimationFrame(sample);
    },{once:true});
  });
  await clickGround(page,goal,touch);
  await expect.poll(async()=>(await snapshot(page)).navigation.pending,{timeout:30000}).toBe(0);
  const moved=await snapshot(page),timing=await page.evaluate(()=>(window as unknown as {navCheck:{initial:{visible:boolean;x:number;z:number};pending:number;frames:number;firstRouteMs:number;completedMs:number}}).navCheck);
  expect(timing.pending).toBeGreaterThan(0);expect(timing.initial.visible).toBe(true);expect(Math.hypot(timing.initial.x-goal.x,timing.initial.z-goal.z)).toBeLessThan(.08);
  expect(timing.frames).toBeGreaterThanOrEqual(5);expect(timing.firstRouteMs).toBeGreaterThan(0);expect(moved.pathGuidance.visible).toBe(true);expect(Math.hypot(moved.pathGuidance.endpoint!.x-goal.x,moved.pathGuidance.endpoint!.z-goal.z)).toBeLessThan(.08);
  const goals=moved.selection.members.map(id=>moved.combat.units.find(u=>u.id===id)?.goal??moved.residents.find(r=>r.id===id)!.destination!);
  await info.attach('navigation-timing',{body:JSON.stringify({timing,navigation:moved.navigation}),contentType:'application/json'});
  await writeFile(info.outputPath('navigation-timing.json'),JSON.stringify({timing,navigation:moved.navigation},null,2));
  expect(goals.every(Boolean)).toBe(true);expect(Math.hypot(goals.reduce((s,p)=>s+p.x,0)/5-goal.x,goals.reduce((s,p)=>s+p.z,0)/5-goal.z)).toBeLessThan(.1);
  await page.screenshot({path:info.outputPath('group-destination.png'),scale:'css'});
  expect(moved.residents.filter(r=>/enemy-(orchard|hollow|lowland|east)-/.test(r.id))).toHaveLength(36);expect(errors).toEqual([]);
}
