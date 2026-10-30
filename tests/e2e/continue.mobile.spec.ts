import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { ECONOMY_SAVE_KEY } from '../../src/game/economy-storage.ts';
import { snapshot } from './helpers.ts';

test('the phone menu separates continue and new game, preserving progress when replacement is cancelled', async ({ page }, info) => {
  test.setTimeout(150_000);
  const economy = new Economy(); economy.state.inventory.wood = 23;
  const saved = encodeEconomy(economy);
  await page.addInitScript(({ key, saved }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, saved);
  }, { key: ECONOMY_SAVE_KEY, saved });
  await page.goto('/');
  await expect(page.locator('#continue-save')).toBeEnabled();
  await expect(page.locator('#start-game')).toHaveText('开始游戏');
  await page.screenshot({ path: info.outputPath('phone-continue-menu.png') });
  await page.locator('#start-game').tap();
  await expect(page.locator('#new-game-dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).tap();
  expect(await page.evaluate(key => localStorage.getItem(key), ECONOMY_SAVE_KEY)).toBe(saved);
  await page.locator('#continue-save').tap();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 60_000 });
  expect((await snapshot(page)).economy.inventory.wood).toBe(23);
  await page.getByRole('button', { name: '设置', exact: true }).tap();
  await page.getByRole('button', { name: '回到主菜单', exact: true }).tap();
  await expect(page.locator('#continue-save')).toBeEnabled();
  await page.locator('#start-game').tap();
  await page.screenshot({ path: info.outputPath('phone-new-game-confirm.png') });
  await page.getByRole('button', { name: '开始新游戏', exact: true }).tap();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 60_000 });
  expect((await snapshot(page)).economy.inventory.wood).toBe(new Economy().state.inventory.wood);
  const fresh = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), ECONOMY_SAVE_KEY);
  expect(fresh.inventory.wood).toBe(new Economy().state.inventory.wood);
  await page.reload();
  await expect(page.locator('#continue-save')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('missing and corrupt saves disable Continue; cancelling new game preserves corrupt data', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
  await expect(page.locator('#continue-save')).toBeDisabled();
  await expect(page.locator('#menu-save-status')).toContainText('暂无存档');
  await page.evaluate(key => localStorage.setItem(key, 'broken-save'), ECONOMY_SAVE_KEY);
  await page.reload();
  await expect(page.locator('#menu-save-status')).toContainText('原数据已保留');
  await expect(page.locator('#continue-save')).toBeDisabled();
  await page.locator('#start-game').tap();
  await page.getByRole('button', { name: '取消', exact: true }).tap();
  expect(await page.evaluate(key => localStorage.getItem(key), ECONOMY_SAVE_KEY)).toBe('broken-save');
});

test('a failed new-game load does not overwrite the previous save', async ({ page }) => {
  const economy = new Economy(); economy.state.inventory.wood = 29;
  const saved = encodeEconomy(economy);
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, saved), { key: ECONOMY_SAVE_KEY, saved });
  await page.route(/\/assets\/farmer-[^/]+\.glb$/, route => route.abort('failed'));
  await page.goto('/');
  await page.locator('#start-game').tap();
  await page.getByRole('button', { name: '开始新游戏', exact: true }).tap();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'error');
  expect(await page.evaluate(key => localStorage.getItem(key), ECONOMY_SAVE_KEY)).toBe(saved);
});
