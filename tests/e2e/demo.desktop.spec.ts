import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('WASD and drag pan the camera and release stops movement', async ({ page }) => {
  const errors = await openGame(page);
  const initial = (await snapshot(page)).camera;
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await snapshot(page)).camera.x).toBeGreaterThan(initial.x + 0.5);
  await page.keyboard.up('KeyD');
  const stopped = (await snapshot(page)).camera.x;
  await page.waitForTimeout(250); expect((await snapshot(page)).camera.x).toBe(stopped);
  await page.mouse.move(600, 500); await page.mouse.down(); await page.mouse.move(670, 500, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).camera.x).toBeLessThan(stopped - 0.4);
  expect(errors).toEqual([]);
});

test('zoom, overview, reset and modal work', async ({ page }) => {
  await openGame(page);
  const initial = (await snapshot(page)).camera.zoom;
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(initial - 0.5);
  await page.getByRole('button', { name: '查看全景' }).click();
  expect((await snapshot(page)).camera.overview).toBe(true);
  await page.getByRole('button', { name: '回到起点' }).click();
  expect((await snapshot(page)).camera.overview).toBe(false);
  await page.getByRole('button', { name: '操作说明', exact: true }).click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('selecting a resident and clicking open ground sends them moving', async ({ page }) => {
  const errors = await openGame(page);
  const label = await page.locator('[data-resident="farmer"]').boundingBox();
  expect(label).not.toBeNull();
  await page.mouse.click(label!.x + label!.width / 2, label!.y + label!.height + 25);
  await expect.poll(async () => (await snapshot(page)).selection.resident).toBe('farmer');
  const before = (await snapshot(page)).residents.find((r) => r.id === 'farmer')!.position;
  await page.mouse.click(640, 650);
  await expect(page.locator('#toast')).toHaveText('前往目标位置');
  await expect.poll(async () => {
    const p = (await snapshot(page)).residents.find((r) => r.id === 'farmer')!.position;
    return Math.hypot(p.x - before.x, p.z - before.z);
  }, { timeout: 12_000 }).toBeGreaterThan(0.2);
  await page.mouse.click(425, 205);
  await expect.poll(async () => (await snapshot(page)).selection.building).toBe('cottage');
  expect(errors).toEqual([]);
});
