import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { openGame, snapshot } from './helpers.ts';

test('keyboard speed is fixed across zooms; trackpad scroll pans and pinching zooms at the pointer', async ({ page }) => {
  test.setTimeout(150_000);
  const state = initialEconomy(); state.steward.enabled = false;
  await page.addInitScript(state => localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)), state);
  const errors = await openGame(page);
  for (let i = 0; i < 2; i++) {
    const movement = await page.evaluate(() => new Promise<{ distance: number; seconds: number }>(resolve => {
      const canvas = document.getElementById('game')!, before = window.__DEMO__!.snapshot();
      canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
      const check = () => {
        const after = window.__DEMO__!.snapshot();
        if (after.simulationSeconds > before.simulationSeconds) {
          canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true }));
          resolve({ distance: after.camera.x - before.camera.x, seconds: Math.min(.25, after.simulationSeconds - before.simulationSeconds) });
        } else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }));
    expect(movement.distance / movement.seconds).toBeCloseTo(14, 4);
    await page.locator('#game').dispatchEvent('wheel', { deltaY: 120, deltaMode: 0, clientX: 640, clientY: 450 });
  }
  await page.waitForTimeout(200);
  const before = await snapshot(page);
  await page.locator('#game').dispatchEvent('wheel', { deltaX: 32, deltaY: 24, deltaMode: 0, clientX: 640, clientY: 450 });
  const panned = await snapshot(page);
  expect(panned.camera.zoom).toBe(before.camera.zoom);
  expect(panned.camera.x).toBeGreaterThan(before.camera.x);
  expect(panned.camera.z).toBeLessThan(before.camera.z);
  // A large inertial tail within the same gesture must remain panning.
  await page.locator('#game').dispatchEvent('wheel', { deltaY: 120, deltaMode: 0 });
  expect((await snapshot(page)).camera.zoom).toBe(before.camera.zoom);
  await page.locator('#game').dispatchEvent('wheel', { deltaY: -20, ctrlKey: true, clientX: 640, clientY: 450 });
  expect((await snapshot(page)).camera.zoom).toBeCloseTo(before.camera.zoom / Math.exp(.2), 5);
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  const pinch = (await snapshot(page)).camera.zoom;
  await page.evaluate(() => {
    const canvas = document.getElementById('game')!;
    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 1.25], ['gestureend', 1.25]] as const) {
      canvas.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: 640, clientY: 450 }));
    }
  });
  expect((await snapshot(page)).camera.zoom).toBeCloseTo(pinch / 1.25, 5);
  expect(errors).toEqual([]);
});
