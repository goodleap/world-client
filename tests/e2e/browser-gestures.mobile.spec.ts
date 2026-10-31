import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { openGame, snapshot } from './helpers.ts';

test.use({ viewport: { width: 393, height: 600 }, isMobile: true, hasTouch: true });

test('rapid panel taps and page pinches never zoom the viewport; scrolling and diagnostic copying still work', async ({ page }, info) => {
  test.setTimeout(120_000);
  const state = initialEconomy(); state.steward.enabled = false;
  await page.addInitScript(state => {
    localStorage.setItem('world-basic-economy-v1', JSON.stringify(state));
    // Exercise the fallback used by embedded browsers without clipboard access.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Use fallback'); } } });
    document.addEventListener('copy', () => {
      const field = document.activeElement;
      if (field instanceof HTMLTextAreaElement) document.documentElement.dataset.copied = field.value.slice(field.selectionStart, field.selectionEnd);
    });
  }, state);
  const errors = await openGame(page);
  const viewport = () => page.evaluate(() => ({ scale: visualViewport!.scale, width: innerWidth, x: scrollX, y: scrollY }));
  const before = await viewport(), camera = (await snapshot(page)).camera;
  for (const id of ['home-resources', 'settings', 'building-toggle', 'queue-toggle', 'help']) {
    const box = (await page.locator(`#${id}`).boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    expect(await viewport()).toEqual(before);
    // Modal backdrop taps may legitimately dismiss a just-opened panel.
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => (d as HTMLDialogElement).close()));
  }
  expect((await snapshot(page)).camera.zoom).toBe(camera.zoom);
  await page.locator('#help').tap();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 300, id: 1 }, { x: 240, y: 300, id: 2 }] });
  for (let step = 1; step <= 10; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 140 - step * 4, y: 300, id: 1 }, { x: 240 + step * 4, y: 300, id: 2 }] });
    await page.waitForTimeout(20); // Real touch cadence lets the browser recognize the gesture.
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await viewport()).toEqual(before);
  const help = page.locator('#help-dialog');
  expect(await help.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 450, id: 1 }] });
  for (let step = 1; step <= 10; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y: 450 - step * 20, id: 1 }] });
    await page.waitForTimeout(20);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => help.evaluate(e => e.scrollTop)).toBeGreaterThan(20);
  expect(await viewport()).toEqual(before);
  await page.screenshot({ path: info.outputPath('scrollable-help-without-page-zoom.png'), scale: 'css' });

  const defaults = await help.evaluate(element => Object.fromEntries(['dblclick', 'contextmenu', 'dragstart', 'selectstart', 'gesturestart', 'gesturechange'].map(type => {
    const event = new Event(type, { bubbles: true, cancelable: true }); element.dispatchEvent(event);
    return [type, event.defaultPrevented];
  })));
  expect(Object.values(defaults).every(Boolean)).toBe(true);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  await help.evaluate(e => (e as HTMLDialogElement).close());
  await page.locator('#settings').tap();
  await page.locator('#copy-diagnostics').tap();
  await expect(page.locator('#settings-notice')).toContainText('已复制');
  const copied = await page.evaluate(() => JSON.parse(document.documentElement.dataset.copied!));
  expect(copied.viewport.width).toBe(393);
  expect(copied.performance.renderer).toEqual(expect.any(String));
  expect(await viewport()).toEqual(before);
  expect(errors).toEqual([]);
});
