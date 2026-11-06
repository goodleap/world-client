import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { clickGround, openGame, selectUnit, snapshot } from './helpers.ts';
import { initialEconomy } from '../../src/game/economy.ts';

const leaderId = 'farmer-leader';

async function setup(page: Page, automatic: boolean) {
  const state = initialEconomy(); state.steward.enabled = automatic;
  await page.addInitScript(state => {
    if (!localStorage.getItem('world-basic-economy-v1')) localStorage.setItem('world-basic-economy-v1', JSON.stringify(state));
  }, state);
  return openGame(page);
}

async function freezeWorkingLeader(page: Page) {
  // Observe real work and pause through the settings control before a short job
  // can finish between Playwright calls on the cloud software renderer.
  await page.waitForFunction(async id => {
    const state = (await window.__DEMO__!.snapshot());
    if (!state.residents.find(r => r.id === id)?.working
      || !state.economy.tasks.some(t => t.worker === id && t.status === 'working' && t.progress > .1)) return false;
    document.getElementById('settings')!.click(); return true;
  }, leaderId, { timeout: 90_000 });
  await expect.poll(async () => (await snapshot(page)).diagnostics.renderLoops).toBe(0);
}

async function captureWork(page: Page, info: TestInfo, name: string) {
  // Hide only the pause dialog to inspect the already rendered working pose.
  const style = await page.addStyleTag({ content: '#settings-dialog { visibility:hidden } #settings-dialog::backdrop { background:transparent; backdrop-filter:none }' });
  await page.screenshot({ path: info.outputPath(name + '.png'), scale: 'css' });
  await style.evaluate(element => element.parentNode?.removeChild(element));
}

export function checkFarmerLeader(touch = false) {
  test('leader shares the farmer model, dispatches the crew and participates in automatic work', async ({ page }, info) => {
    test.setTimeout(150_000);
    const errors = await setup(page, true);
    const initial = await snapshot(page), farmer = initial.residents.find(r => r.id === 'farmer')!;
    const leader = initial.residents.find(r => r.id === leaderId)!;
    expect(initial.residents.filter(r => r.role === 'farmer')).toHaveLength(3);
    expect(leader).toMatchObject({ role: 'farmer', name: '农民·领头', effects: ['leader'], legacyVisible: false });
    expect(leader.model).toEqual(farmer.model);
    expect(leader.model?.animations).toEqual(expect.arrayContaining(['Walk', 'Run', 'Hammer']));
    expect(leader.bodyRadius).toBe(farmer.bodyRadius);
    expect(leader.humanRigId).not.toBe(farmer.humanRigId);
    await expect(page.locator(`[data-resident="${leaderId}"]`)).toHaveClass(/resident-leader/);
    await expect(page.locator(`[data-resident="${leaderId}"]`)).toHaveText('农民·领头');
    await expect(page.locator('#steward-status')).toHaveCount(0);
    await expect(page.locator(`[data-speaker="${leaderId}"]`)).toContainText('农民，去');
    await expect.poll(async () => (await snapshot(page)).economy.tasks.filter(task => task.worker && ['travelling', 'working', 'delivering'].includes(task.status)).length).toBe(3);
    await freezeWorkingLeader(page);
    const working = await snapshot(page);
    expect(working.residents.find(r => r.id === leaderId)?.motion).toBe('work');
    const job = working.economy.tasks.find(task => task.worker === leaderId && task.status === 'working')!;
    expect(job.progress).toBeGreaterThan(0);
    await info.attach('working-crew', { body: JSON.stringify({ job, residents: working.residents.map(r => ({ id: r.id, role: r.role, effects: r.effects, motion: r.motion })) }, null, 2), contentType: 'application/json' });
    await captureWork(page, info, 'farmer-leader-working-with-crew');
    expect(errors).toEqual([]);
  });

  test('leader accepts movement and direct harvest commands and delivers usable resources', async ({ page }, info) => {
    test.setTimeout(180_000);
    const errors = await setup(page, false);
    await selectUnit(page, leaderId, touch);
    // Longer than one capped simulation tick, so Run is visible even when the
    // software renderer takes a full second between two rendered frames.
    const destination = { x: .2, z: -8 };
    await clickGround(page, destination, touch);
    expect((await snapshot(page)).selection.resident).toBe(leaderId);
    await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === leaderId)!.running).toBe(true);
    await expect.poll(async () => (await snapshot(page)).residents.find(r => r.id === leaderId)!.moveCommand, { timeout: 30_000 }).toBe(false);
    const arrived = (await snapshot(page)).residents.find(r => r.id === leaderId)!.position;
    expect(Math.hypot(arrived.x - destination.x, arrived.z - destination.z)).toBeLessThan(.15);
    expect((await snapshot(page)).selection.resident).toBe(leaderId);
    await expect(page.locator('#resident-name')).toHaveText('农民·领头');
    const plot = (await snapshot(page)).objects.find(object => object.id === 'plot-0')!;
    if (touch) await page.touchscreen.tap(plot.screen.x, plot.screen.y); else await page.mouse.click(plot.screen.x, plot.screen.y);
    expect((await snapshot(page)).selection.resident).toBeUndefined();
    expect((await snapshot(page)).economy.tasks.find(task => task.kind === 'harvest')).toMatchObject({ worker: leaderId, origin: 'manual' });
    await freezeWorkingLeader(page);
    const working = await snapshot(page), actor = working.residents.find(r => r.id === leaderId)!;
    expect(actor.motion).toBe('work'); expect(actor.working).toBe(true);
    await captureWork(page, info, 'farmer-leader-direct-harvest');
    await page.locator('#continue-game').click();
    await expect.poll(async () => (await snapshot(page)).economy.inventory.food, { timeout: 60_000 }).toBe(8);
    expect((await snapshot(page)).economy.tasks.find(task => task.kind === 'harvest')?.status).toBe('done');
    expect(errors).toEqual([]);
  });
}
