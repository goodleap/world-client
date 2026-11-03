import { expect } from '@playwright/test';
import type { Page,TestInfo } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { recruit,advanceRecruitment } from '../../src/game/recruitment.ts';
import { HOME_CENTER } from '../../src/game/world-data.ts';
import { openGame,snapshot,panTo,clickGround } from './helpers.ts';

export async function checkHomeManagement(page:Page,info:TestInfo,touch:boolean){
  info.setTimeout(180000); // Software WebGL plus recruitment/reload and narrow layouts.
  const e=new Economy();e.setLeadership(false);e.state.inventory={wood:40,stone:24,food:60,iron:40};e.state.raids.nextAt=600;
  e.state.upgrades.arms=2;e.state.combat.units.find(u=>u.id==='infantry')!.hp=91;e.state.vitals.infantry.stamina=42;
  e.state.vitals['farmer-2'].hp=0;e.state.vitals['farmer-2'].diedAt=0;
  recruit(e,'cavalry');advanceRecruitment(e,25);recruit(e,'farmer');e.state.recruitment.queue[0].elapsed=9.7;
  await page.addInitScript(save=>{if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);
  await expect.poll(async()=>(await snapshot(page)).residents.some(r=>r.id==='recruit-farmer-2'&&r.model),{timeout:40000}).toBe(true);
  await page.locator('#home-resources').click();await expect(page.getByRole('tab',{name:'资源',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'人口',exact:true}).click();
  const rows=page.locator('#group-candidates tr');
  await expect(rows).toHaveCount(8);
  await expect(page.locator('#population-summary')).toHaveText('人口 7 · 田园犬 1');
  await expect(page.locator('#group-candidates [data-resident="farmer-2"]')).toHaveCount(0);
  await expect(page.locator('#group-candidates [data-resident="recruit-farmer-2"]')).toHaveCount(1);
  const infantry=page.locator('#group-candidates [data-resident="infantry"]'),state=await snapshot(page);
  await expect(infantry.locator('[data-stat="health"]')).toHaveText(`${Math.ceil(state.combat.units.find(u=>u.id==='infantry')!.hp)}/120`);
  await expect(infantry.locator('[data-stat="stamina"]')).toHaveText(`${Math.floor(state.economy.vitals.infantry.stamina)}/100`);
  await expect(infantry.locator('[data-stat="combat"]')).toHaveText('21 / 12');
  await expect(page.locator('#group-candidates [data-resident="dog"] [data-stat="combat"]')).toHaveText('— / 0');
  await page.waitForTimeout(300);expect((await snapshot(page)).economy.seconds).toBe(state.economy.seconds);
  expect((await snapshot(page)).combat).toEqual(state.combat);
  if(touch){
    const original=page.viewportSize()!;
    for(const [width,height]of [[320,568],[844,390]]){
      await page.setViewportSize({width,height});
      expect(await page.locator('.population-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      for(const cell of await infantry.locator('td').all())expect(await cell.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      const bounds=(await page.locator('#resources-dialog').boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(height);
      await expect(page.locator('#save-group')).toBeInViewport();
      await page.screenshot({path:info.outputPath(`population-${width}.png`),scale:'css'});
    }
    await page.setViewportSize(original);
  }
  await page.screenshot({path:info.outputPath('population-panel.png'),scale:'css'});
  await page.getByRole('tab',{name:'资源',exact:true}).click();
  await expect(page.locator('#inventory')).toBeVisible();
  await page.getByRole('tab',{name:'人口',exact:true}).click();
  for(const id of ['infantry','archer','farmer'])await page.locator(`input[value="${id}"]`).check();
  await page.locator('#save-group').click();
  await expect(page.locator('[data-group="0"]')).toHaveAttribute('aria-label','1 队，3 名');
  await page.screenshot({path:info.outputPath('group-editor.png'),scale:'css'});
  await page.getByRole('button',{name:'关闭家园面板'}).click();await page.locator('[data-group="0"]').click();
  expect((await snapshot(page)).selection.members).toHaveLength(3);
  await panTo(page,{x:0,z:-12},touch);
  await clickGround(page,{x:0,z:-17},touch);
  await expect.poll(async()=>(await snapshot(page)).navigation.pending).toBe(0);
  let s=await snapshot(page);
  // Earlier members keep moving while later routes are computed, so a nearby
  // archer may already have arrived by the time the entire queue is finished.
  const goals=['infantry','archer','farmer'].map(id=>{const fighter=s.combat.units.find(u=>u.id===id),resident=s.residents.find(r=>r.id===id)!;
    return fighter?fighter.goal??fighter.position:resident.destination??resident.position;});
  for(const goal of goals)expect(Math.hypot(goal.x,goal.z+17)).toBeLessThan(4);
  expect(new Set(goals.map(p=>JSON.stringify(p))).size).toBe(3);
  await page.screenshot({path:info.outputPath('group-move.png'),scale:'css'});
  await page.locator('#clear-selection').click();await panTo(page,HOME_CENTER,touch);
  await clickGround(page,{x:HOME_CENTER.x-.35,z:HOME_CENTER.z-HOME_CENTER.depth/2-.2},touch,1.4);
  await expect(page.locator('#recruit-dialog')).toBeVisible();
  const paused=(await snapshot(page)).economy.seconds;await page.waitForTimeout(500);expect((await snapshot(page)).economy.seconds).toBe(paused);
  await page.getByRole('button',{name:'招募田园犬'}).click();await page.getByRole('button',{name:'招募步兵'}).click();
  await expect(page.locator('#recruit-queue li')).toHaveCount(2);
  await page.locator('#recruit-queue li').last().getByRole('button',{name:'取消'}).click();
  await page.screenshot({path:info.outputPath('recruit-panel.png'),scale:'css'});
  await page.getByRole('button',{name:'关闭家园中心'}).click();
  await page.screenshot({path:info.outputPath('home-center-game.png'),scale:'css'});
  await expect.poll(async()=>(await snapshot(page)).residents.some(r=>r.id==='recruit-dog-3'&&r.dogLOD),{timeout:70000}).toBe(true);
  s=await snapshot(page);expect(s.economy.recruitment.queue).toHaveLength(0);
  const dog=s.residents.find(r=>r.id==='recruit-dog-3')!;expect(dog.animalBones.length).toBeGreaterThan(5);
  const original=s.residents.find(r=>r.id==='dog')!;expect(dog.dogLOD!.skeleton).not.toBe(original.dogLOD!.skeleton);expect(dog.dogLOD!.geometry).toBe(original.dogLOD!.geometry);expect(dog.dogLOD!.material).toBe(original.dogLOD!.material);
  await expect.poll(async()=>JSON.stringify((await snapshot(page)).residents.find(r=>r.id===dog.id)!.pose),{timeout:15000}).not.toBe(JSON.stringify(dog.pose));
  await page.screenshot({path:info.outputPath('new-dog-cavalry.png'),scale:'css'});
  await page.locator('#settings').click();const before=await snapshot(page);
  await page.getByRole('button',{name:'回到主菜单',exact:true}).click();await page.reload();await page.getByRole('button',{name:'继续游戏',exact:true}).click();
  await expect(page.locator('#loading')).toHaveClass(/loaded/,{timeout:90000});
  s=await snapshot(page);expect(s.economy.recruitment.roster.map(r=>r.id)).toEqual(before.economy.recruitment.roster.map(r=>r.id));expect(s.economy.groups).toEqual(before.economy.groups);
  await page.locator('[data-group="0"]').click();await page.locator('#building-toggle').click();
  if(touch)for(const [width,height]of [[320,568],[412,915],[844,390]]){
    await page.setViewportSize({width,height});
    const card=(await page.locator('#resident-selection').boundingBox())!,build=(await page.locator('#building-toggle').boundingBox())!,reset=(await page.locator('#reset').boundingBox())!;
    expect(Math.abs(card.x+card.width/2-width/2)).toBeLessThan(1);expect(card.x).toBeGreaterThan(build.x+build.width+3);expect(card.x+card.width).toBeLessThan(reset.x-3);
    await page.screenshot({path:info.outputPath(`compact-${width}.png`),scale:'css'});
  }
  expect(errors).toEqual([]);
}
