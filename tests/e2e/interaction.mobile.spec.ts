import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('settings copy only ten seconds of performance and preserve useful data while paused', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
      (window as unknown as { copied: string }).copied = text;
    } } });
  });
  const errors = await openGame(page);
  await expect(page.locator('#game-page h1')).toHaveCSS('user-select', 'none');
  await page.waitForFunction(() => {
    const history = window.__DEMO__!.snapshot().diagnostics.history;
    return history.length && history.at(-1)!.timeMs - history[0].timeMs > 12_000;
  });
  await page.getByRole('button', { name: '设置', exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
  const original = await snapshot(page);
  await page.getByRole('button', { name: '记录当前视距', exact: true }).tap();
  await expect(page.locator('#settings-notice')).toContainText('已记录近景');
  await page.getByRole('button', { name: '复制性能日志', exact: true }).tap();
  await expect(page.locator('#settings-notice')).toContainText('已复制');
  const data = await page.evaluate(() => JSON.parse((window as unknown as { copied: string }).copied));
  expect(data.viewport.width).toBeGreaterThan(0);
  expect(data.performance.latest.drawCalls).toBeGreaterThan(0);
  expect(data.performance.marks[0].label).toBe('近景');
  expect(data.performance.marks[0].sample.renderLoops).toBe(1);
  expect(data.performance.latest.lod).toHaveLength(6);
  expect(data.performance.latest.shadowLodCamera).toBe('map-shadow-lod');
  expect(data.performance.renderer).toEqual(expect.any(String));
  expect(data.shadows.lodCamera).toBe('map-shadow-lod');
  expect(data.shadows.casterCount).toBeGreaterThan(0);
  expect(data.shadows.casters).toBeUndefined();
  expect(data.loading).toBeUndefined();
  expect(data.performance.windowMs).toBe(10_000);
  expect(data.performance.history.length).toBeLessThan(original.diagnostics.history.length);
  expect(data.performance.history[0].timeMs).toBeGreaterThanOrEqual(data.performance.latest.timeMs - 10_000);
  expect(data.performance.history.at(-1).timeMs).toBe(data.performance.latest.timeMs);
  expect(data.performance.history.every((sample: object) => !('lod' in sample) && !('textures' in sample))).toBe(true);
  expect(data.performance.latest.timeMs).toBe(original.diagnostics.latest!.timeMs);
  expect(data.performance.renderLoops).toBe(0);
  expect(data.performance.paused).toBe(true);
  expect(JSON.stringify(data, null, 2).length).toBeLessThan(20_000);
  await info.attach('recent-performance-log', { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('mobile-settings.png') });
  await page.getByRole('button', { name: '继续游戏', exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(original.frames);
  expect(errors).toEqual([]);
});
