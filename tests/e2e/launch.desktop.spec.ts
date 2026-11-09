import { test, expect } from '@playwright/test';
import { checkLaunch } from './launch-check.ts';

test('boot, menu and game have separate real loading phases', async ({ page }, info) => {
  test.setTimeout(150_000);
  await checkLaunch(page, info);
});

test('a resource failure offers reload without claiming completion', async ({ page }) => {
  await page.context().route(/\/assets\/characters-(?!lod-)[^/]+\.glb$/, route => route.abort('failed'));
  await page.goto('/');
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'error', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
  expect(Number(await page.locator('#loading-progress').getAttribute('value'))).toBeLessThan(100);
  await page.context().unroute(/\/assets\/characters-(?!lod-)[^/]+\.glb$/);
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByRole('button', { name: '开始游戏', exact: true })).toBeVisible();
});
