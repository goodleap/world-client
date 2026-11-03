import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { ECONOMY_SAVE_KEY } from '../../src/game/economy-storage.ts';
import { openGame, snapshot, clickGround, selectUnit, panTo } from './helpers.ts';

test('touch fire controls, dog and horse meals, and manual move override', async ({ page }, info) => {
  test.setTimeout(150_000);
  const e = new Economy(); e.setLeadership(false); e.state.inventory.stone = 8;e.state.raids.nextAt=1000;
  const placed = e.placeBuilding('campfire', { x: -10, z: -10 }); expect(placed.ok).toBe(true);
  const t = e.claim()!; e.arrive(t.id); e.advance(8);
  Object.assign(e.state.campfires[0], { wood: 12, food: 12, meals: 3 });
  e.state.residents.dog = { position: { x: -6, z: -6.5 } }; e.state.combat.units.find(u => u.id === 'cavalry')!.position = { x: -3.5, z: -10 };
  for (const id of ['dog', 'horse', 'cavalry']) { e.state.vitals[id].stamina = 10; if (id === 'cavalry') e.state.combat.units.find(u => u.id === id)!.hp = 40; else e.state.vitals[id].hp = 40; }
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: ECONOMY_SAVE_KEY, value: encodeEconomy(e) });
  const errors = await openGame(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 500 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 235, y: 400 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const site = e.state.sites[0]; await clickGround(page, site, true, .3);
  await expect(page.locator('[data-action="fire-toggle"]')).toHaveText('点火');
  await page.screenshot({ path: info.outputPath('fire-mobile-off.png') });
  await page.locator('[data-action="fire-toggle"]').tap();
  await clickGround(page, { x: -3, z: -15 }, true); // close the target card before choosing a moving animal
  await expect(page.locator('#resident-eat, [data-action="eat-here"]')).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).economy.vitals.dog.stamina, { timeout: 40_000 }).toBeGreaterThan(12);

  await expect.poll(async () => (await snapshot(page)).economy.vitals.horse.stamina, { timeout: 40_000 }).toBeGreaterThan(12);
  let s = await snapshot(page); expect(s.combat.units.find(u => u.id === 'cavalry')!.hp).toBeGreaterThan(40); expect(s.economy.vitals.horse.hp).toBeGreaterThan(40);
  // Safe seats can finish meals at different times. Health bars deliberately
  // hide four seconds after the last change; validate their current values.
  await panTo(page, site, true);
  for (const id of ['dog', 'horse', 'cavalry']) {
    const meter=page.locator(`[data-health="${id}"]`);await expect(meter).toHaveCount(1);
    expect(Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(40);
  }
  expect(s.economy.campfires[0].meals).toBeLessThan(3);
  await selectUnit(page, 'cavalry', true); await page.screenshot({ path: info.outputPath('meals-mobile.png') });
  await expect(page.locator('[data-resident="cavalry"]')).toHaveText('骑兵');
  const healthBars = await page.locator('[data-resident="cavalry"] .resident-health').evaluateAll(bars => bars.map(bar => {
    const b = getComputedStyle(bar); return { width: parseFloat(b.width), height: parseFloat(b.height) };
  }));
  expect(healthBars).toEqual([{ width: 52, height: 7 }, { width: 52, height: 7 }]);
  const label = await page.locator('[data-resident="cavalry"]').boundingBox();
  expect(label!.x).toBeGreaterThanOrEqual(0); expect(label!.x + label!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const before=(await snapshot(page)).combat.units.find(r=>r.id==='cavalry')!.position;
  await clickGround(page, { x: -2.7, z: -12.8 }, true);
  // Navigation is accepted asynchronously by the existing worker queue.
  await expect.poll(async()=>{
    const next=await snapshot(page),v=next.economy.vitals.cavalry;
    return !v.rest&&v.manualUntil>next.economy.seconds;
  }).toBe(true);
  await expect.poll(async()=>{
    const p=(await snapshot(page)).combat.units.find(r=>r.id==='cavalry')!.position;
    return Math.hypot(p.x-before.x,p.z-before.z);
  }).toBeGreaterThan(1);
  s = await snapshot(page); expect(s.selection.resident).toBe('cavalry');
  expect(errors).toEqual([]);
});
