import { test, expect } from '@playwright/test';
import { Economy, initialEconomy, encodeEconomy } from '../../src/game/economy.ts';
import { buildingAt, buildingDoor } from '../../src/game/construction.ts';
import { HOME_CENTER, GRID_SIZE } from '../../src/game/world-data.ts';
import { surfaceHeight } from '../../src/game/terrain-height.ts';
import { openGame, snapshot, clickGround, selectUnit } from './helpers.ts';
import type { Page } from '@playwright/test';

async function prepare(page: Page, blockedExit = false) {
  const e = new Economy(initialEconomy(817)); e.setLeadership(false);
  e.state.raids.nextAt = 100000; e.state.raids.warningAt = 100000;
  e.state.residents.farmer = { position: { x: 5, z: 4 } };
  e.state.residents['farmer-2'] = { position: { x: 5, z: 1 } };
  for (const v of Object.values(e.state.vitals)) v.manualUntil = 100000;
  // A previous destination may later be covered by construction. Updating it
  // must validate from the home entrance rather than this obsolete position.
  e.state.recruitment.rally = { x: HOME_CENTER.x, z: HOME_CENTER.z };
  if (blockedExit) {
    const door = buildingDoor(HOME_CENTER);
    const house = buildingAt('house', { x: door.x, z: door.z - GRID_SIZE }, 'site-0');
    e.state.sites.push(house); e.state.buildings.push(house.id); e.state.nextSiteId = 1;
  }
  await page.addInitScript(save => {
    localStorage.setItem('world-basic-economy-v1', save);
    localStorage.setItem('world-shadows-enabled', 'false');
  }, encodeEconomy(e));
  const errors = await openGame(page);
  // Frame the home and both residents together before testing touch picking.
  const zoom = (await snapshot(page)).camera.zoom;
  await page.mouse.move(206, 457);
  await page.mouse.wheel(0, 600); await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(zoom + 10);
  return errors;
}

async function selectHome(page: Page) {
  await clickGround(page, HOME_CENTER, true, surfaceHeight(HOME_CENTER.x, HOME_CENTER.z) + 2);
  await expect(page.locator('#selection-name')).toHaveText('家园中心');
  await expect(page.locator('#selection-info')).toBeVisible();
  await expect(page.locator('#selection-hint')).toContainText('点击空地设置集合点');
  await expect(page.getByRole('button', { name: '取消选中', exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).rallyGuidance.visible).toBe(true);
}

test('home selection sets the rally directly and shows its arrow connection without retaining a unit command', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors = await prepare(page);
  await selectUnit(page, 'farmer', true);
  await selectHome(page);
  expect((await snapshot(page)).selection.members).toEqual([]);
  const goal = { x: 7, z: 2 };
  await clickGround(page, goal, true);
  await expect.poll(async () => {
    const p = (await snapshot(page)).economy.recruitment.rally;
    return Math.hypot(p.x - goal.x, p.z - goal.z);
  }).toBeLessThan(.15);
  await expect.poll(async () => (await snapshot(page)).rallyGuidance.endpoint).toEqual((await snapshot(page)).economy.recruitment.rally);
  const state = await snapshot(page);
  expect(state.selection.object?.id).toBe('home-center');
  expect(state.rallyGuidance.points[0]).toEqual(buildingDoor(HOME_CENTER));
  expect(state.rallyGuidance.arrows.some(a => a.alpha > .5)).toBe(true);
  await page.screenshot({ path: info.outputPath('home-rally-connection.png') });
  await page.locator('#selection-actions').getByRole('button', { name: '招募', exact: true }).click();
  await expect(page.locator('#set-rally')).toHaveCount(0);
  await expect(page.locator('#continue-recruit')).toBeInViewport();
  await page.locator('#continue-recruit').click();
  await selectUnit(page, 'farmer-2', true);
  await expect(page.locator('#resident-selection')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).rallyGuidance.visible).toBe(false);
  const before = (await snapshot(page)).residents.find(r => r.id === 'farmer-2')!.position;
  await clickGround(page, { x: 8, z: 0 }, true);
  await expect.poll(async () => {
    const p = (await snapshot(page)).residents.find(r => r.id === 'farmer-2')!.position;
    return Math.hypot(p.x - before.x, p.z - before.z);
  }, { timeout: 15000 }).toBeGreaterThan(.5);
  expect((await snapshot(page)).economy.recruitment.rally).toEqual(state.economy.recruitment.rally);
  expect(errors).toEqual([]);
});

test('an unreachable rally keeps cancellation and unit selection available, including after Escape', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await prepare(page, true);
  await selectHome(page);
  const rally = (await snapshot(page)).economy.recruitment.rally;
  await clickGround(page, { x: 7, z: 2 }, true);
  await expect(page.locator('#target-hint')).toHaveText('无法到达该位置');
  await expect(page.locator('#selection-info')).toBeVisible();
  await expect(page.locator('#clear-selection')).toBeVisible();
  expect((await snapshot(page)).economy.recruitment.rally).toEqual(rally);
  await selectUnit(page, 'farmer', true);
  await expect(page.locator('#resident-selection')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).rallyGuidance.visible).toBe(false);
  await selectHome(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#selection-info')).toBeHidden();
  await selectUnit(page, 'farmer-2', true);
  await expect(page.locator('#resident-selection')).toBeVisible();
  await selectHome(page);
  await page.locator('#clear-selection').click();
  await expect(page.locator('#selection-info')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).rallyGuidance.visible).toBe(false);
  await selectUnit(page, 'farmer', true);
  await clickGround(page, { x: 8, z: 2 }, true);
  await expect.poll(async () => {
    const p = (await snapshot(page)).residents.find(r => r.id === 'farmer')!.position;
    return Math.hypot(p.x - 8, p.z - 2);
  }, { timeout: 15000 }).toBeLessThan(.2);
  expect(errors).toEqual([]);
});
