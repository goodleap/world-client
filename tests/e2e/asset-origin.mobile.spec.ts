import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { openGame, snapshot } from './helpers.ts';

test('the complete game loads with all cross-origin HTTP requests blocked', async ({ page, context, baseURL }, info) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [], requests: { path: string; status: number }[] = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
      external.push(url.href); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page.on('response', response => requests.push({ path: new URL(response.url()).pathname, status: response.status() }));
  const errors = await openGame(page);
  expect((await snapshot(page)).residents).toHaveLength(7);
  expect(external).toEqual([]);
  expect(requests.filter(request => request.path.endsWith('.glb'))).toHaveLength(10);
  expect(requests.filter(request => request.path.endsWith('.env'))).toHaveLength(1);
  expect(requests.every(request => request.status < 400)).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(info.outputPath('network-audit.json'), JSON.stringify({ external, requests }, null, 2));
});
