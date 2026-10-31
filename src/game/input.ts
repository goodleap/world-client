import { normalizeInput } from './movement.ts';
import type { Point } from './movement.ts';

type ScreenPoint = { x: number; y: number };
export interface PinchGesture { scale: number; previousCenter: ScreenPoint; center: ScreenPoint }

/** Taps select; drags and pinches manipulate the map without generating taps. */
export class MovementInput {
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private origin = { x: 0, y: 0 };
  private dragged = false;
  private pinched = false;
  private pinch: { distance: number; center: ScreenPoint } | undefined;
  private tap: { x: number; y: number } | undefined;
  private abort = new AbortController();
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, onZoom: (amount: number) => void,
    onPan: (dx: number, dy: number, started: boolean) => void, onTap: (x: number, y: number) => void,
    onPinch: (gesture: PinchGesture) => void) {
    this.canvas = canvas;
    const options = { signal: this.abort.signal };
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
    const reset = () => this.reset();
    window.addEventListener('keydown', (event) => {
      if (!keys.includes(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault(); this.keys.add(event.code);
    }, options);
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), options);
    window.addEventListener('blur', reset, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); }, options);
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.tap = undefined;
      event.preventDefault(); canvas.focus({ preventScroll: true });
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      if (this.pointers.size === 1) { this.origin = { x: event.clientX, y: event.clientY }; this.dragged = false; this.pinched = false; }
      else { this.pinched = true; this.pinch = this.measurePinch(); }
    }, options);
    canvas.addEventListener('pointermove', (event) => {
      const last = this.pointers.get(event.pointerId); if (!last) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size >= 2) {
        const next = this.measurePinch(), previous = this.pinch;
        if (next && previous && (next.distance !== previous.distance || next.center.x !== previous.center.x || next.center.y !== previous.center.y)) {
          onPinch({ scale: next.distance / previous.distance, previousCenter: previous.center, center: next.center });
        }
        this.pinch = next; return;
      }
      if (this.pinched) return;
      if (!this.dragged && Math.hypot(event.clientX - this.origin.x, event.clientY - this.origin.y) >= 8) {
        this.dragged = true; onPan(event.clientX - this.origin.x, event.clientY - this.origin.y, true); return;
      }
      if (this.dragged) onPan(event.clientX - last.x, event.clientY - last.y, false);
    }, options);
    const release = (event: PointerEvent) => {
      if (!this.pointers.has(event.pointerId)) return;
      if (event.type === 'pointerup' && this.pointers.size === 1 && !this.dragged && !this.pinched) this.tap = { x: event.clientX, y: event.clientY };
      this.pointers.delete(event.pointerId);
      // Rebase when a finger leaves or is replaced, including three-finger
      // handoffs. A remaining finger cannot become a tap/drag from this pinch.
      this.pinch = this.measurePinch();
      if (this.pointers.size === 0) this.pinched = false;
    };
    canvas.addEventListener('pointerup', release, options);
    canvas.addEventListener('pointercancel', release, options);
    canvas.addEventListener('lostpointercapture', release, options);
    // Change the selection after the browser has dispatched its click. Opening
    // the card on pointerup can put a new button under the finger, allowing the
    // same touch's synthesized click to close it or submit an unintended job.
    canvas.addEventListener('click', () => {
      const tap = this.tap; this.tap = undefined;
      if (tap) onTap(tap.x, tap.y);
    }, options);
    canvas.addEventListener('wheel', (event) => { event.preventDefault(); onZoom(Math.max(-6, Math.min(6, event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1) * 0.035))); }, { ...options, passive: false });
  }
  private measurePinch() {
    const [a, b] = this.pointers.values();
    if (!a || !b) return;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    // Coincident fingers have no usable scale; acquire a fresh baseline when
    // they separate instead of dividing by zero or creating a huge zoom jump.
    if (distance < 1) return;
    return { distance, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  read(): Point {
    const x = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const z = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    return normalizeInput(x, z);
  }
  get isDragging() { return this.dragged && this.pointers.size > 0; }
  reset() {
    const ids = [...this.pointers.keys()];
    this.keys.clear(); this.pointers.clear(); this.pinch = undefined; this.tap = undefined;
    this.pinched = false; this.dragged = false; this.origin = { x: 0, y: 0 };
    for (const id of ids) if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }
  dispose() { this.reset(); this.abort.abort(); }
}
