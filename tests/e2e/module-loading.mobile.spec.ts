import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 393, height: 754 }, deviceScaleFactor: 1 });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
      (window as unknown as { copied: string }).copied = text;
    } } });
  });
});

test('pending engine code is named, can be diagnosed or reloaded, and is shared with Start', async ({ page }, info) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let engineRequests = 0;
  await page.route(/\/assets\/engine-[^/]+\.js$/, async route => { engineRequests++; await gate; await route.continue(); });
  try {
    await page.goto('/');
    await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
    await expect.poll(() => engineRequests).toBe(1);
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    await expect(page.locator('#loading-status')).toContainText('engine-', { timeout: 20000 });
    await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#loading-items')).toContainText('字节进度未知');
    expect(await page.locator('#game').count()).toBe(0);
    await page.getByRole('button', { name: '复制加载诊断' }).click();
    const pending = await page.evaluate(() => JSON.parse((window as unknown as { copied: string }).copied));
    const request = pending.loading.find((item: { name: string }) => item.name.includes('engine-'));
    expect(request.state).toBe('working');
    expect(request.loaded).toBeUndefined();
    expect(request.request.url).toMatch(/\/assets\/engine-.+\.js$/);
    expect(pending.loading.find((item: { id: string }) => item.id === 'engine').state).toBe('working');
    expect(pending.loading.some((item: { id: string }) => item.id.endsWith('.glb'))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('wechat-size-engine-wait.png'), fullPage: true });
    release();
    await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 60000 });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '复制诊断信息', exact: true }).click();
    const ready = await page.evaluate(() => JSON.parse((window as unknown as { copied: string }).copied));
    const finished = ready.loading.find((item: { name: string }) => item.name.includes('engine-'));
    expect(finished.state).toBe('done');
    expect(finished.loaded).toBeGreaterThan(0);
    expect(finished.total).toBe(finished.loaded);
    expect(finished.request.responseEndMs).toBeGreaterThan(finished.request.startMs);
    expect(ready.loading.find((item: { id: string }) => item.id === 'engine').state).toBe('done');
    expect(engineRequests).toBe(1);
  } finally { release(); }
});

test('engine HTTP errors identify the file and retain reload', async ({ page }) => {
  await page.route(/\/assets\/engine-[^/]+\.js$/, route => route.fulfill({ status: 503, contentType: 'text/javascript', body: '' }));
  await page.goto('/');
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'error');
  await expect(page.locator('#loading-items')).toContainText('HTTP 503');
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
  await page.getByRole('button', { name: '复制加载诊断' }).click();
  const data = await page.evaluate(() => JSON.parse((window as unknown as { copied: string }).copied));
  expect(data.loading.find((item: { name: string }) => item.name.includes('engine-')).state).toBe('failed');
});
