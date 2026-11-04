import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
const out = process.env.TEXTURE_REVIEW_OUTPUT || '/tmp/world-texture-verification'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.goto(process.env.TEXTURE_REVIEW_URL || 'http://127.0.0.1:5176');
  const report = await page.evaluate(async () => {
    const { Engine, Scene, ArcRotateCamera, Vector3, MeshBuilder, StandardMaterial, Texture, Color3 } = await import('/node_modules/.vite/deps/@babylonjs_core.js');
    const { landscapeTexture } = await import('/src/game/landscape-textures.ts');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512; document.body.replaceChildren(canvas);
    const engine = new Engine(canvas, false, { preserveDrawingBuffer: true }), scene = new Scene(engine);
    const camera = new ArcRotateCamera('texture', -Math.PI / 2, Math.PI / 2, 4, Vector3.Zero(), scene);
    camera.mode = 1; camera.orthoLeft = camera.orthoBottom = -1; camera.orthoTop = camera.orthoRight = 1;
    const plane = MeshBuilder.CreatePlane('paint', { size: 2, sideOrientation: 2 }, scene);
    const material = new StandardMaterial('paint', scene); material.disableLighting = true; material.emissiveColor = Color3.White(); plane.material = material;
    const results = [];
    for (const name of ['woodland-ground-colors', 'woodland-meadow-strokes', 'woodland-road-grain', 'woodland-water-ripples']) {
      const original = new Texture(`/terrain/${name}.png`, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE), compressed = landscapeTexture(name, scene);
      const frames = [];
      for (const texture of [original, compressed]) {
        material.diffuseTexture = texture; await scene.whenReadyAsync(); scene.render(); scene.render(); frames.push(await engine.readPixels(0, 0, 512, 512));
      }
      let max = 0, sum = 0, over8 = 0;
      for (let i = 0; i < frames[0].length; i++) { const d = Math.abs(frames[0][i] - frames[1][i]); max = Math.max(max, d); sum += d; if (d > 8) over8++; }
      results.push({ name, max, mean: sum / frames[0].length, channelsOver8: over8, format: compressed.getInternalTexture().format, url: compressed.url, size: compressed.getSize() });
      original.dispose(); compressed.dispose();
    }
    scene.dispose(); engine.dispose(); return results;
  });
  await page.route('**/terrain/*.ktx2*', route => route.abort());
  const fallback = await page.evaluate(async () => {
    const { Engine, Scene } = await import('/node_modules/.vite/deps/@babylonjs_core.js');
    const { landscapeTexture } = await import('/src/game/landscape-textures.ts');
    const canvas = document.createElement('canvas'), engine = new Engine(canvas, false), scene = new Scene(engine);
    const texture = landscapeTexture('woodland-ground-colors', scene);
    const ready = await new Promise(resolve => { const start = performance.now(); const check = () => texture.isReady() ? resolve(true) : performance.now() - start > 15000 ? resolve(false) : setTimeout(check, 20); check(); });
    const result = { ready, url: texture.url, format: texture.getInternalTexture()?.format }; scene.dispose(); engine.dispose(); return result;
  });
  await writeFile(`${out}/comparison.json`, JSON.stringify({ report, fallback }, null, 2)); console.log(JSON.stringify({ report, fallback }));
  if (!fallback.ready || !new URL(fallback.url).pathname.endsWith('.png')) throw new Error('PNG fallback failed');
  if (report.some(r => r.mean > 1)) throw new Error('Compression changed average channel value by more than 1/255');
} finally { await browser.close(); }
