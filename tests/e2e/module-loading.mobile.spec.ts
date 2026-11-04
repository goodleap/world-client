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
    await expect(page.locator('#loading-status')).toBeHidden();
    await page.locator('#loading-details summary').click();
    await expect(page.locator('#loading-status')).toContainText('engine-', { timeout: 20000 });
    await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#loading-items')).toContainText('字节进度未知');
    expect(await page.locator('#game').count()).toBe(0);
    await page.getByRole('button', { name: '复制加载诊断' }).click();
    const pending = await page.evaluate(() => JSON.parse((window as unknown as { copied: string }).copied));
    const request = pending.loading.issues.find((item: { name: string }) => item.name.includes('engine-'));
    expect(request.state).toBe('working');
    expect(request.loaded).toBeUndefined();
    expect(request.id).toMatch(/\/assets\/engine-.+\.js$/);
    expect(pending.loading.issues.find((item: { id: string }) => item.id === 'engine').state).toBe('working');
    expect(pending.loading.issues.some((item: { id: string }) => item.id.endsWith('.glb'))).toBe(false);
    expect(pending.startup.current.status).toBe('loading');
    expect(pending.startup.current.build).toBe(pending.build);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('wechat-size-engine-wait.png'), fullPage: true });
    release();
    await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 60000 });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '回到主菜单', exact: true }).click();
    await page.locator('#loading-details summary').click();
    await page.getByRole('button', { name: '复制加载诊断', exact: true }).click();
    const ready = await page.evaluate(() => JSON.parse((window as unknown as { copied: string }).copied));
    // Completed individual requests are summarized in schema 2. Check this
    // engine request in the retained detail row and the aggregate stage log.
    expect(ready.loading.issues.some((item: { id: string; name: string }) => item.id === 'engine' || item.name.includes('engine-'))).toBe(false);
    await expect(page.locator('#loading-items li').filter({ hasText: '代码文件 · engine-' })).toHaveAttribute('data-state', 'done');
    expect(ready.loading.downloads.bodyBytes).toBeGreaterThan(0);
    expect(ready.loading.downloads.codeSpanMs).toBeGreaterThan(0);
    expect(ready.loading.stages.engine.count).toBe(1);
    expect(ready.startup.current.status).toBe('ready');
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
  expect(data.loading.issues.find((item: { name: string }) => item.name.includes('engine-')).state).toBe('failed');
  expect(data.startup.current.status).toBe('error');
  expect(data.startup.current.error).toBeTruthy();
});

test('completed WebKit-style zero-size module timings do not remain downloading', async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of ['encodedBodySize', 'decodedBodySize', 'responseStatus']) {
      Object.defineProperty(PerformanceResourceTiming.prototype, key, { configurable: true, get: () => 0 });
    }
  });
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
  await page.locator('#loading-details summary').click();
  for (const prefix of ['index-', 'ui-']) {
    const row = page.locator('#loading-items li').filter({ hasText: `代码文件 · ${prefix}` });
    await expect(row).toHaveAttribute('data-state', 'done');
    await expect(row).toContainText('大小未知');
    await expect(row).not.toContainText('下载中');
  }
});
