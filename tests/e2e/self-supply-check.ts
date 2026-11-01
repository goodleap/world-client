import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { Economy, encodeEconomy } from '../../src/game/economy.ts';
import { ECONOMY_SAVE_KEY } from '../../src/game/economy-storage.ts';
import { openGame, snapshot, selectUnit, panTo } from './helpers.ts';

export async function checkSelfSupply(page: Page, info: TestInfo, id: 'infantry' | 'cavalry', touch: boolean) {
  const e = new Economy(); e.setLeadership(false); e.state.inventory = { wood: 24, food: 16, stone: 8, iron: 0 };
  expect(e.placeBuilding('campfire', { x: -10, z: -10 }).ok).toBe(true);
  const t = e.claim()!; e.arrive(t.id); e.advance(8); const fire = e.state.campfires[0]; e.setFire(fire.id, true);
  e.state.vitals[id].stamina = 10;
  if (id === 'cavalry') e.state.vitals.horse.stamina = 10;
  // Farmers are obeying long manual walks, so the hungry soldier must supply himself.
  for (const farmer of ['farmer', 'farmer-2', 'farmer-leader']) {
    e.state.residents[farmer] = { position: { x: -15, z: -20 - 2 * ['farmer', 'farmer-2', 'farmer-leader'].indexOf(farmer) }, manualGoal: { x: -65, z: -65 } };
  }
  await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: ECONOMY_SAVE_KEY, value: encodeEconomy(e) });
  const errors = await openGame(page);
  await expect(page.locator('.combat-controls')).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).economy.goods.some(g => g.carrier === id && g.destination === fire.id), { timeout: 60_000 }).toBe(true);
  // Inspect the moving delivery without chasing a mounted tap target on software WebGL.
  if (!touch) await selectUnit(page, id, touch);
  await page.screenshot({ path: info.outputPath(`${id}-carrying.png`) });
  await page.locator('#settings').click();
  const frozen = await snapshot(page); await page.waitForTimeout(400);
  expect((await snapshot(page)).economy).toEqual(frozen.economy);
  expect(frozen.economy.inventory.wood).toBe(18);
  expect(frozen.doors.find(d => d.id === 'warehouse')!.uses).toBeGreaterThan(0);
  await page.getByRole('button', { name: '回到主菜单', exact: true }).click();
  await page.reload(); await expect(page.locator('#continue-save')).toBeEnabled(); await page.locator('#continue-save').click();
  await expect(page.locator('#loading')).toHaveClass(/loaded/, { timeout: 60_000 });
  await expect.poll(async () => {
    const v = (await snapshot(page)).economy.vitals;
    return id === 'cavalry' ? Math.min(v[id].stamina, v.horse.stamina) : v[id].stamina;
  }, { timeout: 100_000 }).toBeGreaterThan(20);
  const fed = await snapshot(page);
  expect(fed.economy.inventory.wood).toBe(18);
  expect(fed.economy.inventory.food).toBeLessThan(16);
  expect(fed.economy.tasks.some(t => t.kind === 'supply' && t.worker === id && t.status === 'done')).toBe(true);
  if (id === 'cavalry') expect(fed.economy.vitals.horse.stamina).toBeGreaterThan(20);
  await panTo(page, e.state.sites[0], touch); await selectUnit(page, id, touch);
  await page.screenshot({ path: info.outputPath(`${id}-self-fed.png`) });
  expect(errors).toEqual([]);
}
