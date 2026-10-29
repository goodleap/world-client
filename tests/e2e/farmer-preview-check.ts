import { expect, type Page } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

export async function checkFarmerPreview(page: Page) {
  const errors = await openGame(page);
  expect((await snapshot(page)).farmerModelLoaded).toBe(true);
  expect((await snapshot(page)).farmerModel.bones).toEqual((await snapshot(page)).baseModel.bones);
  expect((await snapshot(page)).farmerModel.animations).toEqual(['Walk', 'Run']);
  const button = page.getByRole('button', { name: '查看农民模型' });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await snapshot(page)).farmerWalking).toBe(true);
  const pose = (await snapshot(page)).farmerLegPose;
  expect(pose.length).toBe(4);
  await expect.poll(async () => (await snapshot(page)).farmerLegPose).not.toEqual(pose);
  await page.getByRole('button', { name: '操作说明', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).farmerWalking).toBe(false);
  await page.getByRole('button', { name: '关闭操作说明' }).click();
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(2.8);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(6);
  expect(errors).toEqual([]);
}
