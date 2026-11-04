import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';
import { initialEconomy } from '../../src/game/economy.ts';

test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

test('top object actions remain accessible while settings isolate input through nested dialogs', async ({ page }, info) => {
  test.setTimeout(180_000);
  const state = initialEconomy(); state.steward.enabled = false;
  await page.addInitScript(state => localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)), state);
  const errors = await openGame(page);
  const plot = (await snapshot(page)).objects.find(o => o.id === 'plot-0')!;
  await page.touchscreen.tap(plot.screen.x, plot.screen.y);
  const action = page.getByRole('button', { name: '收获', exact: true });
  await expect(action).toBeVisible();
  await expect(page.locator('#selection-card button')).toHaveCount(2);
  expect(await page.locator('#selection-card').evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderWidth, shadow: style.boxShadow };
  })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });
  const hit = await action.boundingBox();
  expect(hit!.width).toBeGreaterThanOrEqual(44); expect(hit!.height).toBeGreaterThanOrEqual(44);
  expect((await snapshot(page)).economy.tasks).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('phone-object-actions.png'), scale: 'css' });

  await page.getByRole('button', { name: '设置', exact: true }).tap();
  const frozen = await snapshot(page);
  await page.waitForTimeout(650);
  const paused = await snapshot(page);
  expect(paused.economy).toEqual(frozen.economy);
  expect(paused.residents).toEqual(frozen.residents);
  expect(paused.camera).toEqual(frozen.camera);
  // The native top layer owns hit testing even above a visible object action.
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('dialog')?.id,
    { x: hit!.x + hit!.width / 2, y: hit!.y + hit!.height / 2 })).toBe('settings-dialog');
  await page.locator('#settings-help').tap();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭操作说明', exact: true }).tap();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  expect((await snapshot(page)).manualPaused).toBe(true);
  await page.screenshot({ path: info.outputPath('phone-settings.png'), scale: 'css' });
  // The backdrop neither resumes nor clicks through to the map.
  await page.touchscreen.tap(5, 847);
  await expect(page.locator('#settings-dialog')).toBeVisible();
  expect((await snapshot(page)).selection.object?.id).toBe('plot-0');
  expect((await snapshot(page)).economy.tasks).toHaveLength(0);
  await page.locator('#continue-game').tap();

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    for (const edge of ['left', 'right', 'top', 'bottom']) document.documentElement.style.setProperty(`--safe-${edge}`, '20px');
  });
  const cardBefore=(await page.locator('#selection-info').boundingBox())!;
  expect(cardBefore.x).toBeGreaterThanOrEqual(20);expect(cardBefore.x+cardBefore.width).toBeLessThanOrEqual(300);
  const camera=(await snapshot(page)).camera;
  const touch=await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:220,y:400}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:90,y:420}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
  await expect.poll(async()=>(await snapshot(page)).camera.target.x).not.toBe(camera.target.x);
  expect(await page.locator('#selection-info').boundingBox()).toEqual(cardBefore);
  await expect(action).toBeInViewport();await action.tap();
  await expect.poll(async()=>(await snapshot(page)).economy.tasks.some(t=>t.kind==='harvest')).toBe(true);
  await page.screenshot({path:info.outputPath('small-phone-top-actions.png'),scale:'css'});
  expect(errors).toEqual([]);
});
