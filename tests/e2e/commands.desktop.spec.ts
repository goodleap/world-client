import { test, expect } from '@playwright/test';
import { clickGround, openGame, selectUnit, snapshot } from './helpers.ts';

test('farmer direct work retains selection, yields to movement, and resumes the same partial job', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  await selectUnit(page, 'farmer');
  const plot = (await snapshot(page)).objects.find(o => o.id === 'plot-0')!;
  await page.mouse.click(plot.screen.x, plot.screen.y);
  expect((await snapshot(page)).selection.resident).toBe('farmer');
  expect((await snapshot(page)).economy.tasks).toHaveLength(1);
  await page.waitForFunction(() => window.__DEMO__!.snapshot().economy.tasks.some(t => t.status === 'working' && t.progress > 0), undefined, { timeout: 45000 });
  // Send a real map click before this short job completes; no simulation hooks.
  await clickGround(page, { x: -1.2, z: -2 });
  const interrupted = await snapshot(page), task = interrupted.economy.tasks[0];
  expect(task.status).toBe('waiting'); expect(task.progress).toBeGreaterThan(0); expect(task.progress).toBeLessThan(3);
  expect(interrupted.residents.find(r => r.id === 'farmer')!.moveCommand).toBe(true);
  await expect.poll(async () => (await snapshot(page)).farmerRunning).toBe(true);
  expect((await snapshot(page)).economy.tasks[0].progress).toBe(task.progress);
  await page.screenshot({ path: info.outputPath('farmer-command-run.png') });
  await expect.poll(async () => (await snapshot(page)).economy.inventory.food, { timeout: 90000 }).toBe(8);
  expect((await snapshot(page)).economy.tasks).toHaveLength(1);
  expect((await snapshot(page)).selection.resident).toBe('farmer');
  const empty = (await snapshot(page)).objects.find(o => o.id === 'plot-2')!;
  await page.mouse.click(empty.screen.x, empty.screen.y);
  await expect(page.getByRole('button', { name: '种胡萝卜', exact: true })).toBeVisible();
  expect((await snapshot(page)).economy.tasks).toHaveLength(1);
  await page.getByRole('button', { name: '种小麦', exact: true }).click();
  expect((await snapshot(page)).economy.tasks[1].crop).toBe('wheat');
  await expect.poll(async () => (await snapshot(page)).economy.plots.find(p => p.id === 'plot-2')!.crop, { timeout: 45000 }).toBe('wheat');
  expect(errors).toEqual([]);
});

test('the selected dog follows the latest move and later returns to autonomous wandering', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = await openGame(page);
  await selectUnit(page, 'dog');
  await clickGround(page, { x: -.4, z: -6.5 });
  await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === 'dog')!.moveCommand).toBe(true);
  await clickGround(page, { x: .5, z: -4.5 });
  await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === 'dog')!.moveCommand, { timeout: 90000 }).toBe(false);
  const arrived = (await snapshot(page)).residents.find(r => r.id === 'dog')!;
  expect(Math.hypot(arrived.position.x - .5, arrived.position.z + 4.5)).toBeLessThan(.13);
  await page.screenshot({ path: info.outputPath('dog-command.png') });
  // The existing three simulation-second arrival pause takes at least 60
  // rendered frames under the navigation delta cap on cloud software WebGL.
  await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === 'dog')!.travelled, { timeout: 180000 }).toBeGreaterThan(arrived.travelled + .2);
  expect((await snapshot(page)).selection.resident).toBe('dog');
  expect(errors).toEqual([]);
});
