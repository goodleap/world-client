// Run against a local Vite dev server. Capture real WebGL submissions with
// native tree LOD enabled/disabled, then compare a single tree at fixed views.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { initialEconomy } from '../src/game/economy.ts';

const origin = process.env.REVIEW_ORIGIN || 'http://127.0.0.1:5174';
const output = process.env.REVIEW_OUTPUT || '/workspace/artifacts/tree-lod';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const errors = [], reports = [];
try {
  const devices = process.env.REVIEW_DEVICE === 'desktop' ? [false] : process.env.REVIEW_DEVICE === 'mobile' ? [true] : [true, false];
  for (const mobile of devices) {
    const label = mobile ? 'mobile' : 'desktop';
    const page = await browser.newPage({ viewport: mobile ? { width: 393, height: 754 } : { width: 1280, height: 900 },
      deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', error => errors.push(error.message));
    const state = initialEconomy(); state.steward.enabled = false;
    await page.addInitScript(state => localStorage.setItem('world-basic-economy-v1', JSON.stringify(state)), state);
    // Test-only access to this page's scene; production code has no such hook.
    await page.route('**/src/game/game.ts', async route => {
      const response = await route.fetch(), body = await response.text();
      assert(body.includes('canSave = true;'));
      await route.fulfill({ response, body: body.replace('canSave = true;', 'canSave = true; window.__treeReview = { scene, engine, camera, shadows, world, economy };') });
    });
    await page.goto(origin); await page.locator('#continue-save').click();
    await page.waitForFunction(() => window.__treeReview && window.__DEMO__?.snapshot().frames > 2, {}, { timeout: 90000 });
    await page.locator('#settings').click();
    await page.waitForFunction(() => window.__DEMO__.snapshot().diagnostics.renderLoops === 0);
    await page.locator('#settings-dialog').evaluate(element => { element.style.visibility = 'hidden'; });
    await page.evaluate(() => {
      const r = window.__treeReview, { scene, engine, camera, shadows } = r;
      scene.animationsEnabled = false;
      r.sources = scene.meshes.filter(mesh => mesh.name.startsWith('economy-template-tree-') && mesh.getLODLevels?.().length);
      r.levels = r.sources.flatMap(source => source.getLODLevels().map(level => ({ level, coverage: level.distanceOrScreenCoverage })));
      r.setLOD = enabled => r.levels.forEach(({ level, coverage }) => { level.distanceOrScreenCoverage = enabled ? coverage : 0; });
      r.project = (zoom, x = -.803440484, y = .5, z = 1.945760098) => {
        const aspect = engine.getRenderWidth() / engine.getRenderHeight();
        camera.target.set(x, y, z); camera.orthoTop = zoom; camera.orthoBottom = -zoom;
        camera.orthoRight = zoom * aspect; camera.orthoLeft = -zoom * aspect;
      };
      let mesh, pass = 'main', capture = false, draws = [];
      for (const candidate of scene.meshes) if (typeof candidate._draw === 'function') {
        const original = candidate._draw;
        candidate._draw = function (...args) { const previous = mesh; mesh = this; try { return original.apply(this, args); } finally { mesh = previous; } };
      }
      shadows.getShadowMap().onBeforeRenderObservable.add(() => { pass = 'shadow'; });
      shadows.getShadowMap().onAfterRenderObservable.add(() => { pass = 'main'; });
      const gl = engine._gl;
      for (const name of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced']) {
        const original = gl[name].bind(gl);
        gl[name] = function (...args) {
          if (capture) {
            const indexed = name.includes('Elements'), count = args[indexed ? 1 : 2];
            const instances = name.endsWith('Instanced') ? args[indexed ? 4 : 3] : 1;
            const treeInstances = mesh?.name.startsWith('economy-template-tree-')
              ? mesh._getInstanceDataStorage().previousBatch?.visibleInstances[0]?.map(instance => instance.name) : undefined;
            draws.push({ pass, mesh: mesh?.name || 'unknown', triangles: args[0] === gl.TRIANGLES ? count * instances / 3 : 0, instances, treeInstances });
          }
          return original(...args);
        };
      }
      r.sample = () => {
        // Let new native instance/LOD shader variants become ready first.
        for (let i = 0; i < 3; i++) scene.render();
        draws = []; capture = true; engine.beginFrame(); scene.render(); engine.endFrame(); capture = false;
        const groups = {};
        for (const draw of draws) {
          const key = `${draw.pass}/${draw.mesh.includes('tree-') ? 'trees' : 'other'}`;
          const row = groups[key] ??= { draws: 0, triangles: 0, instances: 0 };
          row.draws++; row.triangles += draw.triangles; row.instances += draw.instances;
        }
        const submitted = new Set(), duplicateTreeInstances = [];
        for (const draw of draws) for (const name of draw.treeInstances ?? []) {
          const key = `${draw.pass}/${name}`;
          if (submitted.has(key)) duplicateTreeInstances.push(key);
          submitted.add(key);
        }
        return { triangles: draws.reduce((sum, draw) => sum + draw.triangles, 0), nativeTriangles: scene.getActiveIndices() / 3, duplicateTreeInstances,
          drawCalls: draws.length, groups, size: { width: engine.getRenderWidth(), height: engine.getRenderHeight() },
          shadowLODArea: shadows.getShadowMap().cameraForLOD?.screenArea ?? camera.screenArea };
      };
    });
    const frames = [];
    for (const zoom of [16.2, 48, 167.95847222292238]) for (const enabled of [false, true]) {
      const frame = await page.evaluate(({ zoom, enabled }) => {
        const r = window.__treeReview; r.project(zoom); r.setLOD(enabled); return r.sample();
      }, { zoom, enabled });
      assert.equal(frame.triangles, frame.nativeTriangles, 'the HUD count matches actual GL submissions');
      assert.deepEqual(frame.duplicateTreeInstances, [], 'shadow LOD cannot duplicate instances into the main pass');
      if (enabled) for (const pass of ['main', 'shadow']) assert.equal(frame.groups[`${pass}/trees`].instances,
        frames.at(-1).groups[`${pass}/trees`].instances, `${pass}: every zoom retains the same tree instances`);
      if (zoom > 160) await page.screenshot({ path: `${output}/${label}-overview-${enabled ? 'lod' : 'original'}.png`, scale: 'css', timeout: 60000 });
      frames.push({ zoom, enabled, ...frame });
    }
    const before = frames.at(-2), after = frames.at(-1);
    assert(after.groups['main/trees'].triangles < before.groups['main/trees'].triangles * .1);
    assert(after.groups['shadow/trees'].triangles < before.groups['shadow/trees'].triangles * .1);
    assert.equal(after.groups['main/trees'].instances, before.groups['main/trees'].instances, 'all trees still render');
    assert.equal(after.groups['shadow/trees'].instances, before.groups['shadow/trees'].instances, 'all tree shadows still render');
    assert(after.drawCalls <= before.drawCalls + 12, 'native instancing survives the LOD switch');
    const harvest = await page.evaluate(async () => {
      const r = window.__treeReview, { scene, world, economy, shadows, camera } = r;
      const { Ray } = await import('/node_modules/@babylonjs/core/Culling/ray.js');
      const tree = [...world.objects.values()].find(object => object.kind === 'tree');
      const meshes = scene.meshes.filter(mesh => mesh.metadata?.worldObjectId === tree.id);
      const source = meshes[0].sourceMesh, count = source.instances.length;
      const center = meshes.at(-1).getBoundingInfo().boundingSphere.centerWorld;
      const direction = center.clone().set(0, -1, 0);
      const ray = new Ray(center.add(direction.scale(-10)), direction, 20);
      const picked = scene.pickWithRay(ray, mesh => mesh.metadata?.worldObjectId === tree.id);
      const selected = picked?.pickedMesh?.metadata?.worldObjectId;
      economy.state.depleted.push(tree.id); economy.revision++; world.sync();
      const after = r.sample();
      return { selected, id: tree.id, removed: !world.objects.has(tree.id) && meshes.every(mesh => mesh.isDisposed()),
        casterRemoved: !shadows.getShadowMap().renderList.some(mesh => mesh.metadata?.worldObjectId === tree.id),
        remainingInstances: source.instances.length, previousInstances: count,
        siblingLODAlive: !source.instances[0].getLOD(camera).isDisposed(), after };
    });
    assert.equal(harvest.selected, harvest.id, 'picking uses the live instance identity even at far LOD');
    assert(harvest.removed && harvest.casterRemoved && harvest.siblingLODAlive);
    assert.equal(harvest.remainingInstances, harvest.previousInstances - 1);
    assert.equal(harvest.after.groups['main/trees'].instances, after.groups['main/trees'].instances - 2);
    assert.equal(harvest.after.groups['shadow/trees'].instances, after.groups['shadow/trees'].instances - 2);
    const pictures = [];
    if (mobile) {
      // Isolate one surviving tree to check its silhouette and lighting at the
      // actual phone render resolution, without unrelated animated scenery.
      await page.evaluate(() => {
        const r = window.__treeReview;
        r.tree = [...r.world.objects.values()].find(object => object.kind === 'tree');
        for (const mesh of r.scene.meshes) if (!mesh.name.startsWith('economy-template-tree-') && mesh.metadata?.worldObjectId !== r.tree.id) mesh.setEnabled(false);
        r.scene.shadowsEnabled = false;
        r.instances = r.scene.meshes.filter(mesh => mesh.metadata?.worldObjectId === r.tree.id);
      });
      for (const [view, alpha, beta] of [['front', -Math.PI / 2, Math.PI / 2], ['side', 0, Math.PI / 2], ['game', -Math.PI / 2, .76]]) {
        for (const zoom of [4, 18, 48, 168]) {
          const captures = [];
          for (const enabled of [false, true]) {
            const capture = await page.evaluate(async ({ zoom, alpha, beta, enabled }) => {
              const r = window.__treeReview; r.camera.alpha = alpha; r.camera.beta = beta;
              r.project(zoom, r.tree.x, 2.1, r.tree.z); r.setLOD(enabled); r.sample();
              const bytes = await r.engine.readPixels(0, 0, r.engine.getRenderWidth(), r.engine.getRenderHeight());
              let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
              return { pixels: btoa(binary), levels: r.instances.map(mesh => mesh.getLOD(r.camera).name) };
            }, { zoom, alpha, beta, enabled });
            captures.push(capture);
            await page.locator('#game').screenshot({ path: `${output}/tree-${view}-${zoom}-${enabled ? 'lod' : 'original'}.png` });
          }
          const [original, reduced] = captures.map(capture => Buffer.from(capture.pixels, 'base64'));
          let changed = 0, maximum = 0, total = 0;
          for (let i = 0; i < original.length; i++) { const d = Math.abs(original[i] - reduced[i]); total += d; maximum = Math.max(maximum, d); if (d > 2) changed++; }
          if (zoom === 4) assert.equal(maximum, 0, `${view}: close-up pixels must stay unchanged`);
          pictures.push({ view, zoom, maximum, meanDifference: total / original.length, changedChannels: changed, levels: captures[1].levels });
        }
      }
    }
    reports.push({ label, frames, harvest, pictures });
    console.log(JSON.stringify({ label, before: before.triangles, after: after.triangles,
      treeBefore: before.groups['main/trees'].triangles + before.groups['shadow/trees'].triangles,
      treeAfter: after.groups['main/trees'].triangles + after.groups['shadow/trees'].triangles, harvest: harvest.removed }));
    await writeFile(`${output}/report.json`, JSON.stringify({ note: 'Initial saved state; software WebGL counts and visual regression, not iPhone frame-time measurement.', reports, errors }, null, 2));
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
