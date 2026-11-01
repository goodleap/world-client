import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { initialEconomy } from '../src/game/economy.ts';

const base = process.env.CAPTURE_URL || 'http://127.0.0.1:4175';
const output = process.env.CAPTURE_OUTPUT || '/tmp/world-map-capture';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const cases = [
  { name: 'desktop-home' }, { name: 'desktop-wide', zoom: 48 },
  { name: 'mobile-home', mobile: true }, { name: 'mobile-shore', mobile: true, center: { x: 25, z: 14 } },
  { name: 'mobile-full', mobile: true, zoom: 168, center: { x: 0, z: 0 } },
];
const chosen = process.argv.slice(2), results = [];
try {
  for (const view of cases.filter(c => !chosen.length || chosen.includes(c.name))) {
    const { name, mobile = false } = view;
    const context = await browser.newContext({ viewport: mobile ? { width: 393, height: 754 } : { width: 1280, height: 900 },
      isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
    const state = initialEconomy(); state.steward.enabled = false;
    await context.addInitScript(state => localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)), state);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      await page.goto(base + '/');
      await page.locator('#loading[data-phase="menu"]').waitFor();
      await page.locator('#continue-save').click();
      await page.waitForFunction(() => window.__DEMO__?.snapshot().frames > 3, null, { timeout: 90000 });
      if (view.zoom) {
        // Exercise normal wheel events, with no camera overrides or review mode.
        await page.evaluate(target => {
          const zoom = window.__DEMO__.snapshot().camera.zoom;
          const steps = Math.ceil((target - zoom) / 4.2);
          for (let i = 0; i < steps; i++) document.querySelector('#game').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true }));
        }, view.zoom);
        await page.waitForTimeout(220);
      }
      if (view.center) {
        const s = await page.evaluate(() => window.__DEMO__.snapshot()), viewport = page.viewportSize();
        const units = 2 * s.camera.zoom / viewport.height;
        await page.locator('#game').dispatchEvent('wheel', {
          deltaX: (view.center.x - s.camera.target.x) / units,
          deltaY: -(view.center.z - s.camera.target.z) * Math.cos(s.camera.beta) / units, deltaMode: 0,
        });
      }
      const frame = await page.evaluate(() => window.__DEMO__.snapshot().frames);
      await page.waitForFunction(previous => window.__DEMO__.snapshot().frames > previous + 4, frame, { timeout: 90000 });
      // Preserve the actual UI, characters, materials and shadows in every image.
      await page.screenshot({ path: `${output}/${name}.png`, scale: 'css' });
      const s = await page.evaluate(() => window.__DEMO__.snapshot());
      const result = { name, camera: s.camera, lighting: s.lighting, renderer: s.diagnostics.renderer,
        performance: s.diagnostics.latest, rendering: s.rendering, trees: s.objects.filter(o => o.kind === 'tree').length,
        rocks: s.objects.filter(o => o.kind === 'rock').length,
        shadows: { enabled: s.shadows.enabled, size: s.shadows.mapSize, lodCamera: s.shadows.lodCamera }, errors };
      results.push(result);
      await writeFile(`${output}/${name}.json`, JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ name, triangles: result.performance?.submittedTriangles,
        shadowTriangles: result.performance?.shadowTriangles, drawCalls: result.performance?.drawCalls, errors }));
    } catch (error) {
      await page.screenshot({ path: `${output}/${name}-failure.png` });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${output}/measurements.json`, JSON.stringify(results, null, 2));
