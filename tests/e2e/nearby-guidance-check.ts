import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { Economy, encodeEconomy, decodeEconomy } from '../../src/game/economy.ts';
import { economyObstacles } from '../../src/game/economy-config.ts';
import { isBlocked } from '../../src/game/movement.ts';
import { openGame, snapshot, panTo, selectUnit, clickGround } from './helpers.ts';

export async function checkNearbyGuidance(page: Page, info: TestInfo, touch: boolean) {
  const e=new Economy(); e.setLeadership(false);
  for(const u of e.state.combat.units) u.position={x:60,z:-70};
  const soldier=e.state.combat.units.find(u=>u.id==='infantry')!;
  soldier.position={x:25,z:67};
  for(const v of Object.values(e.state.vitals))v.manualUntil=1000;
  const save=encodeEconomy(e);decodeEconomy(save);
  await page.addInitScript(save=>{
    localStorage.setItem('world-shadows-enabled','false');
    if(!localStorage.getItem('world-basic-economy-v1'))localStorage.setItem('world-basic-economy-v1',save);
  },save);
  const errors=await openGame(page), click={x:25,z:49};
  await panTo(page,{x:25,z:58},touch);await selectUnit(page,'infantry',touch);
  await clickGround(page,click,touch);
  await expect.poll(async()=>(await snapshot(page)).pathGuidance.visible).toBe(true);
  const first=await snapshot(page), goal=first.combat.units.find(u=>u.id==='infantry')!.goal!;
  expect(Math.hypot(goal.x-click.x,goal.z-click.z)).toBeGreaterThan(.5);
  expect(Math.hypot(goal.x-click.x,goal.z-click.z)).toBeLessThanOrEqual(3);
  expect(isBlocked(goal,.4,economyObstacles([]))).toBe(false);
  expect(first.pathGuidance.endpoint).toEqual(goal);
  expect(first.moveFeedback).toMatchObject({visible:true,x:goal.x,z:goal.z});
  // Observe inside render frames; screenshot/readback latency must not turn a
  // passing movement check into an assertion against an already-arrived unit.
  const moving=await page.evaluate(initial=>new Promise<ReturnType<NonNullable<Window['__DEMO__']>['snapshot']>>(resolve=>{
    const sample=()=>{
      const state=window.__DEMO__!.snapshot();
      if(!state.pathGuidance.visible || state.pathGuidance.arrows.some((arrow,i)=>arrow.alpha<initial.arrows[i]?.alpha-.2))resolve(state);
      else requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  }),first.pathGuidance);
  expect(moving.pathGuidance.revision).toBe(first.pathGuidance.revision);
  expect(moving.pathGuidance.arrows.map(({x,z})=>({x,z}))).toEqual(first.pathGuidance.arrows.map(({x,z})=>({x,z})));
  expect(moving.pathGuidance.arrows.at(-1)!.alpha).toBe(first.pathGuidance.arrows.at(-1)!.alpha);
  await page.screenshot({path:info.outputPath('stationary-arrows-moving.png'),scale:'css'});
  // A click deep in the lake has no reachable point in the bounded search.
  await clickGround(page,{x:29,z:49},touch);
  await expect(page.locator('#target-hint')).toContainText('无法到达该位置');
  const afterFailure=(await snapshot(page)).combat.units.find(u=>u.id==='infantry')!;
  if(afterFailure.goal)expect(afterFailure.goal).toEqual(goal);
  else expect(Math.hypot(afterFailure.position.x-goal.x,afterFailure.position.z-goal.z)).toBeLessThan(.2);
  await page.locator('#settings').click();const held=await snapshot(page);
  await page.waitForTimeout(400);expect((await snapshot(page)).pathGuidance).toEqual(held.pathGuidance);
  await page.locator('#return-menu').click();await page.reload();await page.locator('#continue-save').click();
  await expect(page.locator('#loading')).toHaveClass(/loaded/,{timeout:60000});
  const resumed=(await snapshot(page)).combat.units.find(u=>u.id==='infantry')!;
  if(resumed.goal)expect(resumed.goal).toEqual(goal);
  else expect(Math.hypot(resumed.position.x-goal.x,resumed.position.z-goal.z)).toBeLessThan(.2);
  expect(errors).toEqual([]);
}
