import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPerformanceLog } from '../src/performance-log.ts';

type Report = Parameters<typeof compactPerformanceLog>[0];
type Sample = NonNullable<Report['latest']>;
function fixture(): Report {
  const history: Sample[] = Array.from({ length: 120 }, (_, index) => ({
    timeMs: 100_000 + index * 500, zoom: 16.210502143221923, paused: false,
    fps: 33.96226415094713, cpuMs: 9.333333333333334, frameMs: 29.44444444444121, frameP95Ms: 32,
    gpuMs: null, gpuTimingSupported: false, gpuSampleAgeMs: null,
    drawCalls: 428, submittedTriangles: 2418670, shadowDrawCalls: 209, shadowTriangles: 1174280,
    shadowCpuMs: 4.000000000058208, cullingCpuMs: 2, activeMeshes: 254,
    meshes: 1229, geometries: 862, textures: 22, materials: 107, skeletons: 15,
    animationGroups: 52, renderLoops: 1, width: 589, height: 1131, scaling: 2 / 3,
    shadowSize: 1024, shadowLodCamera: 'map-shadow-lod',
    lod: [{ id: 'farmer', parts: 25, mapParts: 25 }],
  }));
  return { latest: history.at(-1), history, marks: [{ label: '旧视距', sample: history[0] }, { label: '近景', sample: history.at(-1)! }],
    backend: 'WebGL 2', webGLVersion: 2, renderer: 'Apple GPU', gpuTimingSupported: false, renderLoops: 0,
    sampleAgeMs: 60_000.123456, note: 'Original unabridged report' };
}

test('copy keeps ten seconds before the last render even after a minute paused, without repeated configuration', () => {
  const source = fixture(), report = compactPerformanceLog(source);
  assert.equal(report.windowMs, 10_000);
  assert.equal(report.history.length, 21);
  assert.equal(report.history[0].timeMs, 149_500);
  assert.equal(report.history.at(-1)!.timeMs, 159_500);
  assert.equal(report.sampleAgeMs, 60_000.12);
  assert.deepEqual(report.marks.map(mark => mark.label), ['近景']);
  assert.equal(report.latest!.fps, 33.96);
  assert.equal(report.latest!.submittedTriangles, 2418670);
  assert.equal(report.latest!.gpuMs, null);
  assert.equal(report.gpuTimingSupported, false);
  assert.equal(report.renderer, 'Apple GPU');
  assert.equal(report.renderLoops, 0);
  assert.equal(report.latest!.renderLoops, 1, 'last rendered state stays distinct from paused loop count');
  assert.deepEqual(report.latest!.lod, source.latest!.lod);
  assert.equal('lod' in report.history[0], false);
  assert.equal('textures' in report.history[0], false);
  assert.equal('lod' in report.marks[0].sample, false);
  assert.equal(source.history.length, 120, 'copy does not truncate the live diagnostics');
  assert.equal(source.latest!.fps, 33.96226415094713);
  assert.ok(JSON.stringify(report).length < JSON.stringify(source).length / 5);
});

test('copy handles no rendered samples and preserves genuine GPU timings when available', () => {
  const source = fixture();
  const empty = compactPerformanceLog({ ...source, latest: undefined, history: [], marks: [], sampleAgeMs: null });
  assert.equal(empty.latest, undefined);
  assert.equal(empty.sampleAgeMs, null);
  assert.deepEqual(empty.history, []);
  assert.deepEqual(empty.marks, []);
  source.latest!.gpuMs = 12.34567; source.latest!.gpuTimingSupported = true;
  source.latest!.gpuSampleAgeMs = 23.456789; source.gpuTimingSupported = true;
  const report = compactPerformanceLog(source);
  assert.equal(report.latest!.gpuMs, 12.35);
  assert.equal(report.latest!.gpuSampleAgeMs, 23.46);
  assert.equal(report.history.at(-1)!.gpuMs, 12.35);
});
