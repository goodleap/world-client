import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('world and loaded residents cast and receive consistent daylight shadows', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  const shadow = (await snapshot(page)).shadows;
  expect(shadow.groundReceives).toBe(true);
  expect(shadow.casters.map(mesh => mesh.name)).toEqual(expect.arrayContaining([
    'world-cream', 'world-terracotta', 'Head • shaped cranium cheeks and jaw',
    'Horse • continuous body neck head and legs', 'dog-animal-dog',
  ]));
  expect(shadow.casters.some(mesh => mesh.name === 'world-tree-foliage')).toBe(true);
  expect(shadow.casters.every(mesh => mesh.receive)).toBe(true);
  await page.screenshot({ path: info.outputPath('world.png') });
  await page.getByRole('button', { name: '查看农民模型', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).camera.zoom, { timeout: 30_000 }).toBeLessThan(2.3);
  await page.screenshot({ path: info.outputPath('character.png') });
  await page.getByRole('button', { name: '回到起点' }).click();
  await page.setViewportSize({ width: 393, height: 851 });
  await expect.poll(async () => (await snapshot(page)).camera.zoom, { timeout: 30_000 }).toBeGreaterThan(10.5);
  await page.screenshot({ path: info.outputPath('phone.png') });
  expect(errors).toEqual([]);
});
