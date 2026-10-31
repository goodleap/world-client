import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { openGame, snapshot } from './helpers.ts';

test.use({ viewport: { width: 393, height: 754 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

test('pinching magnifies by the finger-distance ratio and keeps the ground anchored without release drift', async ({ page }) => {
  test.setTimeout(120_000);
  const economy = initialEconomy(); economy.steward.enabled = false;
  await page.addInitScript(state => localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)), economy);
  const errors = await openGame(page), touch = await page.context().newCDPSession(page);
  const start = { x: 190, y: 530 }, end = { x: 211, y: 502 };
  const samples = [];
  // Each pair starts at a different view scale and finger separation. The
  // same 60% finger expansion must always enlarge the world by exactly 60%.
  for (const [from, to, steps] of [[100, 160, 1], [200, 125, 12], [125, 200, 12], [160, 100, 1]]) {
    const before = await snapshot(page), center = from < to ? end : start, previousCenter = from < to ? start : end;
    const plot = before.objects.find(o => o.id === 'plot-0')!.screen;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
      { x: previousCenter.x - from / 2, y: previousCenter.y, id: 1 }, { x: previousCenter.x + from / 2, y: previousCenter.y, id: 2 },
    ] });
    for (let step = 1; step <= steps; step++) {
      const t = step / steps, span = from + (to - from) * t;
      const x = previousCenter.x + (center.x - previousCenter.x) * t, y = previousCenter.y + (center.y - previousCenter.y) * t;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - span / 2, y, id: 1 }, { x: x + span / 2, y, id: 2 }] });
      // Chromium can dispatch the two pointermoves on separate frames. Wait
      // until both fingers arrive; touch coordinates also use float precision.
      await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeCloseTo(before.camera.zoom * from / span, 4);
    }
    const held = (await snapshot(page)).camera;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const frames = (await snapshot(page)).frames;
    await page.waitForFunction(frames => window.__DEMO__!.snapshot().frames > frames, frames);
    const after = await snapshot(page), projected = after.objects.find(o => o.id === 'plot-0')!.screen;
    expect(after.camera).toEqual(held);
    expect(Math.abs(projected.x - (center.x + (plot.x - previousCenter.x) * to / from))).toBeLessThan(.5);
    expect(Math.abs(projected.y - (center.y + (plot.y - previousCenter.y) * to / from))).toBeLessThan(.5);
    expect(after.selection.object).toBeUndefined();
    expect(after.selection.resident).toBeUndefined();
    samples.push({ from, to, before: before.camera.zoom, after: after.camera.zoom });
  }
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  expect(errors).toEqual([]);
  await test.info().attach('pinch-scales', { body: JSON.stringify(samples), contentType: 'application/json' });
});
