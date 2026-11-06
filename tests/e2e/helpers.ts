import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { surfaceHeight } from '../../src/game/terrain-height.ts';
export async function openGame(page: Page, url = '/') {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
  if (await page.locator('#continue-save').isEnabled()) await page.locator('#continue-save').click();
  else await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('#loading')).toHaveClass(/\bloaded\b/, { timeout: 60_000 });
  // Loading already waits for assets and shaders; two further frames establish
  // the live scene without spending ten software-GPU frames before every test.
  await page.waitForFunction(async () => ((await window.__DEMO__?.snapshot())?.frames ?? 0) > 2);
  return errors;
}
export async function snapshot(page: Page) { return page.evaluate(async () => (await window.__DEMO__!.snapshot())); }

export async function clickGround(page: Page, point: { x: number; z: number }, touch = false, y = surfaceHeight(point.x,point.z)) {
  const { camera } = await snapshot(page), viewport = page.viewportSize()!;
  const scale = viewport.height / (2 * camera.zoom);
  const x = viewport.width / 2 + (point.x - camera.target.x) * scale;
  const screenY = viewport.height / 2 + ((camera.target.y - y) * Math.sin(camera.beta) - (point.z - camera.target.z) * Math.cos(camera.beta)) * scale;
  if (touch) await page.touchscreen.tap(x, screenY); else await page.mouse.click(x, screenY);
}

export async function selectUnit(page: Page, id: string, touch = false) {
  // Sample and click again only if the previous tap missed a moving unit.
  // The selection guard avoids turning a successful retry into a deselection.
  await expect(async () => {
    const state = await snapshot(page); if (state.selection.resident === id) return;
    const unit = state.residents.find(r => r.id === id)!;
    await clickGround(page, unit.position, touch, surfaceHeight(unit.position.x,unit.position.z)+(id === 'dog' ? .65 : id === 'cavalry' ? 1.6 : 1));
    expect((await snapshot(page)).selection.resident).toBe(id);
  }).toPass({ timeout: 15_000 });
}

/** Discover the outskirts through the same map drag available to the player. */
export async function panTo(page: Page, point: { x: number; z: number }, touch = false) {
  const viewport = page.viewportSize()!, cx = viewport.width / 2, cy = viewport.height / 2;
  const session = touch ? await page.context().newCDPSession(page) : undefined;
  for (let i = 0; i < 20; i++) {
    const { camera } = await snapshot(page), scale = viewport.height / (2 * camera.zoom);
    if (Math.hypot(camera.target.x - point.x, camera.target.z - point.z) < .4) return;
    const dx = Math.max(-cx + 45, Math.min(cx - 45, (camera.target.x - point.x) * scale));
    const dy = Math.max(-cy + 120, Math.min(cy - 120, (point.z - camera.target.z) * Math.cos(camera.beta) * scale));
    // A final sub-threshold touch becomes a tap, not a pan. Projection helpers
    // use the actual camera, so exact centering is unnecessary for picking.
    if (Math.hypot(dx, dy) < 10) { await session?.detach(); return; }
    if (session) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx, y: cy + dy }] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + dx, cy + dy, { steps: 3 }); await page.mouse.up();
    }
    await expect.poll(async () => { const next = (await snapshot(page)).camera.target; return Math.hypot(next.x - camera.target.x, next.z - camera.target.z); }).toBeGreaterThan(.01);
  }
  throw new Error('map drag did not reach the target');
}
