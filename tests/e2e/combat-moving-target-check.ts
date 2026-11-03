import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { Economy, encodeEconomy, decodeEconomy } from '../../src/game/economy.ts';
import { createFighter, fighterStats, fighterRadius } from '../../src/game/combat.ts';
import { newResident } from '../../src/game/resident-data.ts';
import { initialVital } from '../../src/game/vitals.ts';
import { ECONOMY_SAVE_KEY } from '../../src/game/economy-storage.ts';
import { snapshot } from './helpers.ts';
import { economyObstacles } from '../../src/game/economy-config.ts';
import { GRID_SIZE, WORLD_BOUNDS } from '../../src/game/world-data.ts';
import { segmentIsClear } from '../../src/game/wander.ts';
import { findPath } from '../../src/game/pathfinding.ts';
import { isBlocked } from '../../src/game/movement.ts';

type Hit = { seconds: number; hp: number; x: number; z: number };
declare global { interface Window { __RETURN_COMBAT__?: { hits: Record<string, Hit>; paused: boolean } } }

export async function checkReturningTargets(page: Page, info: TestInfo, role: 'infantry' | 'cavalry' | 'archer') {
  const e = new Economy(); e.setLeadership(false); e.state.seconds = 10; e.state.raids.nextAt = 600;
  // Isolate each duel so other soldiers cannot get the hit on its behalf.
  for (const u of e.state.combat.units) { u.life = 'defeated'; u.hp = 0; u.diedAt = 0; }
  for (const v of Object.values(e.state.vitals)) if (v.hp !== undefined) { v.hp = 0; v.diedAt = 0; }
  e.state.vitals.horse.hp = 160; e.state.vitals.horse.diedAt = undefined;
  for (const w of e.state.raids.wildWolves) { w.life = 'defeated'; w.hp = 0; w.diedAt = 0; w.settled = true; }
  for (const camp of e.state.combat.camps) { camp.cleared = camp.rewardGranted = camp.discovered = true; }
  e.state.combat.cleared = e.state.combat.rewardGranted = e.state.combat.discovered = true;
  const stats = fighterStats({ role, team: 'home' });
  const corridors = [{ id: role, start: { x: 4, z: -1 }, home: { x: -20, z: -1 },
    actor: { x: 4 + stats.range + .1, z: -1 }, radius: fighterRadius({role}) }];
  const solids = [...economyObstacles([], []), ...e.state.plots.map(p => ({ kind: 'box' as const, x: p.x, z: p.z, halfWidth: GRID_SIZE / 2, halfDepth: GRID_SIZE / 2 }))];
  const targets = corridors.map(({ id, start, home, actor: position, radius }, i) => {
    expect(isBlocked(position, radius, solids)).toBe(false);
    const route = findPath(start, home, .4, WORLD_BOUNDS, solids);
    expect(route).toBeDefined();
    expect(segmentIsClear(start, route![0], .4, WORLD_BOUNDS, solids)).toBe(true);
    const enemyId = `enemy-raid-infantry-1-${i}`;
    const target = createFighter(newResident('infantry', enemyId, home));
    target.position = { ...start }; target.goal = { ...home }; target.route = route!; target.order = 'hold'; target.cooldown = 8;
    e.state.combat.units.push(target); e.state.vitals[target.id] = initialVital(target.id);
    const actor = e.state.combat.units.find(u => u.id === id)!;
    actor.hp = fighterStats(actor).hp; actor.life = 'active'; actor.diedAt = undefined;
    actor.position = { ...position }; actor.order = 'attack'; actor.target = enemyId;
    return { id: enemyId, home, hp: target.hp, start: { ...target.position } };
  });
  e.state.raids.phase = 'raid'; e.state.raids.wave = 1; e.state.raids.startedAt = e.state.seconds;
  e.state.raids.soldiers = targets.map(t => t.id); e.state.raids.origin = { ...targets[0].home };
  const save = encodeEconomy(e); decodeEconomy(save);
  await page.addInitScript(({ key, save, targets }) => {
    localStorage.setItem(key, save);
    const result: NonNullable<Window['__RETURN_COMBAT__']> = { hits: {}, paused: false };
    window.__RETURN_COMBAT__ = result;
    const observe = () => {
      const state = window.__DEMO__?.snapshot();
      if (state) {
        for (const expected of targets) {
          const unit = state.combat.units.find(u => u.id === expected.id)!;
          if (unit.hp < expected.hp && !result.hits[expected.id])
            result.hits[expected.id] = { seconds: state.economy.seconds, hp: unit.hp, ...unit.position };
        }
        if (targets.every(t => result.hits[t.id])) {
          // Pause through the actual UI before slower screenshots let the
          // return finish. No game state or simulation clock is injected.
          document.querySelector<HTMLButtonElement>('#settings')!.click(); result.paused = true; return;
        }
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }, { key: ECONOMY_SAVE_KEY, save, targets });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.locator('#continue-save').click();
  await expect(page.locator('#loading')).toHaveClass(/loaded/, { timeout: 90000 });
  await page.waitForFunction(() => window.__RETURN_COMBAT__?.paused, null, { timeout: 40000 });
  const result = await page.evaluate(() => window.__RETURN_COMBAT__!);
  for (const target of targets) {
    const hit = result.hits[target.id];
    expect(hit.hp).toBeLessThan(target.hp);
    expect(Math.hypot(hit.x - target.start.x, hit.z - target.start.z)).toBeGreaterThan(.1);
    expect(Math.hypot(hit.x - target.home.x, hit.z - target.home.z)).toBeGreaterThan(2);
  }
  const frozen = await snapshot(page); await page.waitForTimeout(300);
  expect((await snapshot(page)).combat).toEqual(frozen.combat);
  for (const id of [role])
    expect((await snapshot(page)).residents.find(r => r.id === id)!.modelPose).toEqual(frozen.residents.find(r => r.id === id)!.modelPose);
  await writeFile(info.outputPath('returning-target-hits.json'), JSON.stringify(result, null, 2));
  // Expose the frozen world for visual review while keeping the game paused.
  await page.addStyleTag({ content: 'dialog[open] { visibility: hidden; } dialog::backdrop { background: transparent; backdrop-filter: none; }' });
  await page.screenshot({ path: info.outputPath('returning-targets.png') });
  expect(errors).toEqual([]);
}
