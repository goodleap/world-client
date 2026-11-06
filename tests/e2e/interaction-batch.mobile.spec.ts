import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { Economy, encodeEconomy, decodeEconomy } from '../../src/game/economy.ts';
import { createFighter } from '../../src/game/combat.ts';
import { newResident } from '../../src/game/resident-data.ts';
import { updateDangerZones } from '../../src/game/danger-zones.ts';
import { initialVital } from '../../src/game/vitals.ts';
import { gridPoint } from '../../src/game/world-data.ts';
import { ECONOMY_SAVE_KEY } from '../../src/game/economy-storage.ts';
import { openGame, snapshot, clickGround, panTo } from './helpers.ts';

test.use({ video: 'on' });

test('compact construction keeps touch height, rejects unaffordable buildings and fills the minimap panel', async ({ page }, info) => {
  test.setTimeout(180_000);
  const e = new Economy(); e.setLeadership(false); e.state.raids.nextAt = 1000;
  e.state.inventory = { wood: 12, stone: 8, food: 0, iron: 0 };
  const held = e.request('sow', 'plot-2', 'wheat', 'steward').task!;
  const guard = e.state.combat.units.find(u => u.id === 'enemy-guard')!;
  held.watchPath = [{ ...guard.position }];
  updateDangerZones(e.state.dangerZones, [{ id: guard.id, ...guard.position, radius: 8 }], 0); e.holdDanger(held);
  await page.addInitScript(save => { localStorage.setItem('world-basic-economy-v1', save); localStorage.setItem('world-shadows-enabled', 'false'); }, encodeEconomy(e));
  const errors = await openGame(page);
  await expect(page.locator('#queue-count')).toHaveText('0');
  expect((await snapshot(page)).economy.tasks.some(t => !!t.danger)).toBe(true);
  await page.locator('#queue-toggle').tap(); await expect(page.locator('#queue-list')).not.toContainText('危险'); await page.locator('#queue-close').tap();
  await page.setViewportSize({ width: 393, height: 851 });
  await page.locator('#building-toggle').tap();
  await expect(page.locator('#build-house')).toBeEnabled();
  await expect(page.locator('#build-tower')).toBeDisabled();
  await expect(page.locator('#build-tower .building-cost')).toContainText('缺少木材');
  const layout = await page.locator('#building-palette').evaluate(el => {
    const panel = el.getBoundingClientRect(), cards = [...el.querySelectorAll('button')].map(b => b.getBoundingClientRect());
    return { heights: cards.map(r => r.height), visible: cards.filter(r => r.left >= panel.left && r.right <= panel.right).length };
  });
  expect(layout.heights.every(h => h >= 58)).toBe(true); expect(layout.visible).toBeGreaterThanOrEqual(4);
  await page.locator('#map-toggle').tap();
  const map = await page.locator('#minimap-panel').evaluate(el => ({ padding: getComputedStyle(el).padding,
    panel: el.clientWidth, canvas: el.querySelector('canvas')!.getBoundingClientRect().width }));
  expect(map.padding).toBe('0px'); expect(Math.abs(map.panel - map.canvas)).toBeLessThan(1);
  await expect(page.locator('.minimap-heading, .minimap-legend, .queue-note')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('compact-controls-393.png') });
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('compact-controls-320.png') });
  await page.setViewportSize({ width: 393, height: 851 });
  await page.locator('#map-toggle').tap(); await page.locator('#building-toggle').tap();
  const point = gridPoint(44, 56); await panTo(page, point, true);
  await page.locator('#building-toggle').tap(); await page.locator('#build-house').scrollIntoViewIfNeeded(); await page.locator('#build-house').tap();
  await clickGround(page, point, true);
  await expect.poll(async () => (await snapshot(page)).economy.sites.length).toBe(1);
  await page.locator('#building-toggle').tap();
  await expect(page.locator('#build-house')).toBeDisabled(); await expect(page.locator('#build-campfire')).toBeDisabled();
  expect((await snapshot(page)).economy.tasks.filter(t => t.kind === 'build')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('debug query grants new-game stock and leaves Continue stock intact', async ({ page }) => {
  test.setTimeout(180_000);
  const e = new Economy(); e.setLeadership(false); e.state.inventory.wood = 23;
  await page.addInitScript(({ key, save }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, save); }, { key: ECONOMY_SAVE_KEY, save: encodeEconomy(e) });
  const errors = await openGame(page, '/?debug');
  expect((await snapshot(page)).economy.inventory.wood).toBe(23);
  await page.locator('#settings').tap(); await page.getByRole('button', { name: '回到主菜单', exact: true }).tap();
  await page.locator('#start-game').tap(); await page.getByRole('button', { name: '开始新游戏', exact: true }).tap();
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing', { timeout: 60000 });
  const fresh = (await snapshot(page)).economy;
  expect(fresh.debug).toBe(true); expect(Object.values(fresh.inventory)).toEqual([100000, 100000, 100000, 100000]);
  expect(errors).toEqual([]);
});

type MotionSample = { time: number; x: number; z: number; speed: number; hp: number; endError?: number; routeError?: number; pose: unknown };
declare global { interface Window { __ATTACK_MOTION__?: { samples: MotionSample[]; done: boolean } } }

