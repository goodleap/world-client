import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { selectUnit } from '../tests/e2e/helpers.ts';
import assert from 'node:assert/strict';
const out = process.env.REVIEW_OUTPUT || '/workspace/artifacts/runtime-performance';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 754 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  await page.addInitScript(() => { navigator.clipboard.writeText = async value => { window.copiedPerformance = value; }; });
  await page.goto('http://127.0.0.1:5174/');
  await page.waitForSelector('#loading[data-phase="menu"]');
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.waitForSelector('#loading.loaded', { state: 'attached', timeout: 90000 });
  console.log('Scene ready');
  const readings = [];
  for (const selected of [false, true, false]) {
    if (selected) {
      await selectUnit(page, 'infantry', true);
    } else await page.keyboard.press('Escape');
    const n = await page.evaluate(() => window.__DEMO__.snapshot().frames);
    await page.waitForFunction(n => window.__DEMO__.snapshot().frames > n + 5, n, { timeout: 60000 });
    readings.push(await page.evaluate(() => { const s = window.__DEMO__.snapshot(); return { selected: s.selection.resident, camera: s.camera, performance: s.diagnostics.latest, selection: s.selectionFeedback, rendering: s.rendering }; }));
    console.log(JSON.stringify({ step: readings.length, selected: readings.at(-1).selected }));
    await page.screenshot({ path: `${out}/${selected ? 'selected' : 'unselected'}-${readings.length}.png`, scale: 'css' });
  }
  await page.locator('#settings').click(); await page.locator('#copy-diagnostics').click();
  await page.waitForFunction(() => window.copiedPerformance);
  const copied = await page.evaluate(() => window.copiedPerformance);
  const report = JSON.parse(copied);
  if (report.schema === 2) {
    assert.ok(copied.length < 10000, 'default copy must stay compact');
    const p = report.performance.latest.passes;
    assert.equal(p.main[0] + p.shadow[0] + p.selection[0], p.total[0]);
    assert.equal(p.main[1] + p.shadow[1] + p.selection[1], p.total[1]);
    assert.equal(report.graphics.fps, 60); assert.ok(report.performance.latest.context);
    assert.ok(readings[1].performance.selectionDrawCalls > 0);
    assert.equal(readings[2].performance.selectionDrawCalls, 0);
    assert.ok(readings.every(r => r.performance.context.candidates < 1200));
  }
  assert.equal(readings[1].selected, 'infantry'); assert.deepEqual(errors, []);
  await writeFile(`${out}/log.json`, copied);
  await writeFile(`${out}/readings.json`, JSON.stringify({ readings, errors, logChars: copied.length }, null, 2));
  console.log(JSON.stringify({ readings: readings.map(r => ({ selected: r.selected, drawCalls: r.performance?.drawCalls, triangles: r.performance?.submittedTriangles, shadow: r.performance?.shadowDrawCalls, extraSelection: r.performance?.selectionDrawCalls, candidates: r.performance?.context?.candidates, selection: r.selection })), logChars: copied.length, errors }));
} finally { await browser.close(); }
