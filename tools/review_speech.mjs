// Isolated layout checks using the real UI module and CSS; no game state mocks.
// Start the Vite development/review server, then node tools/review_speech.mjs.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.argv[2] || '/tmp/speech-layout';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage(), records = [];
await page.goto(process.env.REVIEW_BASE || 'http://127.0.0.1:5174');
for (const width of [320, 393, 1280]) {
  await page.setViewportSize({ width, height: width === 1280 ? 900 : 568 });
  records.push(...await page.evaluate(async () => {
    const { createUI } = await import('/src/ui.ts'), app = document.querySelector('#app');
    window.speechReview?.dispose();
    const ui = createUI(app); window.speechReview = ui;
    for (const node of [...app.children]) if (!['game', 'resident-labels'].includes(node.id)) node.remove();
    app.style.background = '#a5b789';
    const width = innerWidth, height = innerHeight, results = [];
    for (const [index, [x, y]] of [[40, 60], [width - 40, 60], [40, height - 60], [width - 40, height - 60]].entries()) {
      const id = `edge-${index}`, label = ui.addResidentLabel(id, '领头', true);
      // Larger text produces a different actual name height.
      if (index > 1) label.style.fontSize = '18px';
      label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      ui.sayResident(id, '收获后送回仓库', 100); ui.positionSpeech(id, x, y, true);
      const bubble = app.querySelector(`[data-speaker="${id}"]`), b = bubble.getBoundingClientRect(), n = label.getBoundingClientRect();
      if (bubble.hidden || b.left < 7 || b.right > width - 7 || !(b.bottom + 6 <= n.top || b.top >= n.bottom + 6)) throw new Error(`Speech overlaps or clips: ${width}/${index}`);
      results.push({ width, index, nameHeight: n.height, gap: b.bottom < n.top ? n.top - b.bottom : b.top - n.bottom });
    }
    return results;
  }));
  await page.screenshot({ path: `${output}/speech-edges-${width}.png` });
}
await browser.close(); await writeFile(`${output}/measurements.json`, JSON.stringify(records, null, 2));
console.log(`PASS: ${records.length} edge placements, actual name heights and tail gaps.`);
