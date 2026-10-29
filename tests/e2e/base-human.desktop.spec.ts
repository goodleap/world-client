import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('base character loads, can be selected, and walks when commanded', async ({ page }, info) => {
  const errors = await openGame(page);
  expect((await snapshot(page)).baseModelLoaded).toBe(true);
  const label = await page.locator('[data-resident="base-human"]').boundingBox();
  expect(label).not.toBeNull();
  await page.mouse.click(label!.x + label!.width / 2, label!.y + label!.height + 24);
  await expect.poll(async () => (await snapshot(page)).selection.resident).toBe('base-human');
  const before = (await snapshot(page)).residents.find((r) => r.id === 'base-human')!.position;
  await page.mouse.click(640, 650);
  await expect(page.locator('#toast')).toHaveText('前往目标位置');
  await expect.poll(async () => (await snapshot(page)).baseWalking).toBe(true);
  await expect.poll(async () => {
    const pos = (await snapshot(page)).residents.find((r) => r.id === 'base-human')!.position;
    return Math.hypot(pos.x - before.x, pos.z - before.z);
  }, { timeout: 12_000 }).toBeGreaterThan(0.2);
  await page.screenshot({ path: info.outputPath('base-human.png') });
  expect(errors).toEqual([]);
});
