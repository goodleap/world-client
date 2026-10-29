import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

export async function checkLaunch(page: Page, info: TestInfo) {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  let releaseUI!: () => void, releaseModel!: () => void;
  const uiGate = new Promise<void>(resolve => { releaseUI = resolve; });
  const modelGate = new Promise<void>(resolve => { releaseModel = resolve; });
  await page.route(/\/assets\/ui-[^/]+\.js$/, async route => { await uiGate; await route.continue(); });
  await page.route(/\/assets\/farmer-[^/]+\.glb$/, async route => { await modelGate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const screen = page.locator('#loading');
    await expect(screen).toHaveAttribute('data-phase', 'boot');
    await expect(page.getByRole('progressbar', { name: '基础加载进度' })).toHaveAttribute('value', '25');
    await expect(page.locator('#loading-percent')).toHaveText('25%');
    await page.screenshot({ path: info.outputPath('boot.png') });
    releaseUI();
    await expect(screen).toHaveAttribute('data-phase', 'menu');
    await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeVisible();
    expect(requests.filter(url => /\.glb(?:\?|$)|\/assets\/engine-/.test(url))).toEqual([]);
    expect(await page.locator('#game').count()).toBe(0);
    await page.screenshot({ path: info.outputPath('menu.png') });
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(screen).toHaveAttribute('data-phase', 'game-loading');
    await expect(screen).toHaveClass(/game-loading/);
    await expect(page.getByRole('progressbar', { name: '游戏资源加载进度' })).toBeVisible();
    await expect.poll(() => requests.some(url => /farmer-.*\.glb/.test(url))).toBe(true);
    expect(Number(await page.locator('#loading-progress').getAttribute('value'))).toBeLessThan(100);
    await page.screenshot({ path: info.outputPath('game-loading.png') });
    releaseModel();
    await expect(screen).toHaveAttribute('data-phase', 'playing', { timeout: 90_000 });
    await expect(page.locator('#loading-percent')).toHaveText('100%');
    await expect(page.locator('#game')).toBeVisible();
    await page.waitForFunction(() => (window.__DEMO__?.snapshot().frames ?? 0) > 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.evaluate(() => window.__DEMO__!.snapshot())).residents).toHaveLength(7);
    await page.screenshot({ path: info.outputPath('game.png') });
    expect(errors).toEqual([]);
  } finally { releaseUI(); releaseModel(); }
}
