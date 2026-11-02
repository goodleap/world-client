/** Transient presentation state. The caller supplies the paused game clock. */
export class HealthIndicator {
  private previous?: number;
  private until = -Infinity;
  fraction = 1;
  visible = false;

  update(hp: number, maximum: number, seconds: number) {
    if (this.previous !== undefined && hp !== this.previous) this.until = seconds + 4;
    this.previous = hp;
    this.fraction = Math.max(0, Math.min(1, hp / maximum));
    this.visible = seconds < this.until;
  }
}
