import { SnapshotInterpolation } from '@geckos.io/snapshot-interpolation';

interface Frame { serial:number;stamp:number;seconds:number;resetMotion?:boolean }
/** BSD-3-Clause SnapshotInterpolation owns snapshot selection and clock
 * interpolation. Game-specific patches stay ordered; Babylon owns poses.
 * Two fixed ticks absorb normal worker jitter without extrapolating through walls. */
export class PresentationBuffer<T extends Frame> {
  private interpolation=new SnapshotInterpolation(20);
  private pending:T[]=[];
  private base:{serial:number;seconds:number};
  private consume:(frame:T)=>void;
  alpha=1;
  constructor(seconds:number,consume:(frame:T)=>void){
    this.consume=consume;
    this.base={serial:0,seconds};this.interpolation.interpolationBuffer.set(100);this.interpolation.vault.setMaxSize(12);
  }
  add(frame:T){
    const vault=this.interpolation.vault,last=vault.get();
    if(!last)vault.add({id:String(this.base.serial),time:frame.stamp-(frame.seconds-this.base.seconds)*1000,state:[{id:'clock',seconds:this.base.seconds}]});
    if(last?.time===frame.stamp){last.id=String(frame.serial);last.state=[{id:'clock',seconds:frame.seconds}];}
    else vault.add({id:String(frame.serial),time:frame.stamp,state:[{id:'clock',seconds:frame.seconds}]});
    this.pending.push(frame);
    // A suspended renderer never accumulates an unbounded patch queue.
    if(this.pending.length>12)this.drain(true);
  }
  private through(serial:number){
    while(this.pending.length&&this.pending[0].serial<=serial){const frame=this.pending.shift()!;this.consume(frame);this.base={serial:frame.serial,seconds:frame.seconds};}
  }
  advance(now=performance.timeOrigin+performance.now()){
    const time=now-this.interpolation.interpolationBuffer.get(),pair=this.interpolation.vault.get(time);
    if(!pair)return;
    if(!pair.newer){this.through(Number(pair.older.id));this.alpha=1;return;}
    const sample=this.interpolation.interpolate(pair.older,pair.newer,time,'seconds');
    this.through(Number(sample.newer));this.alpha=Math.max(0,Math.min(1,sample.percentage));
  }
  drain(reset=false){
    if(reset&&this.pending.length)this.pending[this.pending.length-1].resetMotion=true;
    this.through(Infinity);this.alpha=1;this.interpolation.vault.clear();
  }
  reset(seconds:number,serial:number){this.drain();this.base={seconds,serial};}
  snapshot(){return {bufferMs:this.interpolation.interpolationBuffer.get(),queued:this.pending.length,alpha:this.alpha};}
}
