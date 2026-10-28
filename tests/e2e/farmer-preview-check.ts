import { expect, type Page } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

export async function checkFarmerPreview(page: Page) {
  const errors = await openGame(page);
  expect((await snapshot(page)).farmerModelLoaded).toBe(true);
  const button = page.getByRole('button', { name: '查看农民模型' });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(2.8);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(6);
  expect(errors).toEqual([]);
}
