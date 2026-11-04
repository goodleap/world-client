type Store = Pick<Storage, 'getItem' | 'setItem'>;
export const LOADING_HISTORY_KEY = 'world-loading-history-v1';
export type LoadingEvent = 'pagehide' | 'hidden' | 'manual-retry' | 'context-lost' | 'context-restored';
export interface LoadingAttempt {
  id: string; build: string; mode: 'new' | 'continue'; startedAt: number; updatedAt: number;
  status: 'loading' | 'ready' | 'error'; percent: number; stage: string; heapMB: number | null;
  events: { name: LoadingEvent; at: number }[]; error?: string;
}
const eventNames: LoadingEvent[] = ['pagehide', 'hidden', 'manual-retry', 'context-lost', 'context-restored'];
const valid = (r: LoadingAttempt) => r && typeof r.id === 'string' && r.id.length < 100
  && typeof r.build === 'string' && r.build.length < 100 && ['new', 'continue'].includes(r.mode)
  && ['loading', 'ready', 'error'].includes(r.status) && Number.isFinite(r.startedAt) && Number.isFinite(r.updatedAt)
  && Number.isFinite(r.percent) && r.percent >= 0 && r.percent <= 100 && typeof r.stage === 'string' && r.stage.length <= 120
  && (r.heapMB === null || Number.isFinite(r.heapMB) && r.heapMB >= 0)
  && (r.error === undefined || typeof r.error === 'string' && r.error.length <= 240)
  && Array.isArray(r.events) && r.events.length <= 8 && r.events.every(e => e && eventNames.includes(e.name) && Number.isFinite(e.at));

/** Bounded local evidence, independent of a village save. An unfinished record
 * is evidence of an interrupted load, never proof of OOM or an automatic retry. */
export class LoadingHistory {
  private current?: LoadingAttempt;
  private previous?: LoadingAttempt;
  private lastWrite = -Infinity;
  private lastStage = '';
  private available = true;
  private storage: () => Store;
  private now: () => number;
  constructor(storage: () => Store, now = () => Date.now()) {
    this.storage = storage; this.now = now;
    try {
      const text = storage().getItem(LOADING_HISTORY_KEY);
      if (text && text.length <= 8000) {
        const stored = JSON.parse(text);
        if (stored.version === 1 && valid(stored.current)) this.previous = stored.current;
      }
    } catch { this.available = false; }
  }
  begin(build: string, mode: LoadingAttempt['mode']) {
    if (this.current) this.previous = this.current;
    const now = this.now();
    this.current = { id: `${now}-${Math.random().toString(36).slice(2, 10)}`, build, mode,
      startedAt: now, updatedAt: now, status: 'loading', percent: 0, stage: '准备进入家园', heapMB: null, events: [] };
    this.lastStage = ''; this.write();
  }
  checkpoint(percent: number, stage: string, heapMB: number | null) {
    if (!this.current || this.current.status !== 'loading') return;
    Object.assign(this.current, { updatedAt: this.now(), percent: Math.min(100, Math.max(0, percent)), stage: stage.slice(0, 120), heapMB });
    // Preserve the high-risk transitions immediately; ordinary progress is
    // capped at two tiny synchronous writes per second, with no timer loop.
    const critical = /材质、纹理与着色器|首帧/.test(stage) && stage !== this.lastStage;
    if (critical || this.now() - this.lastWrite >= 500) this.write();
  }
  event(name: LoadingEvent) {
    if (!this.current) return;
    this.current.events.push({ name, at: this.now() });
    this.current.events = this.current.events.slice(-8); this.write();
  }
  ready() {
    if (!this.current) return;
    Object.assign(this.current, { status: 'ready', percent: 100, stage: '家园已准备好' }); this.write();
  }
  fail(error: unknown) {
    if (!this.current) return;
    this.current.status = 'error'; this.current.error = (error instanceof Error ? error.message : String(error)).slice(0, 240); this.write();
  }
  snapshot() { return structuredClone({ available: this.available, current: this.current, previous: this.previous }); }
  private write() {
    if (!this.current) return;
    this.current.updatedAt = this.now(); this.lastWrite = this.current.updatedAt; this.lastStage = this.current.stage;
    try { this.storage().setItem(LOADING_HISTORY_KEY, JSON.stringify({ version: 1, current: this.current, previous: this.previous })); this.available = true; }
    catch { this.available = false; }
  }
}
export const loadingHistory = new LoadingHistory(() => localStorage);
