export interface FrameSample { fps: number; cpuMs: number }

/** FPS uses frame cadence; CPU time uses only the synchronous frame callback. */
export class FrameMetrics {
  private previousStart: number | undefined;
  private intervalMs = 0;
  private intervals = 0;
  private frames = 0;
  private cpuTotal = 0;
  lastFrameCpuMs = 0;
  sample: FrameSample | undefined;
  cadence = { meanMs: 0, p95Ms: 0 };
  private frameIntervals: number[] = [];

  record(start: number, end: number): FrameSample | undefined {
    this.lastFrameCpuMs = Math.max(0, end - start);
    this.cpuTotal += this.lastFrameCpuMs; this.frames++;
    if (this.previousStart !== undefined) {
      const interval = Math.max(0, start - this.previousStart);
      this.intervalMs += interval; this.intervals++; this.frameIntervals.push(interval);
    }
    this.previousStart = start;
    if (this.intervalMs < 500) return;
    this.sample = { fps: this.intervals * 1000 / this.intervalMs, cpuMs: this.cpuTotal / this.frames };
    const sorted = this.frameIntervals.sort((a, b) => a - b);
    this.cadence = { meanMs: this.intervalMs / this.intervals, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? 0 };
    this.frameIntervals = [];
    this.intervalMs = 0; this.intervals = 0; this.frames = 0; this.cpuTotal = 0;
    return this.sample;
  }

  reset() {
    this.previousStart = undefined; this.sample = undefined;
    this.cadence = { meanMs: 0, p95Ms: 0 }; this.frameIntervals = [];
    this.intervalMs = 0; this.intervals = 0; this.frames = 0; this.cpuTotal = 0; this.lastFrameCpuMs = 0;
  }
}
