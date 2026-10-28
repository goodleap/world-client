import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('real touch drag moves the character; release and cancellation stop it', async ({ page }, info) => {
  const errors = await openGame(page);
  await expect(page.locator('.touch-hint')).toBeVisible();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 550, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y: 500, id: 1 }] });
  await expect(page.locator('#joystick')).toHaveClass('joystick active');
  await page.waitForFunction(() => window.__DEMO__!.snapshot().player.x > 0.8);
  expect((await snapshot(page)).player.z).toBeGreaterThan(-5.5);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const stopped = (await snapshot(page)).player;
  await page.waitForTimeout(350);
  expect((await snapshot(page)).player).toEqual(stopped);
  await expect(page.locator('#joystick')).not.toHaveClass('joystick active');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 550, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y: 580, id: 2 }] });
  await page.waitForTimeout(200);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const cancelled = (await snapshot(page)).player;
  await page.waitForTimeout(350);
  expect((await snapshot(page)).player).toEqual(cancelled);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('mobile.png') });
  await info.attach('mobile', { path: info.outputPath('mobile.png'), contentType: 'image/png' });
});

test('two-finger pinch changes zoom without moving the player', async ({ page }) => {
  await openGame(page);
  const initial = await snapshot(page);
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 500, id: 1 }, { x: 240, y: 500, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 500, id: 1 }, { x: 280, y: 500, id: 2 }] });
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(initial.camera.zoom - 1);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await snapshot(page)).player).toEqual(initial.player);
});

test('portrait and landscape resizing keep the canvas and controls within the viewport', async ({ page }) => {
  await openGame(page);
  for (const viewport of [{ width: 360, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await snapshot(page)).size.width).toBe(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const reset = await page.getByRole('button', { name: '回到起点' }).boundingBox();
    expect(reset!.x).toBeGreaterThanOrEqual(0);
    expect(reset!.y + reset!.height).toBeLessThanOrEqual(viewport.height);
    await page.getByRole('button', { name: '操作说明', exact: true }).click();
    await expect(page.locator('#help-dialog')).toBeVisible();
    await page.getByRole('button', { name: '关闭操作说明' }).click();
  }
});
