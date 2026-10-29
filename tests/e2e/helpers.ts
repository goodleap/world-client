import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export async function openGame(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await expect(page.locator('#loading')).toHaveClass(/\bloaded\b/, { timeout: 60_000 });
  await page.waitForFunction(() => (window.__DEMO__?.snapshot().frames ?? 0) > 10);
  return errors;
}
export async function snapshot(page: Page) { return page.evaluate(() => window.__DEMO__!.snapshot()); }
