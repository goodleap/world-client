import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';
import { initialEconomy } from '../../src/game/economy.ts';

test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

test('phone actions follow targets through screen edges and settings isolate input through nested dialogs', async ({ page }, info) => {
  test.setTimeout(180_000);
  const state = initialEconomy(); state.steward.enabled = false;
  await page.addInitScript(state => localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)), state);
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
  // The backdrop neither resumes nor clicks through to the map.
  await page.touchscreen.tap(5, 847);
  await expect(page.locator('#settings-dialog')).toBeVisible();
  expect((await snapshot(page)).selection.object?.id).toBe('plot-0');
  expect((await snapshot(page)).economy.tasks).toHaveLength(0);
  await page.locator('#continue-game').tap();

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    for (const edge of ['left', 'right', 'top', 'bottom']) document.documentElement.style.setProperty(`--safe-${edge}`, '20px');
  });
  const followsPlot = async () => {
    const s = await snapshot(page), anchor = s.objects.find(o => o.id === 'plot-0')!.screen;
    const box = await page.locator('#selection-card').boundingBox();
    return !!box && Math.abs(box.x + box.width / 2 - anchor.x) < 1 && Math.abs(box.y + box.height + 18 - anchor.y) < 1;
  };
  await expect.poll(followsPlot).toBe(true);
  const centered = (await snapshot(page)).camera.target;
  const beforeEdge = await snapshot(page), anchor = beforeEdge.objects.find(o => o.id === 'plot-0')!.screen;
  // The popup stays attached to the plot, including inside the safe-area inset.
  // Start on bare canvas: the central action button correctly blocks map input.
  const start = await page.evaluate(() => [360, 400, 450].map(y => ({ x: 280, y }))
    .find(p => document.elementFromPoint(p.x, p.y)?.id === 'game'));
  expect(start).toBeDefined();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start!, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start!.x + 10 - anchor.x, y: start!.y, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(action).toBeVisible();
  await expect.poll(followsPlot).toBe(true);
  const foreground = await action.boundingBox();
  expect(foreground!.x).toBeLessThan(0);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.dataset.action,
    { x: Math.max(2, foreground!.x + foreground!.width / 2), y: foreground!.y + foreground!.height / 2 })).toBe('harvest');
  await page.screenshot({ path: info.outputPath('small-phone-edge-actions.png'), scale: 'css' });
  // Tap the visible part directly, as a phone user does; do not ask the test
  // runner to scroll a deliberately clipped action into view.
  await page.touchscreen.tap(Math.max(2, foreground!.x + foreground!.width / 2), foreground!.y + foreground!.height / 2);
  expect((await snapshot(page)).economy.tasks).toHaveLength(1);
  await expect(page.locator('#target-hint')).toBeVisible();
  const hint = await page.locator('#target-hint').boundingBox();
  const target = (await snapshot(page)).objects.find(o => o.id === 'plot-0')!.screen;
  expect(Math.abs(hint!.x + hint!.width / 2 - target.x)).toBeLessThan(1);
  expect(hint!.x).toBeLessThan(0);
  await page.screenshot({ path: info.outputPath('small-phone-edge-hint.png'), scale: 'css' });
  const currentAnchor = (await snapshot(page)).objects.find(o => o.id === 'plot-0')!.screen;
  const back = { x: 40, y: start!.y };
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, back)).toBe('game');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...back, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: back.x + anchor.x - currentAnchor.x, y: back.y, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => Math.abs((await snapshot(page)).camera.target.x - centered.x)).toBeLessThan(.02);
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
