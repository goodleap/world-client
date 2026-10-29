import { test, expect } from '@playwright/test';
import { checkLaunch } from './launch-check.ts';

test('boot, menu and game have separate real loading phases', async ({ page }, info) => {
  test.setTimeout(150_000);
  await checkLaunch(page, info);
});

test('a resource failure offers reload without claiming completion', async ({ page }) => {
  await page.route(/\/assets\/farmer-[^/]+\.glb$/, route => route.abort('failed'));
  await page.goto('/');
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'error');
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
  expect(Number(await page.locator('#loading-progress').getAttribute('value'))).toBeLessThan(100);
  await page.unroute(/\/assets\/farmer-[^/]+\.glb$/);
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeVisible();
});
