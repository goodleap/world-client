import { test, expect } from '@playwright/test';
import { RESIDENTS, ENEMIES } from '../../src/game/resident-data.ts';
import { LOADING_HISTORY_KEY } from '../../src/loading-history.ts';

test('loading details explain a stalled shared download and complete processing separately', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let libraryRequests = 0;
  await page.route(/\/assets\/characters-(?!(?:far-)?lod-)[^/]+\.glb$/, async route => { libraryRequests++; await gate; await route.continue(); });
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
  await expect.poll(() => libraryRequests).toBe(1);
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  try {
    await expect(page.locator('#loading-progress')).toBeVisible();
    await expect(page.locator('#loading-status')).toBeHidden();
    await expect(page.locator('#loading-items')).toBeHidden();
    await page.locator('#loading-details summary').click();
    await expect(page.locator('#loading-details #loading-status')).toBeVisible();
    await expect(page.locator('#loading-status')).toContainText('没有新进展', { timeout: 20000 });
    await expect(page.locator('#loading-items')).toContainText('下载中');
    await expect(page.locator('#loading-items')).toContainText('游戏引擎与代码准备');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const list = page.locator('#loading-items');
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await list.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath('phone-loading-details.png') });
    const interrupted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).current, LOADING_HISTORY_KEY);
    expect(interrupted.status).toBe('loading');
    await page.reload();
    await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
    await page.locator('#loading-details summary').click();
    await expect(page.locator('#previous-loading')).toContainText('上次加载未完成');
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    await page.getByRole('button', { name: '进入世界', exact: true }).click();
    const history = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), LOADING_HISTORY_KEY);
    expect(history.previous.id).toBe(interrupted.id);
    expect(history.previous.events.some((event: { name: string }) => event.name === 'pagehide')).toBe(true);
    expect(history.current.id).not.toBe(interrupted.id);
  } finally { release(); }
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 60000 });
  expect(libraryRequests).toBe(2);
  // Preparing shaders and displaying the first frame must not age a new village.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('world-basic-economy-v1')!).seconds)).toBe(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).current.status, LOADING_HISTORY_KEY)).toBe('ready');
  // Packed buffers retain the native CPU data required for WebGL restoration.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const extension = gl!.getExtension('WEBGL_lose_context')!;
    const timeout = setTimeout(() => reject(new Error('WebGL restoration timed out')), 20000);
    canvas.addEventListener('webglcontextrestored', () => { clearTimeout(timeout); resolve(); }, { once: true });
    extension.loseContext(); setTimeout(() => extension.restoreContext(), 100);
  }));
  const events = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).current.events.map((event: { name: string }) => event.name), LOADING_HISTORY_KEY);
  expect(events).toEqual(expect.arrayContaining(['context-lost', 'context-restored']));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  // The game still exposes the real scene after every processing stage.
  expect(await page.evaluate(async () => (await window.__DEMO__!.snapshot()).residents.map(r => r.id).sort())).toEqual([...RESIDENTS, ...ENEMIES].map(r => r.id).sort());
  await page.screenshot({ path: info.outputPath('phone-context-restored.png') });
  expect(errors).toEqual([]);
});
