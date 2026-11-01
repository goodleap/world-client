import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { gridPoint } from '../../src/game/world-data.ts';
import { openGame, snapshot, clickGround } from './helpers.ts';

export function checkLandscape(touch = false) {
  test('landscape review has isolated saves, usable farmland, a solid shoreline and working shadow controls', async ({ page }, info) => {
    test.setTimeout(180_000);
    const state = initialEconomy(); state.steward.enabled = false;
    await page.addInitScript(state => {
      if (!localStorage.getItem('world-landscape-review-v1')) localStorage.setItem('world-landscape-review-v1', JSON.stringify(state));
      localStorage.setItem('world-basic-economy-v1', 'formal-save-not-touched');
    }, state);
    const errors = await openGame(page, '/?landscape=preview');
    expect((await snapshot(page)).objects.filter(o => o.kind === 'tree').length).toBeGreaterThan(70);
    expect((await snapshot(page)).objects.filter(o => o.kind === 'rock').length).toBeGreaterThan(20);
    const click = async (selector: string) => touch ? page.locator(selector).tap() : page.locator(selector).click();
    await click('#building-toggle'); await click('#build-farm');
    await clickGround(page, gridPoint(51.5, 55.5), touch);
    await expect.poll(async () => (await snapshot(page)).economy.plots.length).toBe(13);
    await expect.poll(async () => (await snapshot(page)).economy.plots[12].tilled, { timeout: 60000 }).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('world-basic-economy-v1'))).toBe('formal-save-not-touched');
    await page.screenshot({ path: info.outputPath('landscape-farm.png'), scale: 'css' });

    await openGame(page, '/?landscape=preview&view=shore');
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
