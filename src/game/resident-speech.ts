/** Actor-independent speech, timed by active gameplay seconds rather than wall time. */
export class ResidentSpeech {
  private queues = new Map<string, { text: string; remaining: number; duration: number }[]>();
  say(actor: string, text: string, duration = 3.5) {
    const queue = this.queues.get(actor) ?? [];
    queue.push({ text, remaining: duration, duration }); this.queues.set(actor, queue);
  }
  advance(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    for (const [id, queue] of this.queues) {
      if (queue[0]) queue[0].remaining -= seconds;
      // Every dispatched instruction receives its own readable display interval.
      if (queue[0]?.remaining <= 0) queue.shift();
      if (!queue.length) this.queues.delete(id);
    }
  }
  current(actor: string) { return this.queues.get(actor)?.[0]?.text; }
}
