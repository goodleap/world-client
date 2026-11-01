import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { DEFAULT_LIGHTING } from '../../src/game/graphics-settings.ts';
import { openGame, snapshot } from './helpers.ts';

export function checkLighting() {
  test('lighting previews on demand while paused, persists and resets without resuming the game', async ({ page }, info) => {
    test.setTimeout(180_000);
    const state = initialEconomy(); state.steward.enabled = false;
    await page.addInitScript(state => {
      if (!localStorage.getItem('world-basic-economy-v1')) localStorage.setItem('world-basic-economy-v1', JSON.stringify(state));
    }, state);
    const errors = await openGame(page);
    await page.locator('#settings').click();
    await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-dialog')).toBeVisible();
    const paused = await snapshot(page);
    await page.locator('#environment-light').fill('0.2');
    await page.locator('#sunlight').fill('1.2');
    await page.locator('#sun-color').fill('#ffc080');
    await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(paused.frames);
    await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
    expect((await snapshot(page)).lighting).toEqual({ environment: .2, sunlight: 1.2, sunColor: '#ffc080' });
    expect((await snapshot(page)).simulationSeconds).toBe(paused.simulationSeconds);
    expect((await snapshot(page)).residents).toEqual(paused.residents);
    await page.screenshot({ path: info.outputPath('lighting-adjusted.png'), scale: 'css' });
    await page.locator('#return-menu').click();
    await openGame(page);
    expect((await snapshot(page)).lighting).toEqual({ environment: .2, sunlight: 1.2, sunColor: '#ffc080' });
    await page.locator('#settings').click();
    await page.locator('#reset-lighting').click();
    await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
    expect((await snapshot(page)).lighting).toEqual(DEFAULT_LIGHTING);
    await expect(page.locator('#environment-light-value')).toHaveText('0.72');
    await expect(page.locator('#sunlight-value')).toHaveText('0.56');
    await page.screenshot({ path: info.outputPath('lighting-default.png'), scale: 'css' });
    const frozen = await snapshot(page);
    await page.waitForTimeout(350);
    expect((await snapshot(page)).frames).toBe(frozen.frames);
    await page.locator('#continue-game').click();
    await expect.poll(async () => (await snapshot(page)).simulationSeconds).toBeGreaterThan(frozen.simulationSeconds);
    expect(errors).toEqual([]);
  });
}
