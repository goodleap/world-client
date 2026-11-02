import { test, expect } from '@playwright/test';
import { openGame, snapshot, selectUnit, panTo } from './helpers.ts';

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
  await selectUnit(page, 'infantry', true);
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

test('touch commands affect one soldier and dragging keeps the selected soldier', async ({ page }, info) => {
  test.setTimeout(120_000);
  const { Economy, encodeEconomy } = await import('../../src/game/economy.ts');
  const { OUTPOST } = await import('../../src/game/combat-config.ts');
  const { clickGround } = await import('./helpers.ts');
  const e = new Economy(); e.setLeadership(false);
  for (const u of e.state.combat.units) { u.order = 'hold'; u.cooldown = 8; }
  e.state.combat.units.find(u => u.id === 'infantry')!.position = { x: OUTPOST.x + 4, z: OUTPOST.z + 3 };
  e.state.combat.units.find(u => u.id === 'archer')!.position = { x: OUTPOST.x - 4, z: OUTPOST.z + 3 };
  await page.addInitScript(value => localStorage.setItem('world-basic-economy-v1', value), encodeEconomy(e));
  const errors = await openGame(page);
  await expect(page.getByRole('button', { name: '选择小队', exact: true })).toHaveCount(0);
  await expect(page.locator('.combat-controls')).toHaveCount(0);
  await panTo(page, OUTPOST, true);
  await expect.poll(async () => (await snapshot(page)).camera.target.x).toBeLessThan(OUTPOST.x + .5);
  await selectUnit(page, 'infantry', true);
  await clickGround(page, (await snapshot(page)).combat.units.find(u => u.id === 'enemy-guard')!.position, true, 1);
  expect((await snapshot(page)).selection.resident).toBe('infantry');
  expect(['hold', 'guard']).toContain((await snapshot(page)).combat.units.find(u => u.id === 'archer')!.order);
  await expect.poll(async () => (await snapshot(page)).combat.units.find(u => u.id === 'enemy-guard')!.hp).toBeLessThan(65);
  // The brief damage bar can already have faded during software-GPU frames.
  // Its live HP and the selected-unit meter must still reflect received damage.
  const hp = (await snapshot(page)).combat.units.find(u => u.id === 'infantry')!.hp;
  expect(hp).toBeLessThan(140);
  await expect.poll(() => page.evaluate(() => {
    const current = window.__DEMO__!.snapshot().combat.units.find(u => u.id === 'infantry')!.hp;
    return Number(document.querySelector('[data-health="infantry"]')!.getAttribute('aria-valuenow')) - Math.ceil(current);
  })).toBe(0);
  await expect(page.getByRole('region', { name: '当前单位信息' }).getByRole('meter', { name: '生命', exact: true })).toBeVisible();
  await expect(page.locator('[data-resident="infantry"]')).toHaveText('步兵');
  await expect(page.locator('.resident-label small')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('combat-phone.png') });
  const before = (await snapshot(page)).camera.target;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 440 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: 450 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await snapshot(page)).camera.target.x).not.toBe(before.x);
  expect((await snapshot(page)).selection.resident).toBe('infantry');
  await clickGround(page, { x: OUTPOST.x + 5, z: OUTPOST.z + 5 }, true);
  const returned = (await snapshot(page)).combat.units;
  expect(returned.find(u => u.id === 'infantry')).toMatchObject({ order: 'move', target: undefined, attack: undefined });
  expect(['hold', 'guard']).toContain(returned.find(u => u.id === 'archer')!.order);
  expect(errors).toEqual([]);
});
