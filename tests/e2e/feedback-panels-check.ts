import {expect} from '@playwright/test';
import type {Page,TestInfo} from '@playwright/test';
import {Economy,encodeEconomy} from '../../src/game/economy.ts';
import {HOME_CENTER} from '../../src/game/world-data.ts';
import {openGame,snapshot,clickGround,panTo} from './helpers.ts';
export async function checkFeedbackPanels(page:Page,info:TestInfo,touch:boolean){
  info.setTimeout(240000);
  const e=new Economy();e.setLeadership(false);e.state.inventory={wood:160,stone:160,food:160,iron:40};e.state.raids.nextAt=1000;
  const result=e.placeBuilding('tower',{x:-10,z:-10});expect(result.ok).toBe(true);e.claim();e.arrive(result.task!.id);e.advance(8);
  e.state.groups[0]=['infantry','archer','farmer','farmer-2','farmer-leader'];for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  await page.addInitScript(save=>{localStorage.setItem('world-basic-economy-v1',save);localStorage.setItem('world-shadows-enabled','false');},encodeEconomy(e));
  const errors=await openGame(page);await page.locator('#home-resources').click();
  const original=page.viewportSize()!,sizes=touch?[[320,568],[844,390]]:[[1280,900]];
  for(const [width,height]of sizes){await page.setViewportSize({width,height});const before=(await page.locator('#resources-dialog').boundingBox())!;
    for(const name of ['人口','建筑','资源']){await page.getByRole('tab',{name,exact:true}).click();const box=(await page.locator('#resources-dialog').boundingBox())!;expect(Math.abs(box.height-before.height)).toBeLessThan(1);expect(Math.abs(box.y-before.y)).toBeLessThan(1);}
    await page.getByRole('tab',{name:'建筑',exact:true}).click();await expect(page.getByRole('button',{name:'关闭家园面板'})).toBeInViewport();await page.screenshot({path:info.outputPath(`home-${width}.png`),scale:'css'});
  }
  await page.setViewportSize(original);await page.getByRole('button',{name:'关闭家园面板'}).click();
  await panTo(page,HOME_CENTER,touch);await clickGround(page,{x:HOME_CENTER.x-.35,z:HOME_CENTER.z-HOME_CENTER.depth/2-.2},touch,1.4);
  await expect(page.locator('#recruit-dialog')).not.toBeVisible();await expect(page.locator('#selection-actions').getByRole('button',{name:'招募',exact:true})).toBeVisible();
  await page.locator('#selection-actions').getByRole('button',{name:'招募',exact:true}).click();
  for(const [width,height]of sizes){await page.setViewportSize({width,height});const before=(await page.locator('#recruit-dialog').boundingBox())!;
    const button=page.getByRole('button',{name:/招募农民/}),buttonBefore=(await button.boundingBox())!;
    if((await page.locator('#recruit-queue li').count())===0)for(let i=0;i<5;i++)await button.click();
    const after=(await page.locator('#recruit-dialog').boundingBox())!,buttonAfter=(await button.boundingBox())!;
    expect(after.height).toBe(before.height);expect(after.y).toBe(before.y);expect(buttonAfter.y).toBe(buttonBefore.y);
    await expect(page.getByRole('button',{name:'关闭家园中心'})).toBeInViewport();await expect(page.locator('#set-rally')).toBeInViewport();
    await page.screenshot({path:info.outputPath(`recruit-${width}.png`),scale:'css'});
  }
  await page.setViewportSize(original);await page.getByRole('button',{name:'关闭家园中心'}).click();
  await page.locator('[data-group="0"]').click();const goal={x:46,z:57};await panTo(page,goal,touch);await clickGround(page,goal,touch);
  await expect.poll(async()=>(await snapshot(page)).navigation.pending,{timeout:45000}).toBe(0);
  const moving=await snapshot(page);expect(moving.pathGuidance.visible).toBe(true);
  expect(Math.hypot(moving.pathGuidance.endpoint!.x-goal.x,moving.pathGuidance.endpoint!.z-goal.z)).toBeLessThan(.08);
  expect(Math.hypot(moving.economy.groupMoves['0'].center.x-goal.x,moving.economy.groupMoves['0'].center.z-goal.z)).toBeLessThan(.08);
  expect(moving.combat.units.filter(u=>u.team==='enemy')).toHaveLength(100);
  await page.screenshot({path:info.outputPath('group-center.png'),scale:'css'});
  await page.locator('#clear-selection').click();await panTo(page,e.state.sites[0],touch);await page.screenshot({path:info.outputPath('tower-game.png'),scale:'css'});
  await page.locator('#building-toggle').click();await page.locator('[data-building="tower"]').click();
  const viewport=page.viewportSize()!;await page.mouse.move(viewport.width*.55,viewport.height*.6);await page.screenshot({path:info.outputPath('tower-placement.png'),scale:'css'});
  expect(errors).toEqual([]);
}
