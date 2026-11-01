import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { RESOURCE_NODES } from '../../src/game/economy-config.ts';
import { openGame, snapshot, panTo, clickGround } from './helpers.ts';

test('region map and resource models render in the playable scene', async ({ page }, info) => {
  test.setTimeout(180_000);
  const state = initialEconomy(); state.steward.enabled = false;
  await page.addInitScript(s => localStorage.setItem('world-basic-economy-v1', JSON.stringify(s)), state);
  const errors = await openGame(page);
  await page.screenshot({ path: info.outputPath('home.png') });
  const bush = RESOURCE_NODES.find(n => n.kind === 'food')!;
  await panTo(page, bush); await clickGround(page, bush, false, .6);
  await expect(page.locator('[data-action="gather"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath('forage.png') });
  await page.mouse.move(640, 450);
  for (let i = 0; i < 10; i++) await page.locator('#game').dispatchEvent('wheel', { deltaY: 240, deltaX: 0, deltaMode: 0 });
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(50);
  await panTo(page, { x: 0, z: 0 });
  await page.screenshot({ path: info.outputPath('map-overview.png') });
  expect(errors).toEqual([]);
});
