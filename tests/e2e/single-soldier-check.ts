import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { ECONOMY_SAVE_KEY } from '../../src/game/economy-storage.ts';
import { openGame, snapshot, clickGround, selectUnit } from './helpers.ts';

/** Keep the real home map, actual pointer picking and crowd in this regression.
 * Accepting order=move alone misses a destination lost on the following tick. */
export async function checkSingleSoldierMovement(page: Page, info: TestInfo, touch: boolean) {
  const e = new Economy(); e.setLeadership(false);
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: ECONOMY_SAVE_KEY, value: encodeEconomy(e) });
  const errors = await openGame(page);
  await expect(page.locator('.combat-controls, #scout-outpost, #combat-retreat, #combat-auto')).toHaveCount(0);
  const soldier = async (id: string) => (await snapshot(page)).combat.units.find(u => u.id === id)!;
  const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  const arrive = async (id: string, goal: { x: number; z: number }) => {
    await expect.poll(async () => distance((await soldier(id)).position, goal), { timeout: 40_000 }).toBeLessThan(.2);
    expect((await snapshot(page)).selection.resident).toBe(id);
  };
  await selectUnit(page, 'infantry', touch);
  const start = { ...(await soldier('infantry')).position };
  await clickGround(page, { x: -.7, z: -2 }, touch);
  const first = await soldier('infantry');
  expect(first.goal).toEqual({ x: expect.any(Number), z: expect.any(Number) });
  await expect.poll(async () => distance((await soldier('infantry')).position, start)).toBeGreaterThan(.5);
  await arrive('infantry', first.goal!);

  // A second click keeps selection; save while travelling and resume the route.
  await clickGround(page, { x: -.4, z: -11 }, touch);
  const second = await soldier('infantry'); expect(second.order).toBe('move');
  expect((await snapshot(page)).selection.resident).toBe('infantry');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  expect((await soldier('infantry')).order).toBe('move');
  await page.getByRole('button', { name: '回到主菜单', exact: true }).click();
  await page.reload(); await expect(page.locator('#continue-save')).toBeEnabled();
  await page.locator('#continue-save').click();
  await expect(page.locator('#loading')).toHaveClass(/loaded/, { timeout: 60_000 });
  await expect.poll(async () => distance((await soldier('infantry')).position, second.goal!), { timeout: 40_000 }).toBeLessThan(.2);
  await selectUnit(page, 'infantry', touch);
  await page.screenshot({ path: info.outputPath('infantry-arrived-after-reload.png') });

  await selectUnit(page, 'archer', touch);
  const archerStart = { ...(await soldier('archer')).position };
  await clickGround(page, { x: -3, z: -11 }, touch);
  const archer = await soldier('archer'); expect(archer.order).toBe('move');
  await expect.poll(async () => distance((await soldier('archer')).position, archerStart)).toBeGreaterThan(.5);
  await arrive('archer', archer.goal!);
  await page.screenshot({ path: info.outputPath('archer-arrived.png') });
  expect(errors).toEqual([]);
}
