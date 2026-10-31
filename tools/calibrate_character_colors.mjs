import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const input = process.argv[2];
if (!input) throw new Error('Provide a sampled target JSON from the private design repository');
const targets = JSON.parse(await readFile(input, 'utf8'));
if (targets.role !== 'base' || targets.view !== 'front' || targets.lighting !== 'game') throw new Error('This fixture calibrates the base human front under game daylight');
const output = process.env.CALIBRATION_OUTPUT || '/workspace/artifacts/color-calibration';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 480 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto((process.env.REVIEW_ORIGIN || 'http://127.0.0.1:5174') + '/studies/calibration.html');
  await page.waitForFunction(() => window.calibration, { timeout: 60000 });
  await page.screenshot({ path: `${output}/baseline.png` });
  const context = await page.evaluate(() => window.calibration.describe());
  const results = [];
  for (const material of targets.materials) {
    const result = await page.evaluate(target => window.calibration.fit(target), material);
    results.push(result);
    console.log(JSON.stringify({ material: result.material, before: result.baseline.error, after: result.candidate.error,
      albedo: result.candidateAlbedoSRGB, evaluations: result.evaluations, boundary: result.parameterBoundary }));
  }
  await page.evaluate(results => window.calibration.preview(results), results);
  await page.screenshot({ path: `${output}/candidate-not-approved.png` });
  await writeFile(`${output}/calibration.json`, JSON.stringify({ targets, context, results, errors, appliedToGame: false }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
