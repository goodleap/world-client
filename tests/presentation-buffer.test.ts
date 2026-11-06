import test from 'node:test';
import assert from 'node:assert/strict';
import { PresentationBuffer } from '../src/game/presentation-buffer.ts';

test('jittered worker deliveries present a continuous logical clock without extrapolation',()=>{
  let seconds=0,duration=.05,last=0;
  const buffer=new PresentationBuffer(0,frame=>{duration=frame.seconds-seconds;seconds=frame.seconds;});
  const frames=Array.from({length:20},(_,i)=>({serial:i+1,seconds:(i+1)*.05,stamp:1000+(i+1)*50,arrival:1000+(i+1)*50+[4,20,2,34,8][i%5]}));
  for(let now=1000;now<2000;now+=10){
    while(frames[0]?.arrival<=now)buffer.add(frames.shift()!);
    buffer.advance(now);
    const displayed=seconds-(1-buffer.alpha)*duration;
    assert(displayed>=last-1e-8,'no rewind on a late publication');
    if(now>=1150)assert(Math.abs(displayed-(now-1100)/1000)<1e-8,'normal delivery jitter must not cause stop/catch-up');
    assert(displayed<=seconds);last=displayed;
  }
});
test('pause flushes all changes and resume starts a new bounded timeline',()=>{
  const applied:number[]=[];const buffer=new PresentationBuffer(0,f=>applied.push(f.serial));
  buffer.add({serial:1,seconds:.05,stamp:1050});buffer.add({serial:2,seconds:.05,stamp:1050});
  buffer.reset(.05,2);assert.deepEqual(applied,[1,2]);assert.equal(buffer.alpha,1);
  buffer.add({serial:3,seconds:.1,stamp:10050});buffer.advance(10125);
  assert.equal(buffer.alpha,.5);assert.deepEqual(applied,[1,2,3]);
});
