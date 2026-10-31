import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';
import { initialEconomy } from '../../src/game/economy.ts';

export function checkShadowSetting() {
  test('shadow switch stops shadow draws, preserves paused play and survives reload', async ({ page }, info) => {
    test.setTimeout(180_000);
    const state = initialEconomy(); state.steward.enabled = false;
    await page.addInitScript(state => {
      if (!localStorage.getItem('world-basic-economy-v1')) localStorage.setItem('world-basic-economy-v1', JSON.stringify(state));
    }, state);
    const errors = await openGame(page);
    await expect.poll(async () => (await snapshot(page)).diagnostics.latest?.shadowDrawCalls ?? 0).toBeGreaterThan(0);
    await page.locator('#settings').click();
    await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
    const frozen = await snapshot(page), toggle = page.locator('#shadows-enabled');
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(frozen.frames);
    await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
    const off = await snapshot(page);
    expect(off.shadows.enabled).toBe(false);
    expect(off.manualPaused).toBe(true);
    expect(off.economy).toEqual(frozen.economy);
    expect(off.shadows.mapId).toBe(frozen.shadows.mapId);
    await page.screenshot({ path: info.outputPath('shadows-setting-off.png'), scale: 'css' });
    await page.locator('#continue-game').click();
    await expect.poll(async () => (await snapshot(page)).diagnostics.latest?.shadowDrawCalls).toBe(0);
    expect((await snapshot(page)).diagnostics.latest?.shadowTriangles).toBe(0);

    await page.locator('#settings').click();
    await page.locator('#return-menu').click();
    await openGame(page);
    expect((await snapshot(page)).shadows.enabled).toBe(false);
    await page.locator('#settings').click();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.locator('#continue-game').click();
    await expect.poll(async () => (await snapshot(page)).diagnostics.latest?.shadowDrawCalls ?? 0).toBeGreaterThan(0);
    expect((await snapshot(page)).diagnostics.latest?.shadowTriangles).toBeGreaterThan(0);
    expect((await snapshot(page)).diagnostics.renderLoops).toBe(1);
    expect(errors).toEqual([]);
  });
}
