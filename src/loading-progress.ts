export type LoadState = 'waiting' | 'working' | 'done' | 'failed';
export interface LoadItem {
  id: string; name: string; kind: 'download' | 'stage'; state: LoadState;
  loaded?: number; total?: number; started?: number; ended?: number; updated: number; error?: string;
}

/** Shared by the small launcher and the lazy engine chunk. No scene is created. */
export class LoadingProgress {
  readonly items = new Map<string, LoadItem>();
  private clock: () => number;
  constructor(clock = () => performance.now()) { this.clock = clock; }
  register(id: string, name: string, kind: LoadItem['kind'] = 'stage') {
    if (!this.items.has(id)) this.items.set(id, { id, name, kind, state: 'waiting', updated: this.clock() });
  }
  begin(id: string, name: string, kind: LoadItem['kind'] = 'stage') {
    this.register(id, name, kind);
    Object.assign(this.items.get(id)!, { name, state: 'working', started: this.clock(), ended: undefined,
      updated: this.clock(), error: undefined, loaded: kind === 'download' ? 0 : undefined, total: undefined });
  }
  bytes(id: string, loaded: number, total?: number) {
    const item = this.items.get(id)!;
    if (loaded !== item.loaded || total !== item.total) item.updated = this.clock();
    item.loaded = loaded; item.total = total && total > 0 ? total : undefined;
  }
  done(id: string) {
    Object.assign(this.items.get(id)!, { state: 'done', ended: this.clock(), updated: this.clock() });
  }
  fail(id: string, error: unknown) {
    const item = this.items.get(id); if (!item) return;
    Object.assign(item, { state: 'failed', ended: this.clock(), updated: this.clock(),
      error: error instanceof Error ? error.message : String(error) });
  }
  async run<T>(id: string, name: string, action: () => T | Promise<T>): Promise<T> {
    this.begin(id, name);
    try { const value = await action(); this.done(id); return value; }
    catch (error) { this.fail(id, error); throw error; }
  }
  snapshot() {
    const now = this.clock();
    return [...this.items.values()].map(item => ({ ...item,
      elapsedMs: item.started === undefined ? 0 : (item.ended ?? now) - item.started,
      idleMs: item.state === 'working' ? now - item.updated : 0,
    }));
  }
}
export const loadingProgress = new LoadingProgress();
export const byteLabel = (value?: number) => value === undefined ? '大小未知' : value >= 1024 * 1024
  ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${(value / 1024).toFixed(1)} KB`;
