import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { clickGround, openGame, selectUnit, snapshot } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  const state = initialEconomy(); state.steward.enabled = false;
  await page.addInitScript(state => localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)), state);
});

test('farmer direct work clears selection, yields to movement, and resumes the same partial job', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  await selectUnit(page, 'farmer');
  const plot = (await snapshot(page)).objects.find(o => o.id === 'plot-0')!;
  await page.mouse.click(plot.screen.x, plot.screen.y);
  expect((await snapshot(page)).selection.resident).toBeUndefined();
  expect((await snapshot(page)).economy.tasks).toHaveLength(1);
  // Software WebGL can render less than one frame per job second. Freeze at an
  // observed working frame through the real settings control, then resume and
  // send a map click; partial progress/settlement also has deterministic tests.
  await page.waitForFunction(() => {
    if (!window.__DEMO__!.snapshot().economy.tasks.some(t => t.status === 'working')) return false;
    document.getElementById('settings')!.click(); return true;
  }, undefined, { timeout: 45000 });
  const progress = (await snapshot(page)).economy.tasks[0].progress;
  await page.getByRole('button', { name: '继续游戏', exact: true }).click();
  // Hide the plot's nearby action button before selecting its working farmer.
  await page.keyboard.press('Escape');
  await selectUnit(page, 'farmer');
  // The expanded woodland places a foreground canopy over the old screen ray.
  // Use the open road so this tests movement, not a valid tree-work command.
  await clickGround(page, { x: -1.2, z: -11 });
  const interrupted = await snapshot(page), task = interrupted.economy.tasks[0];
  expect(task.status).toBe('waiting'); expect(task.progress).toBeGreaterThanOrEqual(progress); expect(task.progress).toBeLessThan(3);
  expect(interrupted.residents.find(r => r.id === 'farmer')!.moveCommand).toBe(true);
  expect(interrupted.selection.resident).toBe('farmer');
  await expect.poll(async () => (await snapshot(page)).farmerRunning).toBe(true);
  expect((await snapshot(page)).economy.tasks[0].progress).toBe(task.progress);
  await page.keyboard.press('Escape');
  expect((await snapshot(page)).selection.resident).toBeUndefined();
  expect((await snapshot(page)).residents.find(r => r.id === 'farmer')!.moveCommand).toBe(true);
  await page.screenshot({ path: info.outputPath('farmer-command-run.png') });
  await expect.poll(async () => (await snapshot(page)).economy.inventory.food, { timeout: 90000 }).toBe(8);
  expect((await snapshot(page)).economy.tasks.filter(task => task.kind === 'harvest')).toHaveLength(1);
  expect((await snapshot(page)).selection.resident).toBeUndefined();
  await selectUnit(page, 'farmer');
  const empty = (await snapshot(page)).objects.find(o => o.id === 'plot-2')!;
  await page.mouse.click(empty.screen.x, empty.screen.y);
  await expect(page.getByRole('button', { name: '种胡萝卜', exact: true })).toBeVisible();
  expect((await snapshot(page)).economy.tasks.some(task => task.kind === 'sow')).toBe(false);
  await page.getByRole('button', { name: '种小麦', exact: true }).click();
  expect((await snapshot(page)).economy.tasks.find(task => task.kind === 'sow')?.crop).toBe('wheat');
  expect((await snapshot(page)).selection.resident).toBeUndefined();
  await expect.poll(async () => (await snapshot(page)).farmerRunning).toBe(true);
  expect((await snapshot(page)).farmerWalking).toBe(false);
  await expect.poll(async () => (await snapshot(page)).economy.plots.find(p => p.id === 'plot-2')!.crop, { timeout: 45000 }).toBe('wheat');
  expect(errors).toEqual([]);
});

test('the selected dog runs to the latest destination and finishes its command', async ({ page }, info) => {
  test.setTimeout(90000);
  const errors = await openGame(page);
  await selectUnit(page, 'dog');
  await clickGround(page, { x: -1.2, z: -11 });
  await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === 'dog')!.moveCommand).toBe(true);
  await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === 'dog')!.motion).toBe('run');
  const running = (await snapshot(page)).residents.find(r => r.id === 'dog')!;
  expect(running.walking).toBe(false);
  expect(running.runPlaybackRate! * running.runReferenceSpeed!).toBeCloseTo(running.movementSpeed, 6);
  expect((await snapshot(page)).selection.resident).toBe('dog');
  const destination = { x: -4.5, z: -9.5 };
  await clickGround(page, destination);
  const redirected = (await snapshot(page)).residents.find(r => r.id === 'dog')!.destination!;
  expect(redirected.x).toBeCloseTo(destination.x, 1); expect(redirected.z).toBeCloseTo(destination.z, 1);
  await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === 'dog')!.moveCommand, { timeout: 90000 }).toBe(false);
  const arrived = (await snapshot(page)).residents.find(r => r.id === 'dog')!;
  expect(Math.hypot(arrived.position.x - destination.x, arrived.position.z - destination.z)).toBeLessThan(.13);
  await page.screenshot({ path: info.outputPath('dog-command.png') });
  expect((await snapshot(page)).selection.resident).toBe('dog');
  expect(errors).toEqual([]);
});