test('live archer pursuit draws the shared route to its target and stops to shoot', async ({ page }, info) => {
  test.setTimeout(210_000);
  const e = new Economy(); e.setLeadership(false); e.state.seconds = 10; e.state.raids.nextAt = 1000;
  for (const u of e.state.combat.units) { u.life = 'defeated'; u.hp = 0; u.diedAt = 0; }
  for (const v of Object.values(e.state.vitals)) if (v.hp !== undefined) { v.hp = 0; v.diedAt = 0; }
  for (const w of e.state.raids.wildWolves) { w.life = 'defeated'; w.hp = 0; w.diedAt = 0; w.settled = true; }
  for (const camp of e.state.combat.camps) camp.cleared = camp.rewardGranted = camp.discovered = true;
  e.state.combat.cleared = e.state.combat.rewardGranted = e.state.combat.discovered = true;
  const foe = createFighter(newResident('infantry', 'enemy-raid-infantry-2-0', { x: -20, z: -1 }));
  foe.position = { x: 4, z: -1 }; foe.order = 'hold'; foe.goal = { ...foe.home }; foe.route = [{ ...foe.home }];
  e.state.combat.units.push(foe); e.state.vitals[foe.id] = initialVital(foe.id);
  const archer = e.state.combat.units.find(u => u.id === 'archer')!;
  archer.life = 'active'; archer.hp = 110; archer.diedAt = undefined; archer.position = { x: 24, z: -1 }; archer.order = 'attack'; archer.target = foe.id;
  Object.assign(e.state.raids, { phase: 'raid', wave: 2, startedAt: 10, origin: foe.home, soldiers: [foe.id] });
  e.state.groups[0] = ['archer'];
  const save = encodeEconomy(e); decodeEconomy(save);
  await page.addInitScript(({ save, id }) => {
    localStorage.setItem('world-basic-economy-v1', save); localStorage.setItem('world-shadows-enabled', 'false');
    const result: NonNullable<Window['__ATTACK_MOTION__']> = window.__ATTACK_MOTION__ = { samples: [] as MotionSample[], done: false }; let sampled = -1;
    let selected = false, focusedAt = -1;
    const observe = async () => {
      if (!window.__DEMO__) { requestAnimationFrame(observe); return; }
      if (!selected) {
        const group = document.querySelector<HTMLButtonElement>('[data-group="0"]');
        if (group) { group.click(); group.click(); selected = true; }
      }
      const s = (await window.__DEMO__!.snapshot()), a = s.combat.units.find(u => u.id === 'archer')!, b = s.combat.units.find(u => u.id === id)!;
      // Reuse the normal group recenter button so the recording keeps the moving unit in view.
      if (s.economy.seconds - focusedAt >= .4) { document.querySelector<HTMLButtonElement>('[data-group="0"]')!.click(); focusedAt = s.economy.seconds; }
      if (s.economy.seconds - sampled >= .1) {
        sampled = s.economy.seconds;
        const end = s.pathGuidance.visible ? s.pathGuidance.endpoint : undefined, route = a.route.at(-1);
        result.samples.push({ time: sampled, x: a.position.x, z: a.position.z, speed: a.speed, hp: b.hp,
          endError: end ? Math.hypot(end.x - b.position.x, end.z - b.position.z) : undefined,
          routeError: route ? Math.hypot(route.x - b.position.x, route.z - b.position.z) : undefined,
          pose: s.residents.find(r => r.id === 'archer')!.modelPose });
      }
      if (b.hp < 65) { result.done = true; return; }
      requestAnimationFrame(observe);
    }; requestAnimationFrame(observe);
  }, { save, id: foe.id });
  const errors = await openGame(page);
  await page.mouse.move(page.viewportSize()!.width / 2, page.viewportSize()!.height / 2);
  // Exact mouse-wheel detents zoom; a large pixel scroll is a trackpad pan.
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await snapshot(page)).selection.resident).toBe('archer');
  await page.waitForFunction(() => window.__ATTACK_MOTION__!.samples.some(s => s.time >= 13));
  await page.screenshot({ path: info.outputPath('attack-route-moving.png') });
  await page.waitForFunction(() => window.__ATTACK_MOTION__?.done, null, { timeout: 100000 });
  await page.locator('#settings').tap();
  const result = await page.evaluate(() => window.__ATTACK_MOTION__!);
  await writeFile(info.outputPath('attack-motion.json'), JSON.stringify(result, null, 2));
  const paths = result.samples.filter(s => s.endError !== undefined);
  expect(paths.length).toBeGreaterThan(8); expect(paths.every(s => s.endError! < .05 && s.routeError! < .05)).toBe(true);
  expect(result.samples.some(s => s.speed > 1)).toBe(true); expect(result.samples.at(-1)!.hp).toBeLessThan(65);
  expect(new Set(result.samples.filter(s => s.speed > 1).map(s => JSON.stringify(s.pose))).size).toBeGreaterThan(8);
  await page.addStyleTag({ content: 'dialog[open]{visibility:hidden} dialog::backdrop{background:transparent;backdrop-filter:none}' });
  await page.screenshot({ path: info.outputPath('attack-route-shot.png') });
  expect(errors).toEqual([]);
});
