import { test, expect } from '@playwright/test';
import { ECONOMY_SAVE_KEY } from '../../src/game/economy-storage.ts';
import { snapshot } from './helpers.ts';

test('preparation fits narrow and landscape phones and protects the existing save', async ({ page }, info) => {
  await page.addInitScript(key => localStorage.setItem(key, 'keep-this-save'), ECONOMY_SAVE_KEY);
  await page.goto('/');
  await page.locator('#start-game').click();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'preparation');
  await expect(page.locator('input[name=mode][value=story]')).toBeChecked();
  await expect(page.locator('input[name=difficulty][value=standard]')).toBeChecked();
  await expect(page.locator('#new-game-dialog')).not.toBeVisible();
  expect(await page.locator('#game').count()).toBe(0);
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 851 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#enter-world')).toBeInViewport();
    await expect(page.locator('#preparation-back')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`preparation-${viewport.width}.png`) });
  }
  const scroll = page.locator('.preparation-scroll'), box = (await scroll.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + box.height - 20;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let step = 1; step <= 10; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 18, id: 1 }] });
    await page.waitForTimeout(20); // Native scrolling needs a real touch cadence.
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => scroll.evaluate(e => e.scrollTop)).toBeGreaterThan(40);
  await expect(page.locator('#enter-world')).toBeInViewport();
  expect(await page.locator('#home-name').evaluate(e => {
    const event = new Event('selectstart', { bubbles: true, cancelable: true }); e.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  await touch.detach();
  await page.locator('input[name=mode][value=free]').check();
  await page.locator('input[name=difficulty][value=challenging]').check();
  await expect(page.locator('#difficulty-description')).toContainText('补给较少');
  await page.locator('#home-name').fill('湖畔小村');
  await page.locator('#enter-world').click();
  await expect(page.locator('#new-game-dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#preparation-panel')).toBeVisible();
  await expect(page.locator('#home-name')).toHaveValue('湖畔小村');
  await page.locator('#preparation-back').click();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
  expect(await page.evaluate(key => localStorage.getItem(key), ECONOMY_SAVE_KEY)).toBe('keep-this-save');
});

test('a new free game uses selected settings and Continue ignores later preparation edits', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#start-game').click();
  await page.locator('input[name=mode][value=free]').check();
  await page.locator('input[name=difficulty][value=relaxed]').check();
  await page.locator('#home-name').fill('<b>湖畔</b>');
  await expect(page.locator('#setup-summary')).toContainText('粮食 36');
  await page.locator('#enter-world').click();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 90_000 });
  const expected = { mode: 'free', difficulty: 'relaxed', homeName: '<b>湖畔</b>' };
  expect((await snapshot(page)).economy.setup).toEqual(expected);
  expect((await snapshot(page)).economy.story).toBeNull();
  await expect(page.locator('#story-open')).not.toBeVisible();
  await page.locator('#home-resources').click();
  await expect(page.locator('#resources-title')).toHaveText(expected.homeName);
  expect(await page.locator('#resources-title b').count()).toBe(0);
  await page.getByRole('button', { name: '关闭家园面板' }).click();
  await page.locator('#settings').click(); await page.locator('#return-menu').click();
  await expect(page.locator('#menu-save-status')).toContainText('自由模式 · 轻松');
  await page.locator('#start-game').click();
  await page.locator('input[name=difficulty][value=challenging]').check();
  await page.locator('#home-name').fill('另一座村庄');
  await page.locator('#preparation-back').click(); await page.locator('#continue-save').click();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 90_000 });
  expect((await snapshot(page)).economy.setup).toEqual(expected);
  await page.screenshot({ path: info.outputPath('free-game.png') });
  expect(errors).toEqual([]);
});
