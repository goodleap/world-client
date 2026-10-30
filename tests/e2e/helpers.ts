import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export async function openGame(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'menu');
  if (await page.locator('#continue-save').isEnabled()) await page.locator('#continue-save').click();
  else await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('#loading')).toHaveClass(/\bloaded\b/, { timeout: 60_000 });
  // Loading already waits for assets and shaders; two further frames establish
  // the live scene without spending ten software-GPU frames before every test.
  await page.waitForFunction(() => (window.__DEMO__?.snapshot().frames ?? 0) > 2);
  return errors;
}
export async function snapshot(page: Page) { return page.evaluate(() => window.__DEMO__!.snapshot()); }

export async function clickGround(page: Page, point: { x: number; z: number }, touch = false, y = 0) {
  const { camera } = await snapshot(page), viewport = page.viewportSize()!;
  const scale = viewport.height / (2 * camera.zoom);
  const x = viewport.width / 2 + (point.x - camera.target.x) * scale;
  const screenY = viewport.height / 2 + ((camera.target.y - y) * Math.sin(camera.beta) - (point.z - camera.target.z) * Math.cos(camera.beta)) * scale;
  if (touch) await page.touchscreen.tap(x, screenY); else await page.mouse.click(x, screenY);
}

export async function selectUnit(page: Page, id: string, touch = false) {
  const unit = (await snapshot(page)).residents.find(r => r.id === id)!;
  await clickGround(page, unit.position, touch, id === 'dog' ? .65 : id === 'cavalry' ? 1.6 : 1);
  await expect.poll(async () => (await snapshot(page)).selection.resident).toBe(id);
}
