/** Rendering may be skipped; every mode runs the same 50 ms simulation steps.
 * Keep fractional time and all active-frame debt. Background time is excluded
 * by the caller, never by a frame-rate-dependent delta clamp. */
export class SimulationClock {
  static readonly step = .05;
  static readonly maxSteps = 3;
  static readonly budgetMs = 6;
  private remainder = 0;
  private now:()=>number;
  constructor(now = () => performance.now()) { this.now=now; }
  get pendingSeconds() { return this.remainder; }
  get alpha() { return Math.min(1, Math.max(0, this.remainder / SimulationClock.step)); }
  advance(elapsed:number, update:(seconds:number)=>void) {
    if(!Number.isFinite(elapsed)||elapsed<0)return 0;
    this.remainder+=elapsed;
    let advanced=0, steps=0;
    const started=this.now();
    while(this.remainder+1e-9>=SimulationClock.step){
      update(SimulationClock.step);this.remainder-=SimulationClock.step;advanced+=SimulationClock.step;
      // Yield to input/rendering; retain every unfinished step for later frames.
      if(++steps>=SimulationClock.maxSteps||this.now()-started>=SimulationClock.budgetMs)break;
    }
    this.remainder=Math.max(0,this.remainder);return advanced;
  }
}
export class RenderCadence {
  private elapsed=0;
  ready(seconds:number,fps:number,force=false) {
    this.elapsed+=Math.max(0,seconds);
    if(force){this.elapsed=0;return true;}
    const period=1/fps;
    if(this.elapsed+1e-8<period)return false;
    this.elapsed%=period;return true;
  }
}
