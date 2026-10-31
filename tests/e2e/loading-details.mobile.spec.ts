import { test, expect } from '@playwright/test';

test('loading details explain a stalled shared download and complete processing separately', async ({ page }, info) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let libraryRequests = 0;
  await page.route(/\/assets\/characters-(?!lod-)[^/]+\.glb$/, async route => { libraryRequests++; await gate; await route.continue(); });
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
  await expect.poll(() => libraryRequests).toBe(1);
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  try {
    await expect(page.locator('#loading-status')).toContainText('没有新进展', { timeout: 20000 });
    await expect(page.locator('#loading-items')).toContainText('下载中');
    await expect(page.locator('#loading-items')).toContainText('游戏引擎与代码准备');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const list = page.locator('#loading-items');
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await list.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath('phone-loading-details.png') });
  } finally { release(); }
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 60000 });
  expect(libraryRequests).toBe(1);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  // The game still exposes the real scene after every processing stage.
  expect(await page.evaluate(() => window.__DEMO__!.snapshot().residents.length)).toBe(7);
});
