import { test, expect } from '@playwright/test';
import { snapshot } from './helpers.ts';

test('the default story opening is keyboard accessible and exposes a real chapter objective', async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
  await page.locator('#start-game').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'preparation');
  await expect(page.locator('#preparation-title')).toBeFocused();
  await page.screenshot({ path: info.outputPath('desktop-preparation.png') });
  await page.keyboard.press('Escape'); await expect(page.locator('#start-game')).toBeFocused();
  await page.keyboard.press('Enter'); await page.locator('#enter-world').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 90_000 });
  expect((await snapshot(page)).economy.setup).toEqual({ mode: 'story', difficulty: 'standard', homeName: '溪谷家园' });
  await page.locator('#story-open').click();
  await expect(page.locator('#story-dialog')).toBeVisible();
  await expect(page.locator('#story-objective')).not.toBeEmpty();
  const before = (await snapshot(page)).economy;
  await page.waitForTimeout(400);
  expect((await snapshot(page)).economy.seconds).toBe(before.seconds);
  await page.screenshot({ path: info.outputPath('story-objective.png') });
  expect(errors).toEqual([]);
});
