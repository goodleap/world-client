import type { createPerformanceDiagnostics } from './game/performance-diagnostics.ts';

type Report = ReturnType<ReturnType<typeof createPerformanceDiagnostics>['snapshot']>;
type Sample = NonNullable<Report['latest']>;
const windowMs = 10_000;
/** Round recursively, including camera/phase measurements, without mutating
 * retained samples. Keep null GPU timings distinguishable from real zero. */
export function roundLog<T>(value: T): T {
  if (typeof value === 'number') return (Number.isFinite(value) ? Math.round(value * 100) / 100 : null) as T;
  if (Array.isArray(value)) return value.map(roundLog) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundLog(v)])) as T;
  return value;
}
export function compactPerformanceLog(report: Report) {
  const latest = report.latest, end = latest?.timeMs ?? -Infinity;
  const recent = (s: { timeMs: number }) => s.timeMs >= end - windowMs && s.timeMs <= end;
  const history = report.history.filter(recent);
  const range = (key: 'fps' | 'cpuMs' | 'frameMs' | 'frameP95Ms' | 'drawCalls' | 'submittedTriangles' | 'cullingCpuMs') => {
    const values = history.map(s => s[key]);
    return values.length ? { min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) } : null;
  };
  const counts = (s: Sample) => ({ timeMs: s.timeMs, fps: s.fps, cpuMs: s.cpuMs, frameMs: s.frameMs, frameP95Ms: s.frameP95Ms,
    jsHeapMB: s.jsHeapMB, gpuMs: s.gpuMs, gpuSampleAgeMs: s.gpuSampleAgeMs, cullingCpuMs: s.cullingCpuMs, shadowCpuMs: s.shadowCpuMs,
    passes: { main: [s.mainDrawCalls, s.mainTriangles], shadow: [s.shadowDrawCalls, s.shadowTriangles],
      selection: [s.selectionDrawCalls, s.selectionTriangles], total: [s.drawCalls, s.submittedTriangles] },
    activeMeshes: s.activeMeshes, zoom: s.zoom, renderLoops: s.renderLoops, context: s.context });
  const timeline = history.filter((_, i) => i === history.length - 1 || i % Math.max(1, Math.ceil(history.length / 5)) === 0);
  return roundLog({
    windowMs, samples: history.length, sampleAgeMs: report.sampleAgeMs,
    backend: report.backend, renderer: report.renderer, gpuTimingSupported: report.gpuTimingSupported, renderLoops: report.renderLoops,
    latest: latest && counts(latest),
    scene: latest && { meshes: latest.meshes, geometries: latest.geometries, materials: latest.materials, textures: latest.textures,
      skeletons: latest.skeletons, animationGroups: latest.animationGroups, buffer: [latest.width, latest.height], scaling: latest.scaling,
      shadowSize: latest.shadowSize, buildingLOD: latest.buildingLOD, lod: latest.lod.reduce((sum, l) => ({ units: sum.units + 1, near: sum.near + l.parts - l.mapParts,
        medium: sum.medium + l.mapParts - (l.farParts ?? 0), far: sum.far + (l.farParts ?? 0) }), { units: 0, near: 0, medium: 0, far: 0 }) },
    summary: Object.fromEntries((['fps', 'cpuMs', 'frameMs', 'frameP95Ms', 'drawCalls', 'submittedTriangles', 'cullingCpuMs'] as const).map(k => [k, range(k)])),
    timeline: { columns: ['timeMs', 'fps', 'cpuMs', 'p95Ms', 'draws', 'triangles', 'mode', 'selected'],
      rows: timeline.map(s => [s.timeMs, s.fps, s.cpuMs, s.frameP95Ms, s.drawCalls, s.submittedTriangles, s.context?.mode, s.context?.selected]) },
    slowFrames: report.slowFrames.filter(recent).sort((a, b) => b.frameMs - a.frameMs || b.cpuMs - a.cpuMs).slice(0, 3),
    marks: report.marks.filter(m => recent(m.sample)).slice(-3).map(m => ({ label: m.label, ...counts(m.sample) })),
    units: 'ms; JS heap MB=1e6 bytes, excludes GPU/page process, null=unavailable; passes=[drawCalls,triangles]; LOD counts parts; CPU=measured work, GPU null=unavailable; frame interval includes scheduling',
  });
}
