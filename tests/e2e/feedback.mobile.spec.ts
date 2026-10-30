import { test, expect } from '@playwright/test';
import { clickGround, openGame, selectUnit, snapshot } from './helpers.ts';

test('touch movement marks the accepted destination and dragging does not move the marker', async ({ page }, info) => {
  const errors = await openGame(page);
  await selectUnit(page, 'base-human', true);
  const destination = { x: .8, z: -7 };
  await clickGround(page, destination, true);
  const marker = (await snapshot(page)).moveFeedback;
  expect(marker.visible).toBe(true);
  expect(marker.x).toBeCloseTo(destination.x, 1); expect(marker.z).toBeCloseTo(destination.z, 1);
  await page.waitForFunction(() => window.__DEMO__!.snapshot().baseRunning);
  await page.screenshot({ path: info.outputPath('phone-move-destination.png') });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const frozen = (await snapshot(page)).moveFeedback;
  await page.locator('#settings-title').tap();
  expect((await snapshot(page)).moveFeedback).toEqual(frozen);
  await page.getByRole('button', { name: '继续游戏', exact: true }).click();
  await page.mouse.move(180, 620); await page.mouse.down(); await page.mouse.move(230, 620, { steps: 4 }); await page.mouse.up();
  const afterDrag = (await snapshot(page)).moveFeedback;
  expect(afterDrag.x).toBe(marker.x); expect(afterDrag.z).toBe(marker.z);
  expect(errors).toEqual([]);
});
