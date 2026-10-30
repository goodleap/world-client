import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('six jobs run through automatic navigation, shared work, inventory and construction', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors = await openGame(page);
  const choose = async (id: string, action: string) => {
    if ((await snapshot(page)).selection.object?.id !== id) {
      // Object actions intentionally intercept input over nearby map objects.
      if (await page.locator('#selection-card').isVisible()) await page.keyboard.press('Escape');
      const object = (await snapshot(page)).objects.find(o => o.id === id)!;
      await page.mouse.click(object.screen.x, object.screen.y);
      await expect.poll(async () => (await snapshot(page)).selection.object?.id).toBe(id);
    }
    await page.getByRole('button', { name: action, exact: true }).click();
  };
  await choose('site-1', '建设民房'); // Deliberately unfunded: the farmer must do the next executable task.
  expect((await snapshot(page)).economy.tasks[0].reason).toContain('缺少');
  await choose('plot-0', '收获');
  await expect.poll(async () => (await snapshot(page)).farmerModel.motion, { timeout: 45_000 }).toBe('work');
  expect((await snapshot(page)).farmerRunning).toBe(false);
  await page.screenshot({ path: info.outputPath('harvesting.png') });
  await expect.poll(async () => (await snapshot(page)).economy.inventory.food, { timeout: 20_000 }).toBe(8);
  await choose('plot-5', '开垦');
  await expect.poll(async () => (await snapshot(page)).economy.plots.find(p => p.id === 'plot-5')!.tilled, { timeout: 40_000 }).toBe(true);
  await choose('plot-5', '种胡萝卜');
  await expect.poll(async () => (await snapshot(page)).economy.plots.find(p => p.id === 'plot-5')!.crop, { timeout: 25_000 }).toBe('carrot');
  await choose('tree-11', '伐木');
  await choose('rock-1', '采石');
  await page.getByRole('button', { name: /^作业 \d/ }).click();
  await expect(page.locator('#queue-panel')).toBeVisible();
  expect((await snapshot(page)).manualPaused).toBe(false);
  await page.screenshot({ path: info.outputPath('queue.png') });
  await page.getByRole('button', { name: '收起作业队列' }).click();
  await expect.poll(async () => (await snapshot(page)).economy.buildings, { timeout: 150_000 }).toEqual(['site-1']);
  const completed = await snapshot(page);
  expect(completed.economy.inventory).toEqual({ wood: 12, stone: 8, food: 8 });
  expect(completed.economy.depleted.sort()).toEqual(['rock-1', 'tree-11']);
  expect(completed.economy.tasks.every(task => task.status === 'done')).toBe(true);
  expect(completed.objects.find(o => o.id === 'site-1')!.kind).toBe('building');
  expect(completed.objects.some(o => o.id === 'tree-11')).toBe(false);
  await choose('plot-5', '收获');
  await expect.poll(async () => (await snapshot(page)).economy.inventory.food, { timeout: 60_000 }).toBe(16);
  await expect.poll(async () => (await snapshot(page)).farmerModel.motion).toBe('idle');
  await page.screenshot({ path: info.outputPath('completed-village.png') });
  // Reload uses the browser save and cannot repeat output or advance crops offline.
  const before = (await snapshot(page)).economy.inventory;
  await page.reload(); await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('#loading')).toHaveClass(/\bloaded\b/, { timeout: 60_000 });
  expect((await snapshot(page)).economy.inventory).toEqual(before);
  expect((await snapshot(page)).economy.buildings).toEqual(['site-1']);
  expect(errors).toEqual([]);
});

test('working and crop clocks freeze in background and manual pause; resume does not catch up', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  const object = (await snapshot(page)).objects.find(o => o.id === 'plot-0')!;
  await page.mouse.click(object.screen.x, object.screen.y); await page.getByRole('button', { name: '收获', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).farmerModel.motion, { timeout: 45_000 }).toBe('work');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const frozen = await snapshot(page); await page.waitForTimeout(1500);
  expect(frozen.farmerModel.effectiveWorkPlaybackRate).toBeCloseTo(2, 6);
  expect((await snapshot(page)).economy).toEqual(frozen.economy);
  expect((await snapshot(page)).farmerModel).toEqual(frozen.farmerModel);
  const first = await page.evaluate(() => new Promise<ReturnType<NonNullable<Window['__DEMO__']>['snapshot']>>(resolve => {
    const frames = window.__DEMO__!.snapshot().frames;
    window.dispatchEvent(new Event('focus'));
    const check = () => { const s = window.__DEMO__!.snapshot(); if (s.frames > frames) resolve(s); else requestAnimationFrame(check); }; requestAnimationFrame(check);
  }));
  expect(first.economy).toEqual(frozen.economy);
  expect(first.farmerModel.pose).toEqual(frozen.farmerModel.pose);
  await page.getByRole('button', { name: '操作说明', exact: true }).click();
  const manual = (await snapshot(page)).economy; await page.waitForTimeout(800);
  expect((await snapshot(page)).economy).toEqual(manual);
  await page.getByRole('button', { name: '关闭操作说明' }).click();
  await expect.poll(async () => (await snapshot(page)).economy.inventory.food, { timeout: 25_000 }).toBe(8);
  await expect.poll(async () => (await snapshot(page)).farmerModel.motion).toBe('idle');
  expect((await snapshot(page)).economy.tasks[0].progress).toBe(3);
  expect((await snapshot(page)).residents.find(r => r.id === 'farmer')!.facing).toEqual(frozen.residents.find(r => r.id === 'farmer')!.facing);
  expect(errors).toEqual([]);
});
