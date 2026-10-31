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
  await page.getByRole('button', { name: '复制诊断信息', exact: true }).tap();
  await expect(page.locator('#settings-notice')).toContainText('已复制');
  const data = await page.evaluate(() => JSON.parse((window as unknown as { copied: string }).copied));
  expect(data.viewport.width).toBeGreaterThan(0);
  expect(data.rendering.drawCalls).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('mobile-settings.png') });
  await page.getByRole('button', { name: '继续游戏', exact: true }).tap();
  const before = (await snapshot(page)).camera.zoom;
  await page.getByRole('button', { name: '放大', exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(before - .3);
  expect(errors).toEqual([]);
});
