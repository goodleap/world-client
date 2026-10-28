import { normalizeInput } from './movement.ts';
import type { Point } from './movement.ts';

/** Pointer events cover real touch, pen and mouse; the DOM HUD never steals a game pointer. */
export class MovementInput {
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private origin = { x: 0, y: 0 };
  private movement: Point = { x: 0, z: 0 };
  private pinchDistance = 0;
  private gestureHadPinch = false;
  private abort = new AbortController();

  constructor(canvas: HTMLCanvasElement, joystick: HTMLElement, knob: HTMLElement, onZoom: (amount: number) => void) {
    const options = { signal: this.abort.signal };
    const moveKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
    const reset = () => {
      this.keys.clear(); this.pointers.clear(); this.movement = { x: 0, z: 0 };
      this.pinchDistance = 0; this.gestureHadPinch = false;
      joystick.classList.remove('active');
    };
    window.addEventListener('keydown', (event) => {
      if (!moveKeys.includes(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
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
      if (this.pointers.size === 1) {
        this.origin = { x: event.clientX, y: event.clientY };
        this.gestureHadPinch = false;
        joystick.style.left = `${event.clientX}px`; joystick.style.top = `${event.clientY}px`;
        knob.style.transform = 'translate(0px, 0px)'; joystick.classList.add('active');
      } else {
        this.gestureHadPinch = true; this.movement = { x: 0, z: 0 };
        this.pinchDistance = this.distance(); joystick.classList.remove('active');
      }
    }, options);
    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size >= 2) {
        const distance = this.distance();
        if (this.pinchDistance > 0) onZoom((this.pinchDistance - distance) * 0.025);
        this.pinchDistance = distance; return;
      }
      if (this.gestureHadPinch) return;
      const dx = event.clientX - this.origin.x, dy = event.clientY - this.origin.y;
      const magnitude = Math.hypot(dx, dy);
      this.movement = magnitude < 7 ? { x: 0, z: 0 } : normalizeInput(dx / 46, -dy / 46);
      const scale = magnitude > 42 ? 42 / magnitude : 1;
      knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    }, options);
    const release = (event: PointerEvent) => {
      this.pointers.delete(event.pointerId);
      this.movement = { x: 0, z: 0 };
      joystick.classList.remove('active');
      if (this.pointers.size === 0) { this.gestureHadPinch = false; this.pinchDistance = 0; }
    };
    canvas.addEventListener('pointerup', release, options);
    canvas.addEventListener('pointercancel', release, options);
    canvas.addEventListener('lostpointercapture', release, options);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault(); onZoom(Math.max(-2, Math.min(2, event.deltaY * 0.01)));
    }, { ...options, passive: false });
  }

  private distance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  read(): Point {
    const x = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const z = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    return x || z ? normalizeInput(x, z) : this.movement;
  }

  dispose() { this.abort.abort(); this.keys.clear(); this.pointers.clear(); }
}
