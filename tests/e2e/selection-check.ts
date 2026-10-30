import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

export async function checkSelection(page: Page, info: TestInfo, touch: boolean) {
  const errors = await openGame(page);
  const tap = async (x: number, y: number) => touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
  const selectResident = async (id: string) => {
    const label = await page.locator(`[data-resident="${id}"]`).boundingBox();
    await tap(label!.x + label!.width / 2, label!.y + label!.height + 18);
    await expect.poll(async () => (await snapshot(page)).selection.resident).toBe(id);
  };
  await selectResident('farmer');
  await expect(page.locator('#resident-name')).toHaveText('农民');
  const routeBefore = (await snapshot(page)).residents.find(actor => actor.id === 'farmer')!.routeRemaining;
  const ids = touch ? ['plot-0', 'plot-6', 'tree-11'] : ['cottage', 'well', 'tree-6', 'plot-0', 'plot-8', 'pond'];
  await page.getByRole('button', { name: '取消选中', exact: true }).click();
  for (const id of ids) {
    if (await page.locator('#selection-card').isVisible()) await page.getByRole('button', { name: '关闭对象操作', exact: true }).click();
    const object = (await snapshot(page)).objects.find(object => object.id === id)!;
    await tap(object.screen.x, object.screen.y);
    await expect.poll(async () => (await snapshot(page)).selection.object?.id).toBe(id);
    await expect(page.locator('#selection-name')).toHaveText(object.name);
    expect((await snapshot(page)).selection.resident).toBeUndefined();
    if (['building', 'scenery'].includes(object.kind)) await expect(page.locator('#selection-hint')).toHaveText('暂无可用操作');
    else await expect(page.locator('#selection-actions button').first()).toBeVisible();
    if (id === 'plot-0' || id.startsWith('tree')) await page.screenshot({ path: info.outputPath(id + '.png') });
  }
  expect((await snapshot(page)).residents.find(actor => actor.id === 'farmer')!.routeRemaining).toBe(routeBefore);
  expect((await snapshot(page)).economy.tasks).toHaveLength(0); // Selection must not click through into a new action button.
  await page.getByRole('button', { name: '关闭对象操作', exact: true }).click();
  await expect(page.locator('#selection-card')).toBeHidden();
  expect((await snapshot(page)).selection.object).toBeUndefined();
  await selectResident('dog');
  await expect(page.locator('#resident-name')).toHaveText('田园犬');
  await expect(page.locator('#resident-hint')).toContainText('指挥移动');
  const card = await page.locator('#resident-selection').boundingBox();
  expect(card!.x).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath('animal.png') });
  expect(errors).toEqual([]);
}
