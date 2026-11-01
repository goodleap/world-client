import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.REVIEW_ORIGIN || 'http://127.0.0.1:4174';
const out = process.env.REVIEW_OUTPUT || '/workspace/artifacts/scene-optimization';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true });
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(message.text()); } });
  await page.goto(origin); await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.waitForFunction(() => window.__DEMO__?.snapshot().frames > 2 && document.querySelector('#loading').classList.contains('loaded'), null, { timeout: 180000 });
  const result = await page.evaluate(async () => {
    const { EngineStore, Vector3 } = await import('/node_modules/.vite/deps/@babylonjs_core.js');
    const scene = EngineStore.LastCreatedScene, engine = scene.getEngine();
    engine.stopRenderLoop(); scene.animationsEnabled = false;
    window.auditScene = scene;
    for (const group of scene.animationGroups) { group.pause(); if (group.animatables.length) group.goToFrame(group.from); }
    const textures = [];
    for (const t of scene.textures) if (t.getContext) {
      const canvas = t.getContext().canvas;
      textures.push({ name: t.name, png: canvas.toDataURL('image/png'), size: t.getSize() });
    }
    const light = scene.getLightByName('sun'), map = light.getShadowGenerator().getShadowMap();
    let shadowStart = 0, shadowDraws = 0, shadowIndices = 0, shadowTriangles = 0;
    map.onBeforeRenderObservable.add(() => { shadowStart = engine._drawCalls.current; shadowIndices = scene.getActiveIndices(); });
    map.onAfterRenderObservable.add(() => { shadowDraws = engine._drawCalls.current - shadowStart; shadowTriangles = (scene.getActiveIndices() - shadowIndices) / 3; });
    const camera = scene.activeCamera, samples = [];
    for (const zoom of [18, 40, 77]) {
      camera.beta = .76; camera.target.set(3.6, .5, -2);
      camera.orthoTop = zoom; camera.orthoBottom = -zoom;
      camera.orthoLeft = -zoom * engine.getAspectRatio(camera); camera.orthoRight = -camera.orthoLeft;
      for (let i = 0; i < 3; i++) { engine.beginFrame(); scene.render(); engine.endFrame(); }
      samples.push({ zoom, draws: engine._drawCalls.current, triangles: scene.getActiveIndices() / 3, shadowDraws, shadowTriangles, activeMeshes: scene.getActiveMeshes().length });
    }
    const materials = scene.meshes.filter(m => m.isVisible && m.material).map(m => ({ mesh: m.name, material: m.material.name, type: m.material.getClassName(), frozen: m.material.isFrozen, specular: m.subMeshes?.[0]?.materialDefines?.SPECULARTERM }));
    return { samples, materials, textures, loadedTextures: scene.textures.filter(t => t.name.startsWith('woodland-')).map(t => ({ name: t.name, url: t.url, format: t.getInternalTexture()?.format, size: t.getSize(), gamma: t.gammaSpace })),
      colorDetailShader: !!scene.getMaterialByName('meadow')?.pluginManager?.getPlugin('MatteLighting'),
      frozen: scene.meshes.filter(m => m.isWorldMatrixFrozen).length, envelopes: [...new Set(scene.meshes.map(m => m.metadata?.rigEnvelope).filter(Boolean))].map(e => ({ name: e.root.name, radius: e.radius })), renderer: engine.getGlInfo().renderer };
  });
  for (const texture of result.textures) { await writeFile(`${out}/${texture.name}.png`, Buffer.from(texture.png.split(',')[1], 'base64')); delete texture.png; }
  await page.screenshot({ path: `${out}/mobile-far.png` });
  await page.evaluate(() => { const s = window.auditScene, c = s.activeCamera, e = s.getEngine(); c.orthoTop = 18; c.orthoBottom = -18; c.orthoLeft = -18 * e.getAspectRatio(c); c.orthoRight = -c.orthoLeft; s.render(); });
  await page.screenshot({ path: `${out}/mobile-near.png` });
  await writeFile(`${out}/scene.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ samples: result.samples, frozen: result.frozen, envelopes: result.envelopes, errors }));
} finally { await browser.close(); }
