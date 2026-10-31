import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { openGame, snapshot } from './helpers.ts';
import { ECONOMY_CONFIG } from '../../src/game/economy-config.ts';

test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
test('near, far and near again release scene load and keep one render loop', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors = await openGame(page);
  // Crop growth creates legitimate cached templates. Start after maturation so
  // near/far comparisons do not mistake this gameplay change for a zoom leak.
  await expect.poll(async () => (await snapshot(page)).economy.plots.find(plot => plot.crop === 'wheat')!.growth,
    { timeout: 60000 }).toBe(ECONOMY_CONFIG.crops.wheat.growthSeconds);
  const readings: unknown[] = [];
  let initial: Awaited<ReturnType<typeof snapshot>> | undefined;
  for (const [label, target, button, clicks] of [
    ['near', 6, '放大', 4], ['far', 18, '缩小', 10], ['near-return', 6, '放大', 10],
  ] as const) {
    // Exercise the real zoom handlers in one event turn; avoid spending GPU frames on repeated button actionability checks.
    await page.getByRole('button', { name: button, exact: true }).evaluate((element, count) => {
      for (let i = 0; i < count; i++) (element as HTMLButtonElement).click();
    }, clicks);
    await expect.poll(async () => Math.abs((await snapshot(page)).camera.zoom - target), { timeout: 45000 }).toBeLessThan(.03);
    const frames = (await snapshot(page)).frames;
    await page.waitForFunction(frames => window.__DEMO__!.snapshot().frames >= frames + 8, frames, { timeout: 60000 });
    const state = await snapshot(page);
    readings.push({ label, performance: state.diagnostics, rendering: state.rendering, shadows: state.shadows,
      lod: state.residents.filter(r => r.lod).map(r => ({ id: r.id, ...r.lod })) });
    expect(state.diagnostics.latest!.renderLoops).toBe(1);
    expect(state.diagnostics.latest!.submittedTriangles).toBeGreaterThan(0);
    expect(state.shadows.lodCamera).toBe('map-shadow-lod');
    if (!initial) initial = state;
    if (label === 'near-return') {
      for (const key of ['meshes', 'geometries', 'textures', 'materials', 'skeletons', 'animationGroups'] as const) {
        expect(state.diagnostics.latest![key]).toBe(initial.diagnostics.latest![key]);
      }
      expect(state.residents.map(r => r.lod?.mapParts)).toEqual(initial.residents.map(r => r.lod?.mapParts));
      expect(state.size).toEqual(initial.size);
    }
    await page.screenshot({ path: info.outputPath(`${label}.png`), scale: 'css' });
  }
  await writeFile(info.outputPath('zoom-performance.json'), JSON.stringify(readings, null, 2));
  await page.getByRole('button', { name: '查看农民模型', exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).camera.zoom, { timeout: 45000 }).toBeLessThan(2.3);
  const preview = await snapshot(page);
  expect(preview.shadows.lodCamera).toBe('camera');
  expect(preview.shadows.mapSize).toBe(2048);
  expect(preview.residents.filter(r => r.lod).every(r => r.lod!.mapParts === 0)).toBe(true);
  await page.screenshot({ path: info.outputPath('model-preview.png'), scale: 'css' });
  await page.getByRole('button', { name: '回到起点', exact: true }).tap();
  expect((await snapshot(page)).shadows.lodCamera).toBe('map-shadow-lod');
  expect((await snapshot(page)).shadows.mapSize).toBe(1024);
  expect(errors).toEqual([]);
});
