import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function openGame(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass('loading loaded', { timeout: 45_000 });
  await page.waitForFunction(() => (window.__DEMO__?.snapshot().frames ?? 0) > 10);
  const state = await snapshot(page);
  expect(Number.isFinite(state.player.x)).toBe(true);
  expect(Number.isFinite(state.player.z)).toBe(true);
  return errors;
}

export async function snapshot(page: Page) {
  return page.evaluate(() => window.__DEMO__!.snapshot());
}

export async function moveUntil(page: Page, key: string, axis: 'x' | 'z', target: number, positive: boolean) {
  await page.locator('#game').focus();
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(({ axis, target, positive }) => {
      const position = window.__DEMO__!.snapshot().player[axis];
      return positive ? position >= target : position <= target;
    }, { axis, target, positive }, { timeout: 30_000 });
  } finally { await page.keyboard.up(key); }
}
