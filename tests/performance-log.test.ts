import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPerformanceLog } from '../src/performance-log.ts';
import { compactLoadingLog } from '../src/loading-log.ts';
import { LoadingProgress } from '../src/loading-progress.ts';
type Report = Parameters<typeof compactPerformanceLog>[0];
function fixture(): Report {
  const history: NonNullable<Report['latest']>[] = Array.from({ length: 120 }, (_, index) => ({
    timeMs: 100_000 + index * 500, zoom: 16.210502143221923, paused: false,
    fps: 33.96226415094713, cpuMs: 9.333333333333334, frameMs: 29.44444444444121, frameP95Ms: 32,
    jsHeapMB: 123.456, gpuMs: null, gpuTimingSupported: false, gpuSampleAgeMs: null,
    drawCalls: 428, submittedTriangles: 2418670, shadowDrawCalls: 209, shadowTriangles: 1174280,
    selectionDrawCalls: 30, selectionTriangles: 90000, mainDrawCalls: 189, mainTriangles: 1154390,
    shadowCpuMs: 4.000000000058208, cullingCpuMs: 2, activeMeshes: 254,
    meshes: 1229, geometries: 862, textures: 22, materials: 107, skeletons: 15,
    animationGroups: 52, renderLoops: 1, width: 589, height: 1131, scaling: 2 / 3,
    shadowSize: 1024, shadowLodCamera: 'map-shadow-lod', buildingLOD: { near: 0, medium: 15, far: 0 },
    lod: Array.from({ length: 20 }, (_, i) => ({ id: 'actor-' + i, parts: 15, mapParts: 15, farParts: 15 })),
    context: { mode: 'standard', fpsLimit: 60, selected: 1, candidates: 400, camera: { x: 1.23456, y: .5, z: -4.345678 }, shadows: true },
  }));
  return { latest: history.at(-1), history, slowFrames: [{ timeMs: 159000, frameMs: 110, cpuMs: 60,
    work: { logicMs: 5, worldMs: 40, saveMs: 1, sceneMs: 14 }, context: history[0].context! }],
    marks: [{ label: '旧视距', sample: history[0] }, { label: '近景', sample: history.at(-1)! }],
    backend: 'WebGL 2', webGLVersion: 2, renderer: 'Apple GPU', gpuTimingSupported: false, renderLoops: 0,
    sampleAgeMs: 60_000.123456, note: 'unabridged' };
}
test('small export retains ten seconds, context, pass totals, slow-frame phases and paused samples', () => {
  const source = fixture(), report = compactPerformanceLog(source);
  assert.equal(report.samples, 21); assert.ok(report.timeline.rows.length <= 6);
  assert.equal(report.sampleAgeMs, 60000.12); assert.equal(report.latest!.fps, 33.96);
  assert.equal(report.latest!.jsHeapMB, 123.46);
  assert.deepEqual(report.latest!.passes.total, [428, 2418670]);
  assert.equal(Object.entries(report.latest!.passes).filter(([k]) => k !== 'total').reduce((n, [, v]) => n + v[1], 0), report.latest!.passes.total[1]);
  assert.equal(report.latest!.context!.fpsLimit, 60); assert.equal(report.latest!.context!.camera.z, -4.35);
  assert.deepEqual(report.scene!.lod, { units: 20, near: 0, medium: 0, far: 300 });
  assert.deepEqual(report.scene!.buildingLOD, { near: 0, medium: 15, far: 0 });
  assert.equal(report.slowFrames[0].work.worldMs, 40); assert.equal(report.renderLoops, 0); assert.equal(report.latest!.renderLoops, 1);
  assert.deepEqual(report.marks.map(m => m.label), ['近景']);
  assert.equal(source.history.length, 120); assert.equal(source.latest!.context!.camera.z, -4.345678);
  assert.ok(JSON.stringify(report).length < 5500);
});
test('no samples and unsupported GPU remain explicit; real GPU readings survive rounding', () => {
  const source = fixture();
  const empty = compactPerformanceLog({ ...source, latest: undefined, history: [], marks: [], slowFrames: [], sampleAgeMs: null });
  assert.equal(empty.latest, undefined); assert.equal(empty.sampleAgeMs, null); assert.deepEqual(empty.timeline.rows, []);
  assert.equal(compactPerformanceLog(source).latest!.gpuMs, null);
  source.latest!.gpuMs = 12.34567; source.latest!.gpuSampleAgeMs = 23.456789; source.gpuTimingSupported = true;
  const report = compactPerformanceLog(source); assert.equal(report.latest!.gpuMs, 12.35); assert.equal(report.latest!.gpuSampleAgeMs, 23.46);
});
test('loading export folds assembly tasks, retains failures, and never guesses cache from missing byte counts', () => {
  let now = 0; const loading = new LoadingProgress(() => now);
  for (let i = 0; i < 30; i++) { loading.begin('actor-' + i + ':geometry', '装配'); now += 10; loading.done('actor-' + i + ':geometry'); }
  loading.begin('model.glb', '人物', 'download'); now += 50; loading.bytes('model.glb', 1024); loading.done('model.glb');
  loading.begin('failed.glb', '失败模型', 'download'); now += 100; loading.fail('failed.glb', new Error('network failed'));
  const report = compactLoadingLog(loading.snapshot());
  assert.deepEqual(report.stages.assembly, { count: 30, workMs: 300 });
  assert.equal(report.downloads.cachedByTiming, 0); assert.equal(report.downloads.unknownTransfer, 2);
  assert.equal(report.issues[0].id, 'failed.glb'); assert.equal(report.issues[0].error, 'network failed');
  assert.ok(JSON.stringify(report).length < 1200);
});
