import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('lazy scene modules share the prepared context without importing the worker entry', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const entry = new URL(url, location.href);
        // Reproduce WebKit's distinct worker-entry/module identities in Chromium:
        // a lazy import of the unqualified entry would evaluate its state again.
        if (/\/render\.worker-[^/]+\.js$/.test(entry.pathname)) entry.searchParams.set('startup-test', 'entry');
        super(entry, options);
      }
    };
  });
  const errors = await openGame(page);
  await expect(page.locator('#loading')).toHaveAttribute('data-phase', 'playing');
  expect(page.workers().some(worker => new URL(worker.url()).searchParams.get('startup-test') === 'entry')).toBe(true);
  await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(2);
  const state = await snapshot(page);
  expect(state.residents.length).toBeGreaterThan(0);
  expect(state.objects.some(object => object.kind === 'tree')).toBe(true);
  expect(errors).toEqual([]);
});
