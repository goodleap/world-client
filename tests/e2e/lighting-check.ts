import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { DEFAULT_LIGHTING } from '../../src/game/graphics-settings.ts';
import { openGame, snapshot } from './helpers.ts';

export function checkLighting() {
  test('graphics sidebar previews without blur, preserves pause through navigation, persists and resets', async ({ page }, info) => {
    test.setTimeout(180_000);
    const state = initialEconomy(); state.steward.enabled = false;
    await page.addInitScript(state => {
      if (!localStorage.getItem('world-basic-economy-v1')) localStorage.setItem('world-basic-economy-v1', JSON.stringify(state));
    }, state);
    const errors = await openGame(page);
    const touch = info.project.name.startsWith('mobile');
    const press = async (selector: string) => touch ? page.locator(selector).tap() : page.locator(selector).click();
    const idle = async () => expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
    const openGraphics = async () => {
      await press('#settings-graphics');
      await expect(page.locator('#graphics-dialog')).toBeVisible();
      await expect(page.locator('#settings-dialog')).toBeHidden();
      expect(await page.locator('dialog[open]').evaluateAll(nodes => nodes.map(n => n.id))).toEqual(['graphics-dialog']);
      expect(await page.locator('#graphics-dialog').evaluate(el => {
        const s = getComputedStyle(el, '::backdrop'); return [s.backdropFilter, s.backgroundColor];
      })).toEqual(['none', 'rgba(0, 0, 0, 0)']);
      await idle();
    };
    await press('#settings');
    await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(page.locator('#settings-dialog input')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const a = getComputedStyle(document.getElementById('settings-dialog')!, '::backdrop');
      const b = getComputedStyle(document.getElementById('resources-dialog')!, '::backdrop');
      return a.backdropFilter === 'blur(5px)' && a.backdropFilter === b.backdropFilter && a.backgroundColor === b.backgroundColor;
    })).toBe(true);
    await page.screenshot({ path: info.outputPath('settings-blurred.png'), scale: 'css' });
    const paused = await snapshot(page);
    await openGraphics();
    expect((await snapshot(page)).simulationSeconds).toBe(paused.simulationSeconds);
    await page.screenshot({ path: info.outputPath('graphics-default.png'), scale: 'css' });
    const frame = (await snapshot(page)).frames;
    await page.locator('#environment-light').fill('0.2');
    await page.locator('#sunlight').fill('1.2');
    await page.locator('#sun-color').fill('#ffc080');
    await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(frame);
    await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
    expect((await snapshot(page)).lighting).toEqual({ environment: .2, sunlight: 1.2, sunColor: '#ffc080' });
    expect((await snapshot(page)).simulationSeconds).toBe(paused.simulationSeconds);
    expect((await snapshot(page)).residents).toEqual(paused.residents);
    await page.screenshot({ path: info.outputPath('lighting-adjusted.png'), scale: 'css' });
    // The transparent native backdrop still owns input and does not resume or
    // dismiss the preview when the user touches the visible world.
    if (touch) await page.touchscreen.tap(30, page.viewportSize()!.height / 2);
    else await page.mouse.click(30, page.viewportSize()!.height / 2);
    await expect(page.locator('#graphics-dialog')).toBeVisible();
    expect((await snapshot(page)).economy).toEqual(paused.economy);
    if (touch) for (const size of [{ width: 393, height: 852 }, { width: 320, height: 568 }, { width: 820, height: 400 }]) {
      await page.setViewportSize(size); await idle();
      const box = (await page.locator('#graphics-dialog').boundingBox())!;
      expect(box.x).toBeGreaterThan(size.width * .3);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width - 11);
      expect(box.y).toBeGreaterThanOrEqual(11);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height - 11);
      await page.locator('#reset-lighting').scrollIntoViewIfNeeded();
      await expect(page.locator('#reset-lighting')).toBeInViewport();
      await page.locator('#graphics-back').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`graphics-${size.width}.png`), scale: 'css' });
    }
    await page.keyboard.press('Escape'); await idle();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(page.locator('#graphics-dialog')).toBeHidden();
    expect((await snapshot(page)).simulationSeconds).toBe(paused.simulationSeconds);
    await openGraphics();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect((await snapshot(page)).suspended).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await idle();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(page.locator('#graphics-dialog')).toBeHidden();
    expect((await snapshot(page)).simulationSeconds).toBe(paused.simulationSeconds);
    expect((await snapshot(page)).combat).toEqual(paused.combat);
    const returned = await snapshot(page);
    // Backgrounding saves the current transforms into the previously cached
    // save data. Compare live residents and the remaining economy separately.
    expect(returned.residents).toEqual(paused.residents);
    const { residents: _savedBefore, ...economyBefore } = paused.economy;
    const { residents: _savedAfter, ...economyAfter } = returned.economy;
    expect(economyAfter).toEqual(economyBefore);
    await press('#return-menu');
    await openGame(page);
    expect((await snapshot(page)).lighting).toEqual({ environment: .2, sunlight: 1.2, sunColor: '#ffc080' });
    await press('#settings'); await openGraphics();
    await press('#reset-lighting');
    await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
    expect((await snapshot(page)).lighting).toEqual(DEFAULT_LIGHTING);
    await expect(page.locator('#environment-light-value')).toHaveText('0.72');
    await expect(page.locator('#sunlight-value')).toHaveText('0.56');
    await page.screenshot({ path: info.outputPath('lighting-default.png'), scale: 'css' });
    const frozen = await snapshot(page);
    await page.waitForTimeout(350);
    expect((await snapshot(page)).frames).toBe(frozen.frames);
    await press('#graphics-back');
    await expect(page.locator('#settings-dialog')).toBeVisible();
    expect((await snapshot(page)).simulationSeconds).toBe(frozen.simulationSeconds);
    await press('#continue-game');
    await expect.poll(async () => (await snapshot(page)).simulationSeconds).toBeGreaterThan(frozen.simulationSeconds);
    expect(errors).toEqual([]);
  });
}
