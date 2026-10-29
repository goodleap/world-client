import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('base character runs to a command and returns to idle on arrival', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  expect((await snapshot(page)).baseModelLoaded).toBe(true);
  const loaded = (await snapshot(page)).baseModel;
  expect(loaded.meshes).toContain('Head • shaped cranium cheeks and jaw');
  expect(loaded.bones).toEqual(expect.arrayContaining(['root', 'pelvis', 'torso', 'head', 'clavicle.L', 'forearm.L', 'hand.L', 'shin.L', 'foot.L', 'knee_volume.L', 'knee_volume.R']));
  expect(loaded.animations).toEqual(['Walk', 'Run']);
  const label = await page.locator('[data-resident="base-human"]').boundingBox();
  expect(label).not.toBeNull();
  await page.mouse.click(label!.x + label!.width / 2, label!.y + label!.height + 24);
  await expect.poll(async () => (await snapshot(page)).selection.resident).toBe('base-human');
  const before = (await snapshot(page)).residents.find((r) => r.id === 'base-human')!.position;
  // A nearby clear section of the path exercises arrival without a long trip
  // on the software renderer (the simulation intentionally caps long frames).
  await page.mouse.click(640, 565);
  await expect(page.locator('#toast')).toHaveText('前往目标位置');
  await expect.poll(async () => (await snapshot(page)).baseRunning).toBe(true);
  expect((await snapshot(page)).baseWalking).toBe(false);
  const pose = (await snapshot(page)).baseModel.pose;
  await expect.poll(async () => (await snapshot(page)).baseModel.pose).not.toEqual(pose);
  await page.getByRole('button', { name: '操作说明', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).baseRunning).toBe(false);
  expect((await snapshot(page)).baseWalking).toBe(false);
  await page.getByRole('button', { name: '关闭操作说明' }).click();
  await expect.poll(async () => (await snapshot(page)).baseRunning).toBe(true);
  await expect.poll(async () => {
    const pos = (await snapshot(page)).residents.find((r) => r.id === 'base-human')!.position;
    return Math.hypot(pos.x - before.x, pos.z - before.z);
  }, { timeout: 12_000 }).toBeGreaterThan(0.2);
  await page.screenshot({ path: info.outputPath('base-human.png') });
  await expect.poll(async () => (await snapshot(page)).residents.find((r) => r.id === 'base-human')!.routeRemaining, { timeout: 75_000 }).toBe(0);
  await expect.poll(async () => (await snapshot(page)).baseModel.motion).toBe('idle');
  expect((await snapshot(page)).baseRunning).toBe(false);
  const arrived = (await snapshot(page)).residents.find((r) => r.id === 'base-human')!.position;
  await page.waitForTimeout(250);
  expect((await snapshot(page)).residents.find((r) => r.id === 'base-human')!.position).toEqual(arrived);
  expect(errors).toEqual([]);
});

test('base character close view shows the new model and returns to the map', async ({ page }, info) => {
  const errors = await openGame(page);
  const button = page.getByRole('button', { name: '查看基础人物', exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(1.6);
  await expect.poll(async () => (await snapshot(page)).baseWalking).toBe(false);
  expect((await snapshot(page)).baseRunning).toBe(false);
  await page.screenshot({ path: info.outputPath('base-character-close.png') });
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(1.8);
  await page.keyboard.down('KeyW');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.up('KeyW');
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(6);
  expect(errors).toEqual([]);
});
