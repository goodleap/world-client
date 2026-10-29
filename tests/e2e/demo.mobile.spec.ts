import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('touch drag pans map; pinch zooms', async ({ page }) => {
  const errors = await openGame(page);
  const before = (await snapshot(page)).camera;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 550, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y: 500, id: 1 }] });
  const dragging = await snapshot(page);
  expect(dragging.camera.target.x).toBe(dragging.camera.x);
  expect(dragging.camera.target.z).toBe(dragging.camera.z);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await snapshot(page)).camera.x).toBeLessThan(before.x - 0.4);
  await page.waitForTimeout(300);
  expect((await snapshot(page)).camera.target).toEqual(dragging.camera.target);
  expect((await snapshot(page)).selection.resident).toBeUndefined();
  const zoom = (await snapshot(page)).camera.zoom;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 500, id: 1 }, { x: 240, y: 500, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 500, id: 1 }, { x: 280, y: 500, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(zoom - 0.5);
  expect(errors).toEqual([]);
});

test('touch selects a resident and sends a move command', async ({ page }) => {
  const errors = await openGame(page);
  const label = await page.locator('[data-resident="farmer"]').boundingBox();
  expect(label).not.toBeNull();
  await page.touchscreen.tap(label!.x + label!.width / 2, label!.y + label!.height + 18);
  await expect.poll(async () => (await snapshot(page)).selection.resident).toBe('farmer');
  const before = (await snapshot(page)).residents.find((r) => r.id === 'farmer')!.position;
  await page.touchscreen.tap(195, 650);
  await expect(page.locator('#toast')).toHaveText('前往目标位置');
  await expect.poll(async () => {
    const point = (await snapshot(page)).residents.find((r) => r.id === 'farmer')!.position;
    return Math.hypot(point.x - before.x, point.z - before.z);
  }, { timeout: 12_000 }).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});
