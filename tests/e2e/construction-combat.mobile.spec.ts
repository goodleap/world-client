import { test, expect } from '@playwright/test';
import { Economy, encodeEconomy, decodeEconomy } from '../../src/game/economy.ts';
import { ENEMIES } from '../../src/game/resident-data.ts';
import { openGame, snapshot, clickGround, panTo } from './helpers.ts';

test.use({ video: 'on' });

type CombatSample = { t: number; life: 'active' | 'defeated'; target?: string; attack?: number; hp: number; farHp: number; x: number; z: number };
declare global { interface Window { __CLOSE_COMBAT__?: { samples: CombatSample[]; done: boolean } } }

function quietWorld() {
  const e = new Economy(); e.setLeadership(false); e.state.seconds = 10; e.state.raids.nextAt = 1000;
  e.state.inventory = { wood: 200, stone: 200, food: 24, iron: 0 };
  for (const u of e.state.combat.units) {
    if (u.team === 'enemy') { u.hp = 0; u.life = 'defeated'; u.diedAt = 0; }
    else u.position = { x: -3 - e.state.combat.units.indexOf(u) * 2, z: -10 };
  }
  for (const [i, id] of ['farmer', 'farmer-2', 'farmer-leader', 'dog'].entries()) e.state.residents[id] = { position: { x: -2 - i * 2, z: -8 } };
  for (const w of e.state.raids.wildWolves) { w.life = 'defeated'; w.hp = 0; w.diedAt = 0; w.settled = true; }
  for (const camp of e.state.combat.camps) camp.cleared = camp.rewardGranted = camp.discovered = true;
  e.state.combat.cleared = e.state.combat.rewardGranted = e.state.combat.discovered = true;
  return e;
}

test('touch construction accepts entrance blockage and a corridor, but rejects physical terrain', async ({ page }) => {
  test.setTimeout(180_000);
  const e = quietWorld(), save = encodeEconomy(e); decodeEconomy(save);
  await page.addInitScript(save => { localStorage.setItem('world-basic-economy-v1', save); localStorage.setItem('world-shadows-enabled', 'false'); }, save);
  const errors = await openGame(page);
  await page.locator('#building-toggle').tap(); await page.locator('#build-tower').tap();
  await clickGround(page, { x: 4.2, z: 1.2 }, true);
  await expect.poll(async () => (await snapshot(page)).economy.sites.length).toBe(1);
  await expect(page.locator('#target-hint')).toContainText('仍可建造');
  expect((await snapshot(page)).placement.active).toBe(false);
  await panTo(page, { x: -28, z: 8 }, true);
  await page.locator('#building-toggle').tap(); await page.locator('#build-house').tap();
  await clickGround(page, { x: -28, z: 8 }, true);
  await expect.poll(async () => (await snapshot(page)).economy.sites.length).toBe(2);
  expect((await snapshot(page)).economy.tasks.filter(t => t.kind === 'build').every(t => t.origin === 'manual')).toBe(true);
  await panTo(page, { x: 0, z: 40 }, true);
  await page.locator('#building-toggle').tap(); await page.locator('#build-house').tap();
  await clickGround(page, { x: 0, z: 40 }, true);
  await expect(page.locator('#target-hint')).toContainText('地面');
  expect((await snapshot(page)).economy.sites).toHaveLength(2);
  expect((await snapshot(page)).placement.active).toBe(true);
  expect(errors).toEqual([]);
});

test('live enemy stops chasing a distant archer and completes repeated attacks on the nearby soldier', async ({ page }) => {
  test.setTimeout(150_000);
  const e = quietWorld(), enemy = e.state.combat.units.find(u => u.id === 'enemy-guard')!;
  const archer = e.state.combat.units.find(u => u.id === 'archer')!, infantry = e.state.combat.units.find(u => u.id === 'infantry')!;
  const cavalry = e.state.combat.units.find(u => u.id === 'cavalry')!;
  cavalry.life = 'defeated'; cavalry.hp = 0; cavalry.diedAt = 0;
  enemy.life = 'active'; enemy.hp = 65; enemy.diedAt = undefined; enemy.position = { x: -10, z: -6 };
  enemy.order = 'guard'; enemy.target = archer.id; enemy.provoked = { from: { ...enemy.position }, leash: 30 };
  archer.position = { x: -21, z: -6 }; infantry.position = { x: -8.6, z: -6 };
  infantry.order = 'attack'; infantry.target = enemy.id; e.state.groups[0] = [infantry.id];
  const camp = e.state.combat.camps.find(c => c.id === ENEMIES.find(u => u.id === enemy.id)!.camp)!;
  camp.cleared = camp.rewardGranted = false; e.state.combat.cleared = e.state.combat.rewardGranted = false;
  const save = encodeEconomy(e); decodeEconomy(save);
  // Observe from the first playable frame so loading and camera taps do not
  // consume the encounter before a slow software renderer begins sampling.
  await page.addInitScript(save => {
    localStorage.setItem('world-basic-economy-v1', save); localStorage.setItem('world-shadows-enabled', 'false');
    const result: NonNullable<Window['__CLOSE_COMBAT__']> = window.__CLOSE_COMBAT__ = { samples: [], done: false };
    let start: number | undefined;
    const observe = async () => {
      if (!window.__DEMO__) { requestAnimationFrame(observe); return; }
      const s = (await window.__DEMO__!.snapshot()), enemy = s.combat.units.find(u => u.id === 'enemy-guard')!;
      if (start === undefined) {
        start = s.economy.seconds;
        const group = document.querySelector<HTMLButtonElement>('[data-group="0"]')!; group.click(); group.click();
      }
      if (!result.samples.length || s.economy.seconds - result.samples.at(-1)!.t >= .1) result.samples.push({ t: s.economy.seconds, life: enemy.life,
        target: enemy.target, attack: enemy.attack?.id, hp: s.combat.units.find(u => u.id === 'infantry')!.hp,
        farHp: s.combat.units.find(u => u.id === 'archer')!.hp, x: enemy.position.x, z: enemy.position.z });
      if (s.economy.seconds - start >= 4) result.done = true; else requestAnimationFrame(observe);
    }; observe();
  }, save);
  const errors = await openGame(page);
  await page.waitForFunction(() => window.__CLOSE_COMBAT__?.done);
  const samples = await page.evaluate(() => window.__CLOSE_COMBAT__!.samples);
  expect(samples.length).toBeGreaterThan(3);
  const fighting = samples.slice(1).filter(s => s.life === 'active');
  expect(fighting.length).toBeGreaterThanOrEqual(2);
  expect(fighting.every(s => s.target === 'infantry')).toBe(true);
  expect(samples.filter(s => s.life === 'defeated').every(s => !s.target && !s.attack)).toBe(true);
  expect(samples.every(s => s.farHp === 110)).toBe(true);
  expect(samples.at(-1)!.hp).toBeLessThan(samples[0].hp);
  expect(new Set(samples.map(s => s.attack).filter(Boolean)).size).toBeGreaterThanOrEqual(2);
  expect(samples.every(s => Math.hypot(s.x + 10, s.z + 6) < .2)).toBe(true);
  expect(errors).toEqual([]);
});
