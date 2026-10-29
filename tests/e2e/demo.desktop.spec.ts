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
  const afterDrag = await snapshot(page);
  expect(afterDrag.camera.x).toBeLessThan(stopped - 0.4);
  expect(afterDrag.camera.target.x).toBe(afterDrag.camera.x);
  expect(afterDrag.camera.target.z).toBe(afterDrag.camera.z);
  expect(afterDrag.selection.resident).toBeUndefined();
  expect(afterDrag.selection.building).toBeUndefined();
  await page.waitForTimeout(300);
  expect((await snapshot(page)).camera.target).toEqual(afterDrag.camera.target);
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
  test.setTimeout(180_000);
  const errors = await openGame(page);
  const label = await page.locator('[data-resident="farmer"]').boundingBox();
  expect(label).not.toBeNull();
  await page.mouse.click(label!.x + label!.width / 2, label!.y + label!.height + 25);
  await expect.poll(async () => (await snapshot(page)).selection.resident).toBe('farmer');
  const before = (await snapshot(page)).residents.find((r) => r.id === 'farmer')!.position;
  // A nearby clear destination tests arrival within a bounded number of
  // simulation steps, even when software WebGL renders only a few fps.
  const camera = (await snapshot(page)).camera;
  const viewport = page.viewportSize()!;
  const pixels = viewport.height / (2 * camera.zoom);
  await page.mouse.click(viewport.width / 2 + (before.x - .25 - camera.x) * pixels,
    viewport.height / 2 + (.5 * Math.sin(camera.beta) - (before.z - .85 - camera.z) * Math.cos(camera.beta)) * pixels);
  await expect(page.locator('#toast')).toHaveText('前往目标位置');
  await expect.poll(async () => (await snapshot(page)).farmerRunning).toBe(true);
  expect((await snapshot(page)).farmerWalking).toBe(false);
  await expect.poll(async () => {
    const p = (await snapshot(page)).residents.find((r) => r.id === 'farmer')!.position;
    return Math.hypot(p.x - before.x, p.z - before.z);
  }, { timeout: 12_000 }).toBeGreaterThan(0.2);
  await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === 'farmer')!.routeRemaining, { timeout: 90_000 }).toBe(0);
  await expect.poll(async () => (await snapshot(page)).farmerModel.motion).toBe('idle');
  expect((await snapshot(page)).farmerRunning).toBe(false);
  expect((await snapshot(page)).farmerWalking).toBe(false);
  await page.mouse.click(425, 205);
  await expect.poll(async () => (await snapshot(page)).selection.building).toBe('cottage');
  expect(errors).toEqual([]);
});
