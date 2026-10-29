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
  await expect(page.locator('#selection-name')).toHaveText('农民');
  const routeBefore = (await snapshot(page)).residents.find(actor => actor.id === 'farmer')!.routeRemaining;
  const ids = touch ? ['crop-0-0', 'crop-2-0', 'tree-11'] : ['cottage', 'well', 'tree-6', 'crop-0-0', 'crop-2-2', 'pond'];
  for (const id of ids) {
    const object = (await snapshot(page)).objects.find(object => object.id === id)!;
    await tap(object.screen.x, object.screen.y);
    await expect.poll(async () => (await snapshot(page)).selection.object?.id).toBe(id);
    await expect(page.locator('#selection-name')).toHaveText(object.name);
    expect((await snapshot(page)).selection.resident).toBeUndefined();
    await expect(page.locator('#selection-hint')).toHaveText('暂无可用操作');
    if (id === 'crop-0-0' || id.startsWith('tree')) await page.screenshot({ path: info.outputPath(id + '.png') });
  }
  expect((await snapshot(page)).residents.find(actor => actor.id === 'farmer')!.routeRemaining).toBe(routeBefore);
  await page.getByRole('button', { name: '取消选中', exact: true }).click();
  await expect(page.locator('#selection-card')).toBeHidden();
  expect((await snapshot(page)).selection.object).toBeUndefined();
  await selectResident('dog');
  await expect(page.locator('#selection-name')).toHaveText('田园犬');
  await expect(page.locator('#selection-hint')).toContainText('暂不可指挥');
  const card = await page.locator('#selection-card').boundingBox();
  expect(card!.x).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath('animal.png') });
  expect(errors).toEqual([]);
}
