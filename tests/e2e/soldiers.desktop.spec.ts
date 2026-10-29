import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

for (const role of ['infantry', 'cavalry']) {
test(`${role} uses the dressed shared rig for wandering, commanded running, and arrival`, async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = await openGame(page);
  const soldier = async () => (await snapshot(page)).residents.find(r => r.id === role)!;
  expect((await soldier()).model?.animations.sort()).toEqual(role === 'cavalry' ? ['RideIdle', 'RideRun', 'RideWalk', 'Run', 'Walk'] : ['Run', 'Walk']);
  expect((await soldier()).placeholder).toBe(false);
  expect((await soldier()).legacyVisible).toBe(false);
  // The demo caps simulation steps under software WebGL; its initial wander
  // pause can therefore take much longer than wall-clock seconds in CI.
  await expect.poll(async () => (await soldier()).walking, { timeout: 90_000 }).toBe(true);
  const label = await page.locator(`[data-resident="${role}"]`).boundingBox();
  expect(label).not.toBeNull();
  await page.mouse.click(label!.x + label!.width / 2, label!.y + label!.height + 22);
  await expect.poll(async () => (await snapshot(page)).selection.resident).toBe(role);
  const before = (await soldier()).position;
  const camera = (await snapshot(page)).camera;
  const viewport = page.viewportSize()!;
  const pixels = viewport.height / (2 * camera.zoom);
  await page.mouse.click(viewport.width / 2 + (before.x - .25 - camera.x) * pixels,
    viewport.height / 2 + (.5 * Math.sin(camera.beta) - (before.z - .85 - camera.z) * Math.cos(camera.beta)) * pixels);
  await expect(page.locator('#toast')).toHaveText('前往目标位置');
  await expect.poll(async () => (await soldier()).running).toBe(true);
  expect((await soldier()).walking).toBe(false);
  const pose = (await soldier()).modelPose;
  await expect.poll(async () => (await soldier()).modelPose).not.toEqual(pose);
  await page.screenshot({ path: info.outputPath(role + '-demo.png') });
  await expect.poll(async () => (await soldier()).routeRemaining, { timeout: 90_000 }).toBe(0);
  await expect.poll(async () => (await soldier()).motion).toBe('idle');
  expect((await soldier()).running).toBe(false);
  expect(errors).toEqual([]);
});
}
