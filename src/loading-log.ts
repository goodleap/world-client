import type { LoadItem } from './loading-progress.ts';

type Item = LoadItem & { elapsedMs: number; idleMs: number };
const round = (n: number) => Math.round(n);
const short = (item: Item) => ({ name: item.name, state: item.state, ms: round(item.elapsedMs),
  ...(item.error ? { error: item.error } : {}), ...(item.state === 'working' ? { idleMs: round(item.idleMs) } : {}) });
/** Wall spans and summed task time are different: parallel downloads must not
 * be added into a claimed loading duration. Missing transfer size is unknown,
 * never evidence of a cache hit. Failed/in-flight requests remain identifiable. */
export function compactLoadingLog(items: readonly Item[]) {
  const downloads = items.filter(i => i.kind === 'download'), stages = items.filter(i => i.kind === 'stage');
  const groups = new Map<string, { count: number; workMs: number }>();
  for (const item of stages) {
    const group = item.id.endsWith(':parse') ? 'parse' : /:(attach|geometry|materials)$/.test(item.id) ? 'assembly' : item.id;
    const value = groups.get(group) ?? { count: 0, workMs: 0 }; value.count++; value.workMs += round(item.elapsedMs); groups.set(group, value);
  }
  const span = (list: Item[]) => {
    const times = list.filter(i => i.started !== undefined && i.ended !== undefined);
    return times.length ? round(Math.max(...times.map(i => i.ended!)) - Math.min(...times.map(i => i.started!))) : null;
  };
  const pending = items.filter(i => i.state !== 'done');
  return {
    completed: items.filter(i => i.state === 'done').length, total: items.length,
    downloads: { count: downloads.length, bodyBytes: downloads.reduce((s, i) => s + (i.loaded ?? i.request?.decodedBytes ?? 0), 0),
      codeSpanMs: span(downloads.filter(i => i.id.startsWith('module:'))), assetSpanMs: span(downloads.filter(i => !i.id.startsWith('module:'))),
      cachedByTiming: downloads.filter(i => i.request?.transferBytes === 0 && (i.request.encodedBytes ?? 0) > 0).length,
      unknownTransfer: downloads.filter(i => i.request?.transferBytes === undefined || !(i.request.encodedBytes! > 0)).length,
      slowest: [...downloads].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 3).map(short) },
    stages: Object.fromEntries(groups),
    issues: pending.slice(0, 8).map(i => ({ ...short(i), id: i.id, loaded: i.loaded, total: i.total })),
    omittedIssues: Math.max(0, pending.length - 8),
  };
}
