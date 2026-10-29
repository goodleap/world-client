import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';
import { isBlocked } from '../../src/game/movement.ts';
import { RESIDENTS, RESIDENT_OBSTACLES } from '../../src/game/resident-data.ts';

test('residents including the base character render and wander safely', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  const initial = (await snapshot(page)).residents;
  expect(initial.map((r) => r.role)).toEqual(['farmer', 'worker', 'infantry', 'archer', 'cavalry', 'dog', 'base']);
  expect((await snapshot(page)).baseModelLoaded).toBe(true);
  const humans = initial.filter((r) => r.humanBones.length > 0);
  expect(humans).toHaveLength(6);
  expect(new Set(humans.map((r) => r.humanRigId)).size).toBe(6);
  for (const human of humans) expect(human.humanBones).toEqual(initial[0].humanBones);
  expect(initial.find((r) => r.role === 'cavalry')!.animalBones).toHaveLength(8);
  expect(initial.find((r) => r.role === 'dog')!.animalBones).toHaveLength(8);
  const parts = Object.fromEntries(initial.map((r) => [r.role, r.parts]));
  expect(parts.farmer).toContain('straw-sandal');
  for (const role of ['worker', 'archer']) {
    expect(initial.find((r) => r.role === role)!.placeholder).toBe(true);
    expect(initial.find((r) => r.role === role)!.legacyVisible).toBe(false);
    await expect(page.locator(`[data-resident="${role}"]`)).toContainText('占位');
  }
  const infantry = initial.find(r => r.role === 'infantry')!;
  expect(infantry.placeholder).toBe(false);
  expect(infantry.legacyVisible).toBe(false);
  expect(infantry.model?.bones).toHaveLength(20);
  expect(infantry.model?.meshes).toEqual(expect.arrayContaining(['Helmet • rounded steel crown', 'Sword • broad steel blade', 'Shield • convex blue face']));
  await expect(page.locator('[data-resident="infantry"]')).toHaveText('步兵');
  const cavalry = initial.find(r => r.role === 'cavalry')!;
  expect(cavalry.placeholder).toBe(false);
  expect(cavalry.legacyVisible).toBe(false);
  expect(cavalry.model?.bones.filter(name => name.startsWith('Horse.'))).toHaveLength(17);
  expect(cavalry.model?.meshes).toEqual(expect.arrayContaining(['Horse • continuous body neck head and legs', 'Lance • leaf steel point']));
  await expect(page.locator('[data-resident="cavalry"]')).toHaveText('骑兵');
  expect(parts.dog).toEqual(expect.arrayContaining(['curled-tail', 'upright-ear']));
  await expect(page.locator('[data-resident]')).toHaveCount(7);
  await expect.poll(async () => (await snapshot(page)).residents.map((r) => ({ id: r.id, travelled: r.travelled > 0.35 })), { timeout: 90_000 })
    .toEqual(initial.map((r) => ({ id: r.id, travelled: true })));
  await expect.poll(async () => (await snapshot(page)).residents.some((r) => r.placeholderWalking)).toBe(true);
  const moving = (await snapshot(page)).residents;
  for (const actor of moving) {
    const definition = RESIDENTS.find((r) => r.id === actor.id)!;
    expect(isBlocked(actor.position, definition.bodyRadius, RESIDENT_OBSTACLES)).toBe(false);
    if (actor.model) {
      if (actor.walking || actor.running) expect(actor.modelPose).not.toEqual(initial.find(r => r.id === actor.id)!.modelPose);
    } else expect(actor.pose).not.toEqual(initial.find((r) => r.id === actor.id)!.pose);
  }
  await page.getByRole('button', { name: '操作说明', exact: true }).click();
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.baseWalking || state.baseRunning || state.farmerWalking
      || state.residents.some((actor) => actor.walking || actor.running);
  }).toBe(false);
  const paused = (await snapshot(page)).residents;
  await page.waitForTimeout(400);
  expect((await snapshot(page)).residents).toEqual(paused);
  await page.keyboard.press('Escape');
  await page.waitForFunction((before) => window.__DEMO__!.snapshot().residents.some((r, i) => r.travelled > before[i].travelled), paused);
  expect(errors).toEqual([]);
});
