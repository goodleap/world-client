import { test, expect } from '@playwright/test';
import { openGame, snapshot } from './helpers.ts';

test('environment updates load a fingerprinted model instead of the stale public URL', async ({ page }) => {
  const models:string[]=[];let staleRequests=0;
  page.on('request',request=>{if(/environment[^/]*\.glb$/.test(request.url()))models.push(request.url());});
  // A browser/CDN may retain the previous GLB at this URL. The new loader
  // must work without reading it, even when that legacy endpoint is unusable.
  await page.route('**/assets/environment/environment.glb',route=>{
    staleRequests++;return route.fulfill({status:410,body:'outdated environment model'});
  });
  const errors=await openGame(page);
  expect(staleRequests).toBe(0);
  expect(models).toHaveLength(1);
  expect(models[0]).toMatch(/\/assets\/environment-[\w-]+\.glb$/);
  const trees=(await snapshot(page)).objects.filter(object=>object.kind==='tree');
  expect(trees.length).toBeGreaterThan(100);
  expect([...new Set(trees.map(tree=>tree.name))].sort()).toEqual(['松树','树木']);
  expect(errors).toEqual([]);
});
