import { test, expect } from '@playwright/test';
import { moveUntil, openGame, snapshot } from './helpers.ts';

test('renders a real 3D world, skinned character and a bounded draw-call scene', async ({ page }, info) => {
  const errors = await openGame(page);
  const state = await snapshot(page);
  expect(state.bones).toBe(7); expect(state.cells).toBe(624);
  expect(state.meshes).toBeGreaterThan(10); expect(state.meshes).toBeLessThan(45);
  expect(state.camera.alpha).toBeCloseTo(-Math.PI / 2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('desktop.png') });
  await info.attach('desktop', { path: info.outputPath('desktop.png'), contentType: 'image/png' });
});

test('WASD and arrow keys move, release and focus loss stop movement', async ({ page }) => {
  const errors = await openGame(page);
  await moveUntil(page, 'KeyD', 'x', 1, true);
  const released = (await snapshot(page)).player;
  await page.waitForTimeout(350);
  expect((await snapshot(page)).player).toEqual(released);
  await moveUntil(page, 'ArrowUp', 'z', -4.5, true);
  await page.keyboard.down('KeyD');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurred = (await snapshot(page)).player;
  await page.waitForTimeout(350);
  expect((await snapshot(page)).player).toEqual(blurred);
  await page.keyboard.up('KeyD');
  expect(errors).toEqual([]);
});

test('a landmark can be discovered and cottage walls stop the player', async ({ page }) => {
  const errors = await openGame(page);
  await moveUntil(page, 'KeyW', 'z', 1.55, true);
  await moveUntil(page, 'KeyA', 'x', -4.7, false);
  await expect(page.locator('#nearby-name')).toHaveText('暖阳小屋');
  await page.keyboard.press('KeyE');
  await expect(page.locator('#landmark-dialog')).toBeVisible();
  await expect(page.locator('#progress-count')).toHaveText('1 / 3');
  await page.getByRole('button', { name: '继续逛逛' }).click();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyW');
  const position = (await snapshot(page)).player;
  expect(position.z).toBeGreaterThan(2.1); expect(position.z).toBeLessThanOrEqual(2.35);
  expect(errors).toEqual([]);
});

test('overview, zoom, reset and help work without moving behind a modal', async ({ page }) => {
  await openGame(page);
  const initialZoom = (await snapshot(page)).camera.zoom;
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(initialZoom - 0.5);
  await page.getByRole('button', { name: '查看全景' }).click();
  expect((await snapshot(page)).camera.overview).toBe(true);
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(14);
  const overviewZoom = (await snapshot(page)).camera.zoom;
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(overviewZoom - 0.5);
  await page.getByRole('button', { name: '回到起点' }).click();
  expect((await snapshot(page)).player).toEqual({ x: 0, z: -5.5 });
  expect((await snapshot(page)).camera.overview).toBe(false);
  await page.getByRole('button', { name: '操作说明', exact: true }).click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(300); await page.keyboard.up('KeyW');
  expect((await snapshot(page)).player).toEqual({ x: 0, z: -5.5 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-dialog')).not.toBeVisible();
});
