import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { initialEconomy } from '../../src/game/economy.ts';

const base = process.env.REVIEW_URL || 'http://127.0.0.1:4174';
const output = process.env.REVIEW_OUTPUT || '/workspace/artifacts/landscape-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const cases = [
  ['before-home', '', false], ['home', '?landscape=preview', false],
  ['before-mobile', '', true],
  ['wide', '?landscape=preview&view=wide', false], ['shore', '?landscape=preview&view=shore', false],
  ['mobile-home', '?landscape=preview', true], ['mobile-shore', '?landscape=preview&view=shore', true],
  ['mobile-wide', '?landscape=preview&view=wide', true],
];
const chosen = process.argv.slice(2), results = [];
try {
  for (const [name, query, mobile] of cases.filter(c => !chosen.length || chosen.includes(c[0]))) {
    const context = await browser.newContext({ viewport: mobile ? { width: 393, height: 754 } : { width: 1280, height: 900 },
      isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
    const state = initialEconomy(); state.steward.enabled = false;
    await context.addInitScript(({ state, key }) => localStorage.setItem(key, JSON.stringify(state)),
      { state, key: query ? 'world-landscape-review-v1' : 'world-basic-economy-v1' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.goto(base + '/' + query);
      await page.locator('#loading[data-phase="menu"]').waitFor();
      await page.locator('#continue-save').click();
      await page.waitForFunction(() => window.__DEMO__?.snapshot().frames > 12, null, { timeout: 90000 });
      // Capture the rendered game without hiding UI or replacing assets.
      await page.screenshot({ path: `${output}/${name}.png`, scale: 'css' });
      const s = await page.evaluate(() => window.__DEMO__.snapshot());
      const result = { name, camera: s.camera, renderer: s.diagnostics.renderer, performance: s.diagnostics.latest, rendering: s.rendering,
        shadows: { enabled: s.shadows.enabled, size: s.shadows.mapSize, lodCamera: s.shadows.lodCamera }, errors, saveIsolated: await page.evaluate(() => ({
          main: localStorage.getItem('world-basic-economy-v1') !== null,
          review: localStorage.getItem('world-landscape-review-v1') !== null,
        })) };
      await writeFile(`${output}/${name}.json`, JSON.stringify(result, null, 2));
      results.push(result);
      console.log(JSON.stringify({ name, triangles: result.performance?.submittedTriangles, shadowTriangles: result.performance?.shadowTriangles,
        drawCalls: result.performance?.drawCalls, errors }));
    } catch (error) {
      console.log(name, await page.locator('body').innerText(), errors);
      await page.screenshot({ path: `${output}/${name}-failure.png` });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${output}/measurements.json`, JSON.stringify(results, null, 2));
