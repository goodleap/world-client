import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { RESOURCE_NODES } from '../../src/game/economy-config.ts';
import { openGame, snapshot, panTo, clickGround } from './helpers.ts';

test('mobile forage actions remain compact and resources prevent overlapping construction', async ({ page }, info) => {
  test.setTimeout(120_000);
  const state = initialEconomy(); state.steward.enabled = false;
  await page.addInitScript(s => localStorage.setItem('world-basic-economy-v1', JSON.stringify(s)), state);
  const errors = await openGame(page), bush = RESOURCE_NODES.find(n => n.id === 'forage-0')!;
  await panTo(page, bush, true); await clickGround(page, bush, true, .6);
  const button = page.locator('[data-action="gather"]'); await expect(button).toBeVisible();
  const box = (await button.boundingBox())!, viewport = page.viewportSize()!;
  expect(box.height).toBeGreaterThanOrEqual(44); expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: info.outputPath('forage-mobile.png') });
  await page.locator('#building-toggle').tap(); await page.locator('#build-farm').tap();
  await clickGround(page, bush, true);
  expect((await snapshot(page)).placement.reason).toMatch(/资源/);
  expect((await snapshot(page)).economy.plots).toHaveLength(12);
  await page.screenshot({ path: info.outputPath('forest-no-build-mobile.png') });
  await page.locator('#cancel-building').tap();
  expect(errors).toEqual([]);
});
