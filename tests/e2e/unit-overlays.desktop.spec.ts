import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { RESIDENTS } from '../../src/game/resident-data.ts';
import { openGame, snapshot, selectUnit, clickGround, panTo } from './helpers.ts';

test('names stay compact, healing feedback uses the game clock, and labels follow all four screen edges', async ({ page }, info) => {
  test.setTimeout(180_000);
  const e = new Economy(); e.setLeadership(false); e.state.inventory.stone = 8;
  expect(e.placeBuilding('campfire', { x: -10, z: -10 }).ok).toBe(true);
  const task = e.claim()!; e.arrive(task.id); e.advance(8);
  Object.assign(e.state.campfires[0], { wood: 12, food: 12, meals: 3 });
  e.state.residents.farmer = { position: { x: -7, z: -10 } };
  e.state.vitals.farmer.hp = 96;
  for (const u of e.state.combat.units) u.order = 'hold';
  await page.addInitScript(value => localStorage.setItem('world-basic-economy-v1', value), encodeEconomy(e));
  const errors = await openGame(page);
  await panTo(page, { x: -8, z: -10 });
  await selectUnit(page, 'farmer');
  const label = page.locator('[data-resident="farmer"]'), bar = page.locator('[data-health="farmer"]');
  await expect(label).toHaveText('农民');
  await expect(bar).toBeHidden(); // Restoring injured health or selecting does not count as a change.
  const originalWidth = (await label.boundingBox())!.width;
  await page.keyboard.press('Escape');
  await clickGround(page, e.state.sites[0], false, .3);
  await page.locator('[data-action="fire-toggle"]').click();
  await expect(bar).toBeVisible({ timeout: 45_000 });
  await selectUnit(page, 'farmer');
  await expect(label).toHaveText('农民');
  const nameBox = (await label.boundingBox())!, barBox = (await bar.boundingBox())!;
  expect(nameBox.width).toBe(originalWidth);
  expect(barBox.width).toBe(52); expect(barBox.height).toBe(7);
  expect(Math.abs(barBox.x + 26 - nameBox.x - nameBox.width / 2)).toBeLessThan(1);
  expect(nameBox.y - barBox.y - barBox.height).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: info.outputPath('farmer-healing-desktop.png') });
  await page.locator('#settings').click();
  const frozen = await bar.evaluate(b => ({ hidden: (b as HTMLElement).hidden, hp: b.getAttribute('aria-valuenow'), fill: b.firstElementChild!.getAttribute('style') }));
  const clock = (await snapshot(page)).economy.seconds;
  await page.waitForTimeout(4200);
  expect((await snapshot(page)).economy.seconds).toBe(clock);
  expect(await bar.evaluate(b => ({ hidden: (b as HTMLElement).hidden, hp: b.getAttribute('aria-valuenow'), fill: b.firstElementChild!.getAttribute('style') }))).toEqual(frozen);
  await page.locator('#continue-game').click();
  await expect.poll(async () => (await snapshot(page)).economy.vitals.farmer.hp).toBe(100);
  await expect(bar).toBeHidden({ timeout: 40_000 });
  await expect(label).toHaveText('农民');

  const soldier = (await snapshot(page)).residents.find(r => r.id === 'infantry')!;
  await panTo(page, soldier.position); await selectUnit(page, 'infantry');
  const unitLabel = page.locator('[data-resident="infantry"]');
  const viewport = page.viewportSize()!, height = RESIDENTS.find(r => r.id === 'infantry')!.labelHeight;
  const anchor = async () => {
    const s = await snapshot(page), r = s.residents.find(r => r.id === 'infantry')!, c = s.camera;
    const scale = viewport.height / (2 * c.zoom);
    return { x: viewport.width / 2 + (r.position.x - c.target.x) * scale,
      y: viewport.height / 2 + ((c.target.y - height) * Math.sin(c.beta) - (r.position.z - c.target.z) * Math.cos(c.beta)) * scale };
  };
  for (const [edge, x, y] of [['left', 16, 450], ['right', 1264, 450], ['top', 640, 16], ['bottom', 640, 884]] as const) {
    const s = await snapshot(page), a = await anchor(), scale = viewport.height / (2 * s.camera.zoom);
    await panTo(page, { x: s.camera.target.x + (a.x - x) / scale,
      z: s.camera.target.z + (y - a.y) / (Math.cos(s.camera.beta) * scale) });
    await expect(unitLabel).toBeVisible();
    await expect.poll(async () => {
      const box = await unitLabel.boundingBox(), a = await anchor();
      return !!box && Math.abs(box.x + box.width / 2 - a.x) < 1 && Math.abs(box.y + box.height - a.y) < 1;
    }).toBe(true);
    await page.screenshot({ path: info.outputPath(`label-${edge}.png`) });
  }
  const c = (await snapshot(page)).camera;
  await panTo(page, { x: c.target.x, z: c.target.z + 3 });
  await expect(unitLabel).toBeHidden();
  expect((await snapshot(page)).selection.resident).toBe('infantry');
  expect(errors).toEqual([]);
});
