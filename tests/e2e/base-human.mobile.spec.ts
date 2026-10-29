import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('new base character is visible in touch close view', async ({ page }, info) => {
  const errors = await openGame(page);
  const button = page.getByRole('button', { name: '查看基础人物', exact: true });
  await button.tap();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeLessThan(1.9);
  const current = (await snapshot(page)).baseModel;
  expect(current.meshes).toContain('Head • shaped cranium cheeks and jaw');
  expect(current.bones).toContain('clavicle.L');
  expect((await snapshot(page)).baseWalking).toBe(false);
  expect((await snapshot(page)).baseRunning).toBe(false);
  await page.screenshot({ path: info.outputPath('base-character-mobile.png') });
  await button.tap();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(6);
  expect(errors).toEqual([]);
});
