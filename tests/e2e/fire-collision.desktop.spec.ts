import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { CAMPFIRE_SHAPE } from '../../src/game/campfire-shape.ts';
import { ECONOMY_SAVE_KEY } from '../../src/game/economy-storage.ts';
import { openGame, snapshot, selectUnit, clickGround, panTo } from './helpers.ts';

test('mounted pointer movement reaches empty fire corners and goes around the stone circle', async ({ page }, info) => {
  test.setTimeout(150_000);
  const e = new Economy(); e.setLeadership(false); e.state.inventory.stone = 8;
  expect(e.placeBuilding('campfire', { x: -10, z: -10 }).ok).toBe(true);
  const t = e.claim()!; e.arrive(t.id); e.advance(8); const site = e.state.sites[0];
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: ECONOMY_SAVE_KEY, value: encodeEconomy(e) });
  const errors = await openGame(page); await panTo(page, site);
  await clickGround(page, site, false, .3);
  await expect(page.locator('[data-action="eat-here"]')).toHaveCount(0);
  expect((await snapshot(page)).selectionFeedback.area).toBe(false);
  await selectUnit(page, 'cavalry'); await expect(page.locator('#resident-eat')).toHaveCount(0);
  for (const [x, z] of [[1.85, 1.85], [-1.85, -1.85]]) {
    const goal = { x: site.x + x, z: site.z + z };
    await clickGround(page, goal);
    expect((await snapshot(page)).selection.resident).toBe('cavalry');
    await expect.poll(async () => {
      const rider = (await snapshot(page)).combat.units.find(u => u.id === 'cavalry')!;
      expect(Math.hypot(rider.position.x - site.x, rider.position.z - site.z)).toBeGreaterThanOrEqual(CAMPFIRE_SHAPE.radius + 1.12 - .01);
      return Math.hypot(rider.position.x - goal.x, rider.position.z - goal.z);
    }, { timeout: 40_000 }).toBeLessThan(.2);
  }
  await page.screenshot({ path: info.outputPath('fire-circular-collision.png') });
  expect(errors).toEqual([]);
});
