import { normalizeInput } from './movement.ts';
import type { Point } from './movement.ts';

/** A tap selects; a drag pans; a pinch zooms. A gesture never does two things. */
export class MovementInput {
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private origin = { x: 0, y: 0 };
  private dragged = false;
  private pinched = false;
  private pinchDistance = 0;
  private abort = new AbortController();

  constructor(canvas: HTMLCanvasElement, onZoom: (amount: number) => void,
    onPan: (dx: number, dy: number) => void, onTap: (x: number, y: number) => void) {
    const options = { signal: this.abort.signal };
    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
    const reset = () => { this.keys.clear(); this.pointers.clear(); this.pinchDistance = 0; this.pinched = false; };
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
      event.preventDefault(); canvas.focus({ preventScroll: true });
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      if (this.pointers.size === 1) { this.origin = { x: event.clientX, y: event.clientY }; this.dragged = false; this.pinched = false; }
      else { this.pinched = true; this.pinchDistance = this.distance(); }
    }, options);
    canvas.addEventListener('pointermove', (event) => {
      const last = this.pointers.get(event.pointerId); if (!last) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size >= 2) {
        const distance = this.distance(); if (this.pinchDistance > 0) onZoom((this.pinchDistance - distance) * 0.025);
        this.pinchDistance = distance; return;
      }
      if (this.pinched) return;
      if (!this.dragged && Math.hypot(event.clientX - this.origin.x, event.clientY - this.origin.y) >= 8) {
        this.dragged = true; onPan(event.clientX - this.origin.x, event.clientY - this.origin.y); return;
      }
      if (this.dragged) onPan(event.clientX - last.x, event.clientY - last.y);
    }, options);
    const release = (event: PointerEvent) => {
      if (!this.pointers.has(event.pointerId)) return;
      if (event.type === 'pointerup' && this.pointers.size === 1 && !this.dragged && !this.pinched) onTap(event.clientX, event.clientY);
      this.pointers.delete(event.pointerId);
      if (this.pointers.size === 0) { this.pinched = false; this.pinchDistance = 0; }
    };
    canvas.addEventListener('pointerup', release, options);
    canvas.addEventListener('pointercancel', release, options);
    canvas.addEventListener('lostpointercapture', release, options);
    canvas.addEventListener('wheel', (event) => { event.preventDefault(); onZoom(Math.max(-2, Math.min(2, event.deltaY * 0.01))); }, { ...options, passive: false });
  }
  private distance() { const [a, b] = [...this.pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }
  read(): Point {
    const x = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const z = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    return normalizeInput(x, z);
  }
  dispose() { this.abort.abort(); this.keys.clear(); this.pointers.clear(); }
}
