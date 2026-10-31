import type { createPerformanceDiagnostics } from './game/performance-diagnostics.ts';

type Report = ReturnType<ReturnType<typeof createPerformanceDiagnostics>['snapshot']>;
type Sample = NonNullable<Report['latest']>;
const windowMs = 10_000;
const round = (value: number) => Math.round(value * 100) / 100;
const rounded = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value)
  .map(([key, entry]) => [key, typeof entry === 'number' ? round(entry) : entry])) as T;

/** Keep changing counters in the timeline; scene configuration belongs in
 * latest once. A paused game has no new samples, so use its last rendered frame
 * as the window end rather than discarding the incident while Settings is open. */
export function compactPerformanceLog(report: Report) {
  const end = report.latest?.timeMs ?? -Infinity;
  const recent = (sample: Sample) => sample.timeMs >= end - windowMs && sample.timeMs <= end;
  const counters = (sample: Sample) => {
    const { timeMs, zoom, paused, fps, cpuMs, frameMs, frameP95Ms, gpuMs,
      drawCalls, submittedTriangles, shadowDrawCalls, shadowTriangles, shadowCpuMs,
      cullingCpuMs, activeMeshes, renderLoops } = sample;
    return rounded({ timeMs, zoom, paused, fps, cpuMs, frameMs, frameP95Ms, gpuMs,
      drawCalls, submittedTriangles, shadowDrawCalls, shadowTriangles, shadowCpuMs,
      cullingCpuMs, activeMeshes, renderLoops });
  };
  return {
    ...report, windowMs,
    sampleAgeMs: report.sampleAgeMs === null ? null : round(report.sampleAgeMs),
    latest: report.latest && rounded(report.latest),
    history: report.history.filter(recent).map(counters),
    marks: report.marks.filter(mark => recent(mark.sample)).map(mark => ({ label: mark.label, sample: counters(mark.sample) })),
    note: '最近 10 秒实际渲染样本，暂停后保留；sampleAgeMs 为距最后采样的时间。renderer 为渲染器，gpuTimingSupported=false 仅表示无法测量 GPU 耗时；null 不代表未使用 GPU。CPU 为提交耗时。',
  };
}
