import { test, expect } from '@playwright/test';
import { openGame, snapshot, selectUnit } from './helpers.ts';

test('leadership speech clears, labels avoid bubbles and pause stays centered on mobile and short screens', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = await openGame(page);
  await expect(page.locator('[data-speaker="farmer-leader"]')).toBeVisible();
  const bubble = await page.locator('[data-speaker="farmer-leader"]').boundingBox();
  const name = await page.locator('[data-resident="farmer-leader"]').boundingBox();
  expect(bubble!.y + bubble!.height + 6 <= name!.y || bubble!.y >= name!.y + name!.height + 6).toBe(true);
  await page.screenshot({ path: info.outputPath('speech-phone.png') });
  await selectUnit(page, 'farmer-leader', true);
  await page.getByRole('switch', { name: '开启领头指挥' }).uncheck();
  await expect(page.locator('[data-speaker="farmer-leader"]')).toBeHidden();
  const accepted = (await snapshot(page)).economy.tasks.filter(t => t.worker);
  expect(accepted.length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-speaker="farmer-leader"]')).toBeHidden();
  await page.getByRole('button', { name: '选择小队', exact: true }).tap();
  expect((await snapshot(page)).squad).toBe(true);
  await page.getByRole('button', { name: '设置', exact: true }).tap();
  for (const viewport of [{ width: 393, height: 852 }, { width: 320, height: 568 }, { width: 820, height: 400 }]) {
    await page.setViewportSize(viewport);
    const box = await page.locator('#settings-dialog').boundingBox();
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(2);
    expect(box!.height).toBeLessThanOrEqual(viewport.height - 24);
    await page.screenshot({ path: info.outputPath(`settings-${viewport.width}.png`) });
  }
  await page.getByRole('button', { name: '继续游戏', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '继续游戏', exact: true }).tap();
  expect((await snapshot(page)).manualPaused).toBe(false);
  expect(errors).toEqual([]);
});

test('touch squad attacks retain selection and dragging pans without issuing orders', async ({ page }, info) => {
  test.setTimeout(120_000);
  const { Economy, encodeEconomy } = await import('../../src/game/economy.ts');
  const { OUTPOST } = await import('../../src/game/combat-config.ts');
  const { clickGround } = await import('./helpers.ts');
  const e = new Economy(); e.setLeadership(false);
  for (const u of e.state.combat.units) u.order = 'hold';
  e.state.combat.units.find(u => u.id === 'infantry')!.position = { x: OUTPOST.x + 1, z: OUTPOST.z + 3 };
  e.state.combat.units.find(u => u.id === 'archer')!.position = { x: OUTPOST.x - 1, z: OUTPOST.z + 3 };
  await page.addInitScript(value => localStorage.setItem('world-basic-economy-v1', value), encodeEconomy(e));
  const errors = await openGame(page);
  await page.getByRole('button', { name: '选择小队', exact: true }).tap();
  await page.getByRole('button', { name: '西南据点', exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).camera.target.x).toBeLessThan(OUTPOST.x + .5);
  await clickGround(page, (await snapshot(page)).combat.units.find(u => u.id === 'enemy-guard')!.position, true, 1);
  expect((await snapshot(page)).selection.resident).toBe('infantry');
  await expect.poll(async () => (await snapshot(page)).combat.units.find(u => u.id === 'enemy-guard')!.hp).toBeLessThan(65);
  await page.screenshot({ path: info.outputPath('combat-phone.png') });
  const before = (await snapshot(page)).camera.target;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 440 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: 450 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await snapshot(page)).camera.target.x).not.toBe(before.x);
  expect((await snapshot(page)).squad).toBe(true);
  await page.getByRole('button', { name: '撤退回家', exact: true }).tap();
  const returned = (await snapshot(page)).combat.units.filter(u => u.team === 'home');
  expect(returned.some(u => u.life === 'active')).toBe(true);
  expect(returned.every(u => u.life === 'active' ? u.order === 'retreat' && !u.attack && !u.target : ['returning', 'recovering'].includes(u.life))).toBe(true);
  expect(errors).toEqual([]);
});
