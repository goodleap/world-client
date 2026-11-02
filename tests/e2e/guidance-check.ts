import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { newWolf } from '../../src/game/raid-state.ts';
import { openGame, snapshot, selectUnit, clickGround } from './helpers.ts';

export async function checkGuidance(page: Page, info: TestInfo, touch: boolean) {
  const e = new Economy(); e.setLeadership(false); e.state.seconds = 100;
  for (const v of Object.values(e.state.vitals)) v.manualUntil = 1000;
  e.state.vitals['farmer-2'].hp = 0; e.state.vitals['farmer-2'].diedAt = 90;
  e.state.combat.units.find(u => u.id === 'archer')!.position = { x: 10, z: 10 };
  e.state.combat.units.find(u => u.id === 'cavalry')!.position = { x: 15, z: 10 };
  const soldier = e.state.combat.units.find(u => u.id === 'infantry')!; soldier.cooldown = 8;
  const wolf = newWolf('wolf-1-0', { x: -6, z: -4 }); wolf.home = { x: -45, z: 25 }; wolf.cooldown = 2;
  Object.assign(e.state.raids, { wave: 1, phase: 'raid', origin: wolf.home, startedAt: 100, wolves: [wolf] });
  await page.addInitScript(save => {
    localStorage.setItem('world-shadows-enabled', 'false');
    if (!localStorage.getItem('world-basic-economy-v1')) localStorage.setItem('world-basic-economy-v1', save);
  }, encodeEconomy(e));
  const errors = await openGame(page);
  expect((await snapshot(page)).residents.find(r => r.id === 'farmer-2')!.death.visible).toBe(false);
  await selectUnit(page, 'farmer', touch);
  await clickGround(page, touch ? { x: -1, z: -10 } : { x: -9, z: 1 }, touch);
  await expect.poll(async () => (await snapshot(page)).pathGuidance.visible).toBe(true);
  await expect.poll(async () => {
    const current = await snapshot(page), end = current.pathGuidance.endpoint, destination = current.residents.find(r => r.id === 'farmer')!.destination;
    return !!end && !!destination && Math.hypot(end.x - destination.x, end.z - destination.z) < .01;
  }).toBe(true);
  let s = await snapshot(page);
  expect(s.pathGuidance.selected).toBe('farmer');
  expect(s.pathGuidance.endpoint).toEqual(s.residents.find(r => r.id === 'farmer')!.destination);
  await page.screenshot({ path: info.outputPath('selected-path.png'), scale: 'css' });
  await page.locator('#settings').click(); const paused = await snapshot(page);
  await page.waitForTimeout(400); expect((await snapshot(page)).pathGuidance).toEqual(paused.pathGuidance);
  await page.locator('#continue-game').click();
  await page.locator('#clear-selection').click();
  await expect.poll(async () => (await snapshot(page)).pathGuidance.visible).toBe(false);
  await selectUnit(page, 'infantry', touch);
  s = await snapshot(page);
  const foe = s.economy.raids.wolves[0];
  await clickGround(page, foe.position, touch, .85);
  await expect(page.locator('[data-resident="wolf-1-0"] .resident-attack-target')).toBeVisible();
  const attacking = await snapshot(page);
  expect(attacking.combat.units.find(u => u.id === 'infantry')!.target).toBe('wolf-1-0');
  expect(attacking.attackFeedback).toMatchObject({ visible:true, target:'wolf-1-0' });
  const target = attacking.economy.raids.wolves[0].position;
  expect(Math.hypot(attacking.attackFeedback.x-target.x,attacking.attackFeedback.z-target.z)).toBeLessThan(.01);
  await page.locator('#settings').click(); const frozenAttack=(await snapshot(page)).attackFeedback;
  await page.waitForTimeout(400); expect((await snapshot(page)).attackFeedback).toEqual(frozenAttack);
  await page.locator('#continue-game').click();
  await page.screenshot({ path: info.outputPath('selected-attack.png'), scale: 'css' });
  await page.locator('#clear-selection').click();
  await expect(page.locator('.resident-attack-target')).toHaveCount(0);
  expect((await snapshot(page)).attackFeedback.visible).toBe(false);
  expect(errors).toEqual([]);
}
