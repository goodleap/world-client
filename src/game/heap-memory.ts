/** Chromium's optional counter measures JS heap only, not page/GPU memory.
 * Other browsers (or blocked/invalid counters) explicitly report unavailable. */
export function readJSHeapMB(source: object = performance): number | null {
  try {
    const bytes = (source as { memory?: { usedJSHeapSize?: unknown } }).memory?.usedJSHeapSize;
    return typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0 ? bytes / 1_000_000 : null;
  } catch { return null; }
}
