import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';
import { isBlocked } from '../../src/game/movement.ts';
import { RESIDENTS, RESIDENT_OBSTACLES } from '../../src/game/resident-data.ts';

test('six equipped residents render, use independent shared human rigs, and wander safely', async ({ page }) => {
  const errors = await openGame(page);
  const initial = (await snapshot(page)).residents;
  expect(initial.map((r) => r.role)).toEqual(['farmer', 'worker', 'infantry', 'archer', 'cavalry', 'dog']);
  const humans = initial.filter((r) => r.humanBones.length > 0);
  expect(humans).toHaveLength(5);
  expect(new Set(humans.map((r) => r.humanRigId)).size).toBe(5);
  for (const human of humans) expect(human.humanBones).toEqual(initial[0].humanBones);
  expect(initial.find((r) => r.role === 'cavalry')!.animalBones).toHaveLength(8);
  expect(initial.find((r) => r.role === 'dog')!.animalBones).toHaveLength(8);
  const parts = Object.fromEntries(initial.map((r) => [r.role, r.parts]));
  expect(parts.farmer).toContain('straw-sandal');
  expect(parts.worker).toContain('worker-tool-pouch');
  expect(parts.infantry).toEqual(expect.arrayContaining(['short-sword-blade', 'round-shield-rim']));
  expect(parts.archer).toEqual(expect.arrayContaining(['wooden-bow', 'quiver', 'archer-arrow-fletching']));
  expect(parts.cavalry).toEqual(expect.arrayContaining(['lance-shaft', 'saddle', 'horse-head']));
  expect(parts.dog).toEqual(expect.arrayContaining(['curled-tail', 'upright-ear']));
  await expect(page.locator('[data-resident]')).toHaveCount(6);
  await page.waitForFunction(() => window.__DEMO__!.snapshot().residents.every((r) => r.travelled > 0.35), null, { timeout: 40_000 });
  const moving = (await snapshot(page)).residents;
  for (const actor of moving) {
    const definition = RESIDENTS.find((r) => r.id === actor.id)!;
    expect(isBlocked(actor.position, definition.bodyRadius, RESIDENT_OBSTACLES)).toBe(false);
    expect(actor.pose).not.toEqual(initial.find((r) => r.id === actor.id)!.pose);
  }
  await page.getByRole('button', { name: '操作说明', exact: true }).click();
  const paused = (await snapshot(page)).residents;
  await page.waitForTimeout(400);
  expect((await snapshot(page)).residents).toEqual(paused);
  await page.keyboard.press('Escape');
  await page.waitForFunction((before) => window.__DEMO__!.snapshot().residents.some((r, i) => r.travelled > before[i].travelled), paused);
  expect(errors).toEqual([]);
});
