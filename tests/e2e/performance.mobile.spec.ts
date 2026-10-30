import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

test('high-DPI touch viewport keeps bounded geometry, batching and visible shadows', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  const state = await snapshot(page);
  // Check actual submitted work, not FPS on CI's software GPU.
  expect(state.rendering.drawCalls).toBeLessThan(400);
  expect(state.rendering.visibleGeometryTriangles).toBeLessThan(3_100_000);
  expect(state.rendering.batchedParts).toBeGreaterThan(200);
  expect(state.shadows.mapSize).toBe(1024);
  expect(state.shadows.groundReceives).toBe(true);
  expect(state.shadows.casters.length).toBeGreaterThan(100);
  expect(state.size).toEqual({ width: 589, height: 1278 });
  await page.screenshot({ path: info.outputPath('phone.png'), scale: 'css' });
  await page.getByRole('button', { name: '查看农民模型', exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).camera.zoom, { timeout: 40_000 }).toBeLessThan(2.3);
  expect((await snapshot(page)).farmerModelLoaded).toBe(true);
  expect((await snapshot(page)).shadows.mapSize).toBe(2048);
  expect((await snapshot(page)).shadows.casters.length).toBe(state.shadows.casters.length);
  await page.screenshot({ path: info.outputPath('character.png'), scale: 'css' });
  await page.getByRole('button', { name: '回到起点', exact: true }).tap();
  expect((await snapshot(page)).shadows.mapSize).toBe(1024);
  expect((await snapshot(page)).shadows.casters.length).toBe(state.shadows.casters.length);
  const mapId = (await snapshot(page)).shadows.mapId;
  await page.getByRole('button', { name: '回到起点', exact: true }).tap();
  expect((await snapshot(page)).shadows.mapId).toBe(mapId);
  expect(errors).toEqual([]);
});
