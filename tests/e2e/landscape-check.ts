import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { gridPoint } from '../../src/game/world-data.ts';
import { openGame, snapshot, clickGround } from './helpers.ts';

export function checkLandscape(touch = false) {
  test('the default landscape has usable farmland, a solid shoreline and working shadow controls', async ({ page }, info) => {
    test.setTimeout(180_000);
    const state = initialEconomy(); state.steward.enabled = false;
    await page.addInitScript(state => {
      if (!localStorage.getItem('world-basic-economy-v1')) localStorage.setItem('world-basic-economy-v1', JSON.stringify(state));
    }, state);
    const errors = await openGame(page);
    expect((await snapshot(page)).objects.filter(o => o.kind === 'tree').length).toBeGreaterThan(70);
    expect((await snapshot(page)).objects.filter(o => o.kind === 'rock').length).toBeGreaterThan(20);
    const click = async (selector: string) => touch ? page.locator(selector).tap() : page.locator(selector).click();
    await click('#building-toggle'); await click('#build-farm');
    await clickGround(page, gridPoint(51.5, 55.5), touch);
    await expect.poll(async () => (await snapshot(page)).economy.plots.length).toBe(13);
    await expect.poll(async () => (await snapshot(page)).economy.plots[12].tilled, { timeout: 60000 }).toBe(true);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('world-basic-economy-v1')))! ).plots).toHaveLength(13);
    await page.screenshot({ path: info.outputPath('landscape-farm.png'), scale: 'css' });

    await openGame(page);
    // Reach the shore through the real map controls, without a separate review mode.
    const stateAtHome = await snapshot(page), viewport = page.viewportSize()!;
    const units = 2 * stateAtHome.camera.zoom / viewport.height;
    await page.locator('#game').dispatchEvent('wheel', { deltaX: (25 - stateAtHome.camera.target.x) / units, deltaY: -(14 - stateAtHome.camera.target.z) * Math.cos(stateAtHome.camera.beta) / units, deltaMode: 0 });
    expect((await snapshot(page)).economy.plots).toHaveLength(13);
    await click('#building-toggle'); await click('#build-farm');
    await clickGround(page, gridPoint(68.5, 40.5), touch);
    expect((await snapshot(page)).placement.reason).toContain('水域');
    expect((await snapshot(page)).economy.plots).toHaveLength(13);
    await click('#cancel-building');
    await click('#settings'); await page.locator('#shadows-enabled').uncheck(); await click('#continue-game');
    await expect.poll(async () => (await snapshot(page)).diagnostics.latest?.shadowTriangles).toBe(0);
    await page.screenshot({ path: info.outputPath('landscape-shore-shadows-off.png'), scale: 'css' });
    await click('#settings'); await page.locator('#shadows-enabled').check(); await click('#continue-game');
    await expect.poll(async () => (await snapshot(page)).diagnostics.latest?.shadowTriangles).toBeGreaterThan(0);
    expect((await snapshot(page)).diagnostics.latest!.renderLoops).toBe(1);
    expect(errors).toEqual([]);
  });
}
