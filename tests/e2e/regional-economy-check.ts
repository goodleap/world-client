import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy, decodeEconomy } from '../../src/game/economy.ts';
import { Combat } from '../../src/game/combat.ts';
import { ENEMIES } from '../../src/game/resident-data.ts';
import { RESOURCE_NODES, economyObstacles } from '../../src/game/economy-config.ts';
import { LANDSCAPE } from '../../src/game/world-data.ts';
import { insidePolygon } from '../../src/game/polygon.ts';
import { openGame, snapshot, panTo, clickGround, selectUnit } from './helpers.ts';

export function checkRegionalEconomy(touch: boolean) {
  test('mine, deliver, process at an expanded warehouse, pause and reload', async ({ page }, info) => {
    test.setTimeout(300_000);
    // A captured mine and built regional warehouse are preconditions. All
    // mining, hauling and processing below use actual pointers and navigation.
    const e = new Economy(); e.setLeadership(false);
    const mine = LANDSCAPE.regions.find(r => r.id === 'quarry')!;
    for (const u of e.state.combat.units.filter(u => ENEMIES.find(r => r.id === u.id)?.camp === 'quarry')) { u.hp = 0; u.life = 'defeated'; }
    new Combat(e.state.combat, e, () => economyObstacles([])).update(.05);
    e.state.goods = []; e.state.combat.rewardGoods = [];
    e.state.inventory = { wood: 28, stone: 16, food: 0, iron: 2 };
    const built = e.placeBuilding('warehouse', { x: mine.x - 6, z: mine.z }); expect(built.ok).toBe(true);
    e.claim(); e.arrive(built.task!.id); e.advance(8);
    const site = e.state.sites[0];
    const node = RESOURCE_NODES.filter(n => n.kind === 'iron' && insidePolygon(n, mine.area))
      .sort((a, b) => Math.hypot(a.x - site.x, a.z - site.z) - Math.hypot(b.x - site.x, b.z - site.z))[0];
    e.state.residents.farmer = { position: { x: node.x - node.radius - 1.2, z: node.z - .2 } };
    const saved = encodeEconomy(e); decodeEconomy(saved);
    await page.addInitScript(value => { if (!localStorage.getItem('world-basic-economy-v1')) localStorage.setItem('world-basic-economy-v1', value); }, saved);
    const errors = await openGame(page);
    const click = async (selector: string) => touch ? page.locator(selector).tap() : page.locator(selector).click();
    await panTo(page, node, touch); await selectUnit(page, 'farmer', touch);
    await clickGround(page, node, touch, .6);
    if ((await page.locator('[data-action="mine"]').count()) && (await page.locator('[data-action="mine"]').isVisible())) await click('[data-action="mine"]');
    await expect.poll(async () => (await snapshot(page)).economy.tasks.some(t => t.kind === 'mine' && t.target === node.id)).toBe(true);
    await expect.poll(async () => (await snapshot(page)).economy.depleted.includes(node.id), { timeout: 60_000 }).toBe(true);
    expect((await snapshot(page)).economy.inventory.iron).toBe(2);
    await expect.poll(async () => (await snapshot(page)).economy.inventory.iron, { timeout: 70_000 }).toBe(8);
    await panTo(page, site, touch); await clickGround(page, site, touch, 1);
    await expect(page.locator('[data-action="tools"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath('mine-workshop.png') });
    await click('[data-action="tools"]');
    await expect.poll(async () => (await snapshot(page)).economy.tasks.find(t => t.kind === 'tools')?.progress, { timeout: 60_000 }).toBeGreaterThan(0);
    await click('#settings'); const frozen = (await snapshot(page)).economy;
    await page.waitForTimeout(500); expect((await snapshot(page)).economy).toEqual(frozen);
    const dialog = (await page.locator('#settings-dialog').boundingBox())!, viewport = page.viewportSize()!;
    expect(Math.abs(dialog.x + dialog.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(dialog.y + dialog.height / 2 - viewport.height / 2)).toBeLessThan(2);
    await page.screenshot({ path: info.outputPath('workshop-paused.png') });
    await click('#continue-game');
    await expect.poll(async () => (await snapshot(page)).economy.upgrades.tools, { timeout: 90_000 }).toBe(1);
    expect((await snapshot(page)).economy.inventory.iron).toBe(0);
    await click('#settings'); await click('#return-menu');
    await openGame(page);
    expect((await snapshot(page)).economy.upgrades.tools).toBe(1);
    expect((await snapshot(page)).economy.inventory.iron).toBe(0);
    expect((await snapshot(page)).combat.camps.find(c => c.id === 'quarry')!.rewardGranted).toBe(true);
    expect(errors).toEqual([]);
  });
}
