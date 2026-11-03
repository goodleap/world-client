/** Coalesce simulation changes; explicit saves/background/pause still flush
 * immediately. A failed write is retried at the interval, never every frame. */
export class Autosave {
  private elapsed = 0;
  readonly interval: number;
  constructor(interval = 5) { this.interval = interval; }
  advance(seconds: number) { this.elapsed += Math.max(0, seconds); }
  due() { return this.elapsed >= this.interval; }
  attempted() { this.elapsed = 0; }
}
