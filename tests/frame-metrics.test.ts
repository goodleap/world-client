import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameMetrics } from '../src/game/frame-metrics.ts';

test('CPU frame work excludes the wait between frames, independently of FPS', () => {
  const slow = new FrameMetrics();
  slow.record(0, 8); slow.record(250, 258);
  assert.deepEqual(slow.record(500, 508), { fps: 4, cpuMs: 8 });
  const fast = new FrameMetrics();
  for (let start = 0; start <= 500; start += 20) fast.record(start, start + 8);
  assert.deepEqual(fast.sample, { fps: 50, cpuMs: 8 });
});

test('resuming clears the old sampling interval and averages actual frame costs', () => {
  const meter = new FrameMetrics();
  meter.record(0, 10); meter.record(500, 510);
  meter.reset();
  assert.equal(meter.sample, undefined);
  assert.equal(meter.record(60_000, 60_004), undefined);
  assert.deepEqual(meter.record(60_500, 60_508), { fps: 2, cpuMs: 6 });
});

test('frame interval tail resets with the sampling window and on resume', () => {
  const meter = new FrameMetrics();
  for (let t = 0; t <= 500; t += 20) meter.record(t, t + 3);
  assert.deepEqual(meter.cadence, { meanMs: 20, p95Ms: 20 });
  meter.record(1000, 1004);
  assert.equal(meter.cadence.p95Ms, 500);
  meter.reset();
  assert.deepEqual(meter.cadence, { meanMs: 0, p95Ms: 0 });
});
