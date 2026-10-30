import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

test('phone actions stay touchable at screen edges and settings isolate input through nested dialogs', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  const plot = (await snapshot(page)).objects.find(o => o.id === 'plot-0')!;
  await page.touchscreen.tap(plot.screen.x, plot.screen.y);
  const action = page.getByRole('button', { name: '收获', exact: true });
  await expect(action).toBeVisible();
  await expect(page.locator('#selection-card button')).toHaveCount(1);
  expect(await page.locator('#selection-card').evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderWidth, shadow: style.boxShadow };
  })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });
  const hit = await action.boundingBox();
  expect(hit!.width).toBeGreaterThanOrEqual(44); expect(hit!.height).toBeGreaterThanOrEqual(44);
  expect((await snapshot(page)).economy.tasks).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('phone-object-actions.png'), scale: 'css' });

  await page.getByRole('button', { name: '设置', exact: true }).tap();
  const frozen = await snapshot(page);
  await page.waitForTimeout(650);
  const paused = await snapshot(page);
  expect(paused.economy).toEqual(frozen.economy);
  expect(paused.residents).toEqual(frozen.residents);
  expect(paused.camera).toEqual(frozen.camera);
  // The native top layer owns hit testing even above a visible object action.
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('dialog')?.id,
    { x: hit!.x + hit!.width / 2, y: hit!.y + hit!.height / 2 })).toBe('settings-dialog');
  await page.locator('#settings-help').tap();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭操作说明', exact: true }).tap();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  expect((await snapshot(page)).manualPaused).toBe(true);
  await page.screenshot({ path: info.outputPath('phone-settings.png'), scale: 'css' });
  // Dismissing the backdrop must not also click the map underneath it.
  await page.touchscreen.tap(5, 847);
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  expect((await snapshot(page)).selection.object?.id).toBe('plot-0');
  expect((await snapshot(page)).economy.tasks).toHaveLength(0);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    for (const edge of ['left', 'right', 'top', 'bottom']) document.documentElement.style.setProperty(`--safe-${edge}`, '20px');
  });
  await expect.poll(async () => {
    const box = await page.locator('#selection-card').boundingBox();
    return !!box && box.x >= 20 && box.y >= 20 && box.x + box.width <= 300 && box.y + box.height <= 548;
  }).toBe(true);
  // Pan the selected plot close to the right edge; the popup stays within the safe area.
  const start = await page.evaluate(() => [250, 350, 450].map(y => ({ x: 4, y }))
    .find(p => document.elementFromPoint(p.x, p.y)?.id === 'game'));
  expect(start).toBeDefined();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start!, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start!.x + 30, y: start!.y, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(action).toBeVisible();
  await expect.poll(async () => {
    const box = await page.locator('#selection-card').boundingBox();
    return !!box && box.x >= 20 && box.x + box.width <= 300 && box.y >= 20 && box.y + box.height <= 548;
  }).toBe(true);
  const foreground = await action.boundingBox();
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.dataset.action,
    { x: foreground!.x + foreground!.width / 2, y: foreground!.y + foreground!.height / 2 })).toBe('harvest');
  await page.screenshot({ path: info.outputPath('small-phone-edge-actions.png'), scale: 'css' });
  await action.tap();
  expect((await snapshot(page)).economy.tasks).toHaveLength(1);
  await expect.poll(async () => (await snapshot(page)).economy.inventory.food, { timeout: 45000 }).toBe(8);
  await expect(page.locator('#selection-actions button')).toHaveCount(2);
  const buttons = await page.locator('#selection-actions button').all();
  const left = await buttons[0].boundingBox(), right = await buttons[1].boundingBox();
  expect(left!.y).toBe(right!.y); expect(right!.x).toBeGreaterThan(left!.x + left!.width);
  await page.screenshot({ path: info.outputPath('phone-two-actions.png'), scale: 'css' });
  // Exercise the same button layout with future three/four-action data. These
  // presentation-only buttons do not submit or mutate game jobs.
  for (const count of [3, 4]) {
    await page.locator('#selection-actions').evaluate((container, count) => {
      const button = document.createElement('button'); button.textContent = `操作 ${count}`;
      container.append(button);
    }, count);
    const rows = await page.locator('#selection-actions button').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().y)));
    expect(rows[0]).toBe(rows[1]); expect(rows[2]).toBeGreaterThan(rows[0]);
    if (count === 4) expect(rows[3]).toBe(rows[2]);
  }
  expect(errors).toEqual([]);
});
