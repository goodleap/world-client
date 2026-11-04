import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadingHistory, LOADING_HISTORY_KEY } from '../src/loading-history.ts';

function setup() {
  let text: string | null = null, now = 1000, writes = 0;
  const store = { getItem: (key: string) => { assert.equal(key, LOADING_HISTORY_KEY); return text; },
    setItem: (key: string, value: string) => { assert.equal(key, LOADING_HISTORY_KEY); text=value; writes++; } };
  return { store, clock:()=>now, tick:(ms:number)=>{now+=ms;}, writes:()=>writes,
    saved:()=>JSON.parse(text!), corrupt:(value:string)=>{text=value;} };
}
test('an interrupted load keeps its build, real stage and events across reload without claiming a cause',()=>{
  const h=setup(),first=new LoadingHistory(()=>h.store,h.clock);
  first.begin('before','new');first.checkpoint(94.2,'材质、纹理与着色器就绪',410);
  first.event('context-lost');first.event('pagehide');
  const next=new LoadingHistory(()=>h.store,h.clock);
  assert.equal(next.snapshot().previous?.status,'loading');assert.equal(next.snapshot().previous?.build,'before');
  assert.equal(next.snapshot().previous?.percent,94.2);
  next.begin('after','continue');next.checkpoint(99,'首帧显示',200);next.ready();
  assert.equal(next.snapshot().current?.status,'ready');assert.equal(next.snapshot().previous?.status,'loading');
  assert.deepEqual(next.snapshot().previous?.events.map(e=>e.name),['context-lost','pagehide']);
  assert.equal(new LoadingHistory(()=>h.store,h.clock).snapshot().previous?.status,'ready');
});
test('frequent assembly updates are throttled while first frame, manual retry and failure flush immediately',()=>{
  const h=setup(),history=new LoadingHistory(()=>h.store,h.clock);history.begin('build','new');
  for(let i=0;i<100;i++){h.tick(1);history.checkpoint(i*.9,'装配 '+i,null);}
  assert.equal(h.writes(),1);
  history.checkpoint(94,'材质、纹理与着色器就绪',null);assert.equal(h.writes(),2);
  h.tick(500);history.checkpoint(98,'材质、纹理与着色器就绪',200);assert.equal(h.writes(),3);
  history.checkpoint(99,'首帧显示',200);assert.equal(h.writes(),4);
  history.fail(new Error('asset failed'));history.event('manual-retry');
  assert.equal(h.saved().current.status,'error');assert.equal(h.saved().current.error,'asset failed');
  for(let i=0;i<20;i++)history.event('hidden');assert.equal(h.saved().current.events.length,8);
  assert(JSON.stringify(h.saved()).length<3000);
});
test('blocked or corrupt diagnostic storage never prevents loading and never changes a game save',()=>{
  const history=new LoadingHistory(()=>{throw new Error('storage blocked');});
  assert.doesNotThrow(()=>{history.begin('build','new');history.checkpoint(50,'模型',null);history.ready();});
  assert.equal(history.snapshot().available,false);assert.equal(history.snapshot().current?.status,'ready');
  const h=setup();h.corrupt('{bad');const recovered=new LoadingHistory(()=>h.store,h.clock);
  assert.equal(recovered.snapshot().previous,undefined);recovered.begin('build','new');assert(h.saved().current);
});
