import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('ordinary text is not selectable and diagnostics copy from the settings modal', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
      (window as unknown as { copied: string }).copied = text;
    } } });
  });
  const errors = await openGame(page);
  await expect(page.locator('#game-page h1')).toHaveCSS('user-select', 'none');
  await page.getByRole('button', { name: '设置', exact: true }).tap();
  await page.getByRole('button', { name: '记录当前视距', exact: true }).tap();
  await expect(page.locator('#settings-notice')).toContainText('已记录近景');
  await page.getByRole('button', { name: '复制诊断信息', exact: true }).tap();
  await expect(page.locator('#settings-notice')).toContainText('已复制');
  const data = await page.evaluate(() => JSON.parse((window as unknown as { copied: string }).copied));
  expect(data.viewport.width).toBeGreaterThan(0);
  expect(data.rendering.drawCalls).toBeGreaterThan(0);
  expect(data.performance.marks[0].label).toBe('近景');
  expect(data.performance.marks[0].sample.renderLoops).toBe(1);
  expect(data.performance.latest.lod).toHaveLength(6);
  expect(data.performance.latest.shadowLodCamera).toBe('map-shadow-lod');
  expect(data.performance.renderer).toEqual(expect.any(String));
  expect(data.shadows.lodCamera).toBe('map-shadow-lod');
  await page.screenshot({ path: info.outputPath('mobile-settings.png') });
  await page.getByRole('button', { name: '继续游戏', exact: true }).tap();
  const before = (await snapshot(page)).camera.zoom;
  await page.getByRole('button', { name: '放大', exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(before - .3);
  expect(errors).toEqual([]);
});
