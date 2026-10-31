import { loadingProgress, byteLabel } from './loading-progress.ts';

/** Observe Vite's native modulepreload/import requests. Never fetch or evaluate
 * code ourselves: that would change caching, module identity and CSP behavior.
 * Resource Timing exposes bytes only after a request completes. */
export function trackModuleLoading() {
  const abort = new AbortController();
  const moduleUrl = (value: string) => {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin || !/\/assets\/[^/]+\.js$/.test(url.pathname)) return;
    url.search = ''; url.hash = ''; return url.href;
  };
  const ensure = (url: string) => {
    const id = `module:${url}`;
    if (!loadingProgress.items.has(id)) {
      loadingProgress.begin(id, `代码文件 · ${url.slice(url.lastIndexOf('/') + 1)}`, 'download');
      Object.assign(loadingProgress.items.get(id)!, { loaded: undefined, request: { url },
        note: '浏览器管理此请求，下载中的字节暂不可读取；文件完成后还需代码解析与初始化。' });
    }
    return loadingProgress.items.get(id)!;
  };
  const timing = (entry: PerformanceResourceTiming) => {
    const url = moduleUrl(entry.name); if (!url) return;
    const item = ensure(url);
    item.started = Math.min(item.started!, entry.startTime);
    item.request = { url, startMs: entry.startTime, responseStartMs: entry.responseStart,
      responseEndMs: entry.responseEnd, durationMs: entry.duration, status: entry.responseStatus || undefined,
      transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize,
      protocol: entry.nextHopProtocol };
    if (entry.encodedBodySize > 0) loadingProgress.bytes(item.id, entry.encodedBodySize, entry.encodedBodySize);
    if (entry.responseStatus >= 400) loadingProgress.fail(item.id, `${item.name}：HTTP ${entry.responseStatus}`);
    else if (entry.encodedBodySize > 0 && item.state === 'working') loadingProgress.done(item.id);
    if (item.state !== 'working') {
      item.ended = entry.responseEnd;
      item.note = `请求已结束；传输 ${byteLabel(entry.transferSize)}，解压后 ${byteLabel(entry.decodedBodySize || undefined)}。引擎是否就绪另列。`;
    }
  };
  const timings = () => performance.getEntriesByType('resource').forEach(entry => timing(entry as PerformanceResourceTiming));
  const inspect = () => document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]').forEach(link => {
    const url = moduleUrl(link.href); if (url) ensure(url);
  });
  const finish = (event: Event) => {
    if (!(event.target instanceof HTMLLinkElement) || event.target.rel !== 'modulepreload') return;
    const url = moduleUrl(event.target.href); if (!url) return;
    const item = ensure(url);
    timings();
    if (event.type === 'error') {
      if (item.state !== 'failed') loadingProgress.fail(item.id, `${item.name}：浏览器无法下载或准备此模块，请复制诊断后重试。`);
    } else if (item.state !== 'failed') {
      loadingProgress.done(item.id);
      item.note = '浏览器已完成此模块预加载；引擎整体就绪状态另列。';
    }
  };
  document.addEventListener('load', finish, { capture: true, signal: abort.signal });
  document.addEventListener('error', finish, { capture: true, signal: abort.signal });
  const links = new MutationObserver(inspect);
  links.observe(document.head, { childList: true, subtree: true });
  let resources: PerformanceObserver | undefined;
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      resources = new PerformanceObserver(list => list.getEntries().forEach(entry => timing(entry as PerformanceResourceTiming)));
      resources.observe({ type: 'resource', buffered: true });
    } catch { resources?.disconnect(); }
  }
  inspect(); timings();
  return () => { abort.abort(); links.disconnect(); resources?.disconnect(); };
}
