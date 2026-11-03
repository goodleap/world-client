import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { openGame, selectUnit, snapshot } from './helpers.ts';

export async function checkRuntimePerformance(page: Page, info: TestInfo, touch: boolean) {
  await page.addInitScript(() => { navigator.clipboard.writeText = async text => { (window as any).__copiedLog = text; }; });
  const errors = await openGame(page);
  await selectUnit(page, 'infantry', touch);
  await expect.poll(async () => (await snapshot(page)).diagnostics.latest?.selectionDrawCalls).toBeGreaterThan(0);
  const running = await snapshot(page);
  expect(running.selectionFeedback.technique).toBe('native-outline');
  expect(running.candidates.candidates).toBeLessThan(running.meshes);
  expect(running.diagnostics.latest!.context!.selected).toBe(1);
  await page.screenshot({ path: info.outputPath('selected.png'), scale: 'css' });
  await page.locator('#settings').click();
  const paused = await snapshot(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('world-basic-economy-v1')!));
  expect(saved.seconds).toBe(paused.economy.seconds);
  await page.waitForTimeout(300);
  expect((await snapshot(page)).saves.count).toBe(paused.saves.count);
  await page.locator('#copy-diagnostics').click();
  const text = await page.evaluate(() => (window as any).__copiedLog as string), report = JSON.parse(text);
  expect(text.length).toBeLessThan(10000); expect(report.schema).toBe(2);
  expect(report.performance.latest.context.mode).toBe('standard'); expect(report.performance.latest.context.fpsLimit).toBe(60);
  expect(report.performance.scene.lod.units).toBeGreaterThan(0);
  const p = report.performance.latest.passes;
  expect(p.main[0] + p.shadow[0] + p.selection[0]).toBe(p.total[0]);
  expect(p.main[1] + p.shadow[1] + p.selection[1]).toBe(p.total[1]);
  await info.attach('compact-log', { body: text, contentType: 'application/json' });
  // Changing a graphics preference while paused must not relabel the previous
  // running sample. The compact log keeps both current settings and context.
  await page.locator('#settings-graphics').click(); await page.locator('#performance-mode').selectOption('minimum');
  await page.locator('#graphics-back').click(); await page.locator('#copy-diagnostics').click();
  const changed = await page.evaluate(() => JSON.parse((window as any).__copiedLog));
  expect(changed.graphics.mode).toBe('minimum');
  expect(changed.performance.latest.context.mode).toBe('standard');
  await page.locator('#return-menu').click(); await page.reload(); await page.locator('#continue-save').click();
  await expect(page.locator('#loading')).toHaveClass(/loaded/, { timeout: 90000 });
  await page.locator('#settings').click();
  const restored = await snapshot(page);
  expect(restored.graphics.mode).toBe('minimum');
  expect(restored.economy.seconds).toBeGreaterThanOrEqual(saved.seconds);
  expect(restored.economy.seconds - saved.seconds).toBeLessThan(5);
  expect(restored.economy.inventory).toEqual(saved.inventory);
  expect(errors).toEqual([]);
}
