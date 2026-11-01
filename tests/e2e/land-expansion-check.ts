import { test, expect, type Page } from '@playwright/test';
import { Economy, initialEconomy, type EconomyState } from '../../src/game/economy.ts';
import { ECONOMY_CONFIG as C } from '../../src/game/economy-config.ts';
import { buildingDoor } from '../../src/game/construction.ts';
import { gridPoint } from '../../src/game/world-data.ts';
import { clickGround, openGame, snapshot } from './helpers.ts';

async function setup(page: Page, state: EconomyState) {
  await page.addInitScript(state => {
    if (!localStorage.getItem('world-basic-economy-v1')) localStorage.setItem('world-basic-economy-v1', JSON.stringify(state));
  }, state);
  return openGame(page);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, touch: boolean) {
  if (!touch) { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); return; }
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
  for (let step = 1; step <= 12; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

export function checkLandExpansion(touch = false) {
  test('compact build menu places adjacent farmland and a working warehouse; reset sits at bottom right', async ({ page }, info) => {
    test.setTimeout(180_000);
    const state = initialEconomy(); state.steward.enabled = false; state.inventory = { wood: 60, stone: 40, food: 0 };
    const errors = await setup(page, state);
    const click = async (selector: string) => { if (touch) await page.locator(selector).tap(); else await page.locator(selector).click(); };
    const initial = await snapshot(page), viewport = page.viewportSize()!;
    expect(initial.economy.plots).toHaveLength(12); expect(initial.economy.plots.every(p => p.tilled)).toBe(true);
    await expect(page.locator('#help')).toHaveCount(0);
    const reset = (await page.locator('#reset').boundingBox())!;
    expect(reset.x).toBeGreaterThan(viewport.width - 80); expect(reset.y).toBeGreaterThan(viewport.height - 90);
    expect(reset.width).toBeGreaterThanOrEqual(44); expect(reset.height).toBeGreaterThanOrEqual(44);
    await click('#building-toggle');
    const menu = page.locator('#building-palette');
    expect(await menu.locator('button').evaluateAll(buttons => buttons.map(b => (b as HTMLButtonElement).dataset.building))).toEqual(['farm', 'warehouse', 'house']);
    const box = (await menu.boundingBox())!; expect(box.width).toBeLessThanOrEqual(206); expect(box.height).toBeLessThanOrEqual(180);
    for (const button of await menu.locator('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath('compact-building-menu.png'), scale: 'css' });

    await click('#build-farm'); await clickGround(page, gridPoint(51.5, 55.5), touch);
    await expect.poll(async () => (await snapshot(page)).economy.plots.length).toBe(13);
    await expect.poll(async () => (await snapshot(page)).economy.plots.find(p => p.id === 'plot-12')?.tilled, { timeout: 45_000 }).toBe(true);
    await click('#building-toggle');
    const choice = (await page.locator('#build-farm').boundingBox())!;
    const camera = (await snapshot(page)).camera, point = gridPoint(51.5, 56.5), scale = viewport.height / (2 * camera.zoom);
    await drag(page, { x: choice.x + choice.width / 2, y: choice.y + choice.height / 2 }, {
      x: viewport.width / 2 + (point.x - camera.target.x) * scale,
      y: viewport.height / 2 + (camera.target.y * Math.sin(camera.beta) - (point.z - camera.target.z) * Math.cos(camera.beta)) * scale,
    }, touch);
    await expect.poll(async () => (await snapshot(page)).economy.plots.length).toBe(14);
    await expect.poll(async () => (await snapshot(page)).economy.plots.find(p => p.id === 'plot-13')?.tilled, { timeout: 45_000 }).toBe(true);
    // The freshly opened plot is immediately usable through the ordinary crop menu.
    await expect(page.getByRole('button', { name: '种小麦', exact: true })).toBeVisible();
    await click('#selection-actions button[data-action="sow-wheat"]');
    await expect.poll(async () => (await snapshot(page)).economy.plots.find(p => p.id === 'plot-13')?.crop, { timeout: 45_000 }).toBe('wheat');

    await click('#building-toggle'); await click('#build-warehouse'); await clickGround(page, gridPoint(55.5, 57), touch);
    await expect.poll(async () => (await snapshot(page)).economy.sites[0]?.kind).toBe('warehouse');
    await expect.poll(async () => (await snapshot(page)).economy.buildings, { timeout: 60_000 }).toEqual(['site-0']);
    expect((await snapshot(page)).objects.find(o => o.id === 'site-0')).toMatchObject({ name: '仓库', kind: 'building' });
    expect((await snapshot(page)).economy.inventory).toEqual({ wood: 36, stone: 24, food: 0 });
    await click('#home-resources');
    await expect(page.locator('#inventory')).toContainText('木材 36/4000');
    await expect(page.locator('#inventory')).toContainText('粮食 0/8000');
    await click('#resources-dialog .dialog-close');
    await drag(page, { x: viewport.width / 2, y: viewport.height * .4 }, { x: viewport.width / 2 + 60, y: viewport.height * .4 + 50 }, touch);
    expect((await snapshot(page)).camera.target).not.toEqual(initial.camera.target);
    await click('#reset');
    await expect.poll(async () => {
      const target = (await snapshot(page)).camera.target;
      return Math.hypot(target.x - initial.camera.target.x, target.z - initial.camera.target.z);
    }).toBeLessThan(.001);
    await page.screenshot({ path: info.outputPath('expanded-farm-and-warehouse.png'), scale: 'css' });
    await click('#settings'); await click('#return-menu');
    await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
    await click('#continue-save');
    await expect(page.locator('#loading')).toHaveClass(/\bloaded\b/, { timeout: 60_000 });
    const restored = await snapshot(page);
    expect(restored.economy.plots).toHaveLength(14); expect(restored.economy.buildings).toEqual(['site-0']);
    expect(restored.economy.inventory).toEqual({ wood: 36, stone: 24, food: 0 });
    expect(errors).toEqual([]);
  });

  test('farmers deliver to the nearer completed warehouse and add the cargo once', async ({ page }, info) => {
    test.setTimeout(120_000);
    const e = new Economy(); e.state.steward.enabled = false; e.state.inventory = { ...C.warehouseCost };
    const task = e.placeBuilding('warehouse', gridPoint(55.5, 57)).task!;
    e.claim(); e.arrive(task.id); e.advance(C.workSeconds.build);
    const door = buildingDoor(e.state.sites[0]);
    e.state.goods.push({ id: 'goods-99', ...gridPoint(53.5, 57.5), resource: 'wood', amount: 8, state: 'ground' }); e.state.nextId = 100;
    const errors = await setup(page, e.state);
    await page.waitForFunction(door => {
      const s = window.__DEMO__!.snapshot(), haul = s.economy.tasks.find(t => t.kind === 'haul' && t.status === 'delivering');
      const actor = s.residents.find(r => r.id === haul?.worker);
      if (!actor?.destination || Math.hypot(actor.destination.x - door.x, actor.destination.z - door.z) > 1) return false;
      document.getElementById('settings')!.click(); return true;
    }, door, { timeout: 60_000 });
    const delivering = await snapshot(page);
    const haul = delivering.economy.tasks.find(t => t.kind === 'haul')!;
    expect(haul.status).toBe('delivering'); expect(delivering.economy.inventory.wood).toBe(0);
    await info.attach('nearest-warehouse-delivery', { body: JSON.stringify({ door, haul, actor: delivering.residents.find(r => r.id === haul.worker)?.destination }), contentType: 'application/json' });
    await page.locator('#continue-game').click();
    await expect.poll(async () => (await snapshot(page)).economy.inventory.wood, { timeout: 45_000 }).toBe(8);
    expect((await snapshot(page)).economy.goods).toHaveLength(0);
    expect((await snapshot(page)).economy.tasks.find(t => t.id === haul.id)?.status).toBe('done');
    expect(errors).toEqual([]);
  });
}
