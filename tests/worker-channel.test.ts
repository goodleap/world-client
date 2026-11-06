import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerChannel } from '../src/game/worker-channel.ts';

test('worker channel transfers ownership, relays callbacks and propagates errors/teardown',async()=>{
  const {port1,port2}=new MessageChannel(),client=createWorkerChannel(port1),worker=createWorkerChannel(port2);
  try{
    client.handle((method,args)=>{assert.equal(method,'persist');return args[0]==='complete-tick';});
    worker.handle(async(method,args)=>{
      if(method==='fail')throw new Error('explicit failure');
      if(method==='stalled')return new Promise(()=>{});
      if(method==='buffer')return (args[0] as ArrayBuffer).byteLength;
      const callback=args[0] as (text:string)=>Promise<boolean>;
      return await callback('complete-tick')&&await worker.call('persist',['complete-tick']);
    });
    assert.equal(await client.call('save',[async(text:string)=>text==='complete-tick']),true);
    const bytes=new ArrayBuffer(128);assert.equal(await client.call('buffer',[bytes],[bytes]),128);assert.equal(bytes.byteLength,0);
    await assert.rejects(client.call('fail'),/explicit failure/);
    await assert.rejects(client.call('stalled',[],[],10),/timeout/);
    const pending=client.call('stalled');client.close();await assert.rejects(pending,/disposed/);
  }finally{client.close();worker.close();port1.close();port2.close();}
});
