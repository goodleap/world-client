import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('background lifecycle freezes simulation and poses, clears input, and preserves manual pause', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  // Exercise the actual browser event handlers deterministically. Chromium's
  // headless focus/background flags do not reliably hide tabs in CI.
  for (const reason of ['visibility', 'blur', 'pagehide'] as const) {
    await page.keyboard.down('KeyD');
    await page.mouse.move(600, 500); await page.mouse.down();
    await page.mouse.move(630, 500);
    await page.evaluate(reason => {
      if (reason === 'visibility') {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      } else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      else window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    }, reason);
    const frozen = await snapshot(page);
    expect(frozen.suspended).toBe(true);
    expect(frozen.input.dragging).toBe(false);
    await page.waitForTimeout(1100);
    const later = await snapshot(page);
    expect(later.frames).toBe(frozen.frames);
    expect(later.simulationSeconds).toBe(frozen.simulationSeconds);
    expect(later.residents).toEqual(frozen.residents);
    expect(later.baseModel.pose).toEqual(frozen.baseModel.pose);
    expect(later.farmerLegPose).toEqual(frozen.farmerLegPose);

    const first = await page.evaluate(reason => new Promise<ReturnType<NonNullable<Window['__DEMO__']>['snapshot']>>(resolve => {
      const frames = window.__DEMO__!.snapshot().frames;
      if (reason === 'visibility') {
        Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange'));
      } else if (reason === 'blur') window.dispatchEvent(new Event('focus'));
      else window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      const check = () => {
        const state = window.__DEMO__!.snapshot();
        if (state.frames > frames) resolve(state); else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }), reason);
    expect(first.suspended).toBe(false);
    expect(first.simulationSeconds).toBe(frozen.simulationSeconds);
    expect(first.residents.map(r => r.position)).toEqual(frozen.residents.map(r => r.position));
    expect(first.baseModel.pose).toEqual(frozen.baseModel.pose);
    expect(first.farmerLegPose).toEqual(frozen.farmerLegPose);
    // The physical key/pointer were never released while away. They must not
    // keep panning or turn the eventual pointer-up into a tap/command.
    await page.mouse.up(); await page.keyboard.up('KeyD');
    await expect.poll(async () => (await snapshot(page)).simulationSeconds).toBeGreaterThan(frozen.simulationSeconds);
    expect((await snapshot(page)).camera.x).toBe(frozen.camera.x);
    expect((await snapshot(page)).selection.resident).toBeUndefined();
  }
  await page.locator('#settings').click();
  await expect.poll(async () => (await snapshot(page)).manualPaused).toBe(true);
  await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
  const panel = await snapshot(page);
  await page.waitForTimeout(400);
  expect((await snapshot(page)).frames).toBe(panel.frames);
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(panel.frames);
  await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
  expect((await snapshot(page)).simulationSeconds).toBe(panel.simulationSeconds);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const paused = await snapshot(page);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(paused.frames);
  await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
  expect((await snapshot(page)).manualPaused).toBe(true);
  expect((await snapshot(page)).simulationSeconds).toBe(paused.simulationSeconds);
  await page.locator('#continue-game').click();
  await expect.poll(async () => (await snapshot(page)).simulationSeconds).toBeGreaterThan(paused.simulationSeconds);
  expect(errors).toEqual([]);
});
