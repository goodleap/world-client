import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('faster human and mounted runs keep their actual displacement synchronized with the gait', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = await openGame(page);
  for (const [id, speed] of [['base-human', 5], ['cavalry', 1.6 / 1.15 * 5]] as const) {
    const actor = async () => (await snapshot(page)).residents.find(entry => entry.id === id)!;
    const label = await page.locator(`[data-resident="${id}"]`).boundingBox();
    await page.mouse.click(label!.x + label!.width / 2, label!.y + label!.height + 22);
    await expect.poll(async () => (await snapshot(page)).selection.resident).toBe(id);
    const before = (await actor()).position;
    const camera = (await snapshot(page)).camera;
    const viewport = page.viewportSize()!;
    const pixels = viewport.height / (2 * camera.zoom);
    await page.mouse.click(viewport.width / 2 + (before.x - .25 - camera.x) * pixels,
      viewport.height / 2 + (.5 * Math.sin(camera.beta) - (before.z - .85 - camera.z) * Math.cos(camera.beta)) * pixels);
    await expect(page.locator('#toast')).toHaveText('前往目标位置');
    await expect.poll(async () => (await actor()).movementSpeed).toBeGreaterThan(speed * .95);
    const running = await actor();
    expect(running.running).toBe(true);
    expect(running.walking).toBe(false);
    expect(running.runPlaybackRate! * running.runReferenceSpeed!).toBeCloseTo(running.movementSpeed, 6);
    await page.screenshot({ path: info.outputPath(id + '-run.png') });
    await expect.poll(async () => (await actor()).motion, { timeout: 90_000 }).toBe('idle');
    const arrived = await actor();
    expect(Math.hypot(arrived.position.x - (before.x - .25), arrived.position.z - (before.z - .85))).toBeLessThan(.12);
    expect(arrived.running).toBe(false);
  }
  expect(errors).toEqual([]);
});
