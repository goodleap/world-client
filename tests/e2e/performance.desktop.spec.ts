import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('frame metrics render at the upper right and restart after backgrounding', async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors = await openGame(page);
  await expect(page.locator('#fps-value')).toHaveText(/\d+\.\d/);
  await expect(page.locator('#cpu-value')).toHaveText(/\d+\.\d{2}/);
  const metrics = (await snapshot(page)).performance;
  expect(metrics.fps).toBeGreaterThan(0);
  expect(metrics.cpuMs).toBeGreaterThanOrEqual(0);
  expect(metrics.lastFrameCpuMs).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: info.outputPath('desktop.png') });
  await page.setViewportSize({ width: 393, height: 851 });
  const panel = await page.locator('#performance').boundingBox();
  expect(panel!.x).toBeGreaterThan(393 / 2);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(393);
  expect(panel!.y + panel!.height).toBeLessThan(120);
  await page.screenshot({ path: info.outputPath('phone.png') });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const frozen = await snapshot(page);
  await page.waitForTimeout(600);
  expect((await snapshot(page)).performance).toEqual(frozen.performance);
  const first = await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    return window.__DEMO__!.snapshot().performance;
  });
  expect(first.fps).toBeUndefined();
  expect(first.cpuMs).toBeUndefined();
  await expect.poll(async () => (await snapshot(page)).performance.fps).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
