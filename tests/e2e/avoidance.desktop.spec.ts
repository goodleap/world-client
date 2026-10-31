import { test, expect } from '@playwright/test';
import { clickGround, openGame, selectUnit, snapshot } from './helpers.ts';

test('a commanded GLB character runs around an idle farmer and keeps its destination', async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors = await openGame(page);
  const farmer = (await snapshot(page)).residents.find(r => r.id === 'farmer')!;
  await selectUnit(page, 'farmer-leader');
  await clickGround(page, { x: farmer.position.x, z: farmer.position.z - 1.4 });
  await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === 'farmer-leader')!.routeRemaining,
    { timeout: 45_000 }).toBe(0);
  const destination = { x: farmer.position.x, z: farmer.position.z + 2.7 };
  await selectUnit(page, 'farmer-leader');
  await clickGround(page, destination);
  await page.waitForFunction(() => window.__DEMO__!.snapshot().residents.find(r => r.id === 'farmer-leader')!.navigation.replans > 0);
  const detouring = (await snapshot(page)).residents.find(r => r.id === 'farmer-leader')!;
  expect(detouring.moveCommand).toBe(true); expect(detouring.motion).toBe('run');
  await page.screenshot({ path: info.outputPath('glb-detour.png') });
  await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === 'farmer-leader')!.routeRemaining,
    { timeout: 70_000 }).toBe(0);
  const arrived = (await snapshot(page)).residents.find(r => r.id === 'farmer-leader')!;
  expect(Math.hypot(arrived.position.x - destination.x, arrived.position.z - destination.z)).toBeLessThan(.04);
  expect(errors).toEqual([]);
});
