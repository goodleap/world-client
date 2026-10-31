import { test, expect } from '@playwright/test';
import { initialEconomy } from '../../src/game/economy.ts';
import { openGame, snapshot } from './helpers.ts';

test('adjacent farmers resume an old shared destination and both arrive without blocking one another', async ({ page }, info) => {
  await page.setViewportSize({ width: 393, height: 754 });
  const state = initialEconomy(); state.steward.enabled = false;
  state.residents = {
    farmer: { position: { x: -.31, z: -8 }, manualGoal: { x: .3, z: -1.8 } },
    'farmer-2': { position: { x: .31, z: -8 }, manualGoal: { x: .3, z: -1.8 } },
  };
  await page.addInitScript(state => localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)), state);
  const errors = await openGame(page);
  const trace = await page.evaluate(() => new Promise<{ positions: { x: number; z: number }[]; commands: boolean[]; seconds: number }[]>(resolve => {
    const trace: { positions: { x: number; z: number }[]; commands: boolean[]; seconds: number }[] = [];
    let frame = -1;
    const check = () => {
      const s = window.__DEMO__!.snapshot();
      if (s.frames !== frame) {
        frame = s.frames;
        const farmers = s.residents.filter(r => r.role === 'farmer');
        trace.push({ positions: farmers.map(r => r.position), commands: farmers.map(r => r.moveCommand), seconds: s.simulationSeconds });
        if (farmers.every(r => !r.moveCommand)) { resolve(trace); return; }
      }
      requestAnimationFrame(check);
    };
    check();
  }));
  for (const sample of trace) {
    const [a, b] = sample.positions;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(.58 - 1e-8);
  }
  const arrived = (await snapshot(page)).residents.filter(r => r.role === 'farmer');
  expect(arrived.every(r => !r.moveCommand && !r.routeRemaining)).toBe(true);
  for (const farmer of arrived) expect(Math.hypot(farmer.position.x - .3, farmer.position.z + 1.8)).toBeLessThan(.7);
  expect(trace.at(-1)!.seconds).toBeLessThan(15);
  await page.screenshot({ path: info.outputPath('farmers-arrived-mobile.png') });
  await info.attach('traffic-trace', { body: JSON.stringify(trace), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
