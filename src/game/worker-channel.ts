/** Small bidirectional request/reply channel. All gameplay payloads are data;
 * callback tokens refer only to registered UI/control handlers. */
export interface ChannelTransport{postMessage(message:unknown,transfer?:Transferable[]):void;addEventListener(type:'message',listener:(event:MessageEvent)=>void):void;removeEventListener(type:'message',listener:(event:MessageEvent)=>void):void}
export function createWorkerChannel(port:ChannelTransport){
  let serial=0,callbackId=0,closed=false;
  const pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const callbacks=new Map<number,(...args:unknown[])=>unknown>(),known=new WeakMap<(...args:never[])=>unknown,number>();
  let handler:(method:string,args:unknown[])=>unknown=()=>{throw new Error('Worker not initialized');};
  const encode=(value:unknown):unknown=>{
    if(typeof value==='function'){
      let id=known.get(value as (...args:never[])=>unknown);if(id===undefined){id=++callbackId;known.set(value as (...args:never[])=>unknown,id);callbacks.set(id,value as (...args:unknown[])=>unknown);}return {$callback:id};
    }
    if(Array.isArray(value))return value.map(encode);
    if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
    return value;
  };
  const decode=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(decode);
    if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
      if('$callback'in value)return (...args:unknown[])=>{const reply=call('$callback',[value.$callback,...args]);void reply.catch(error=>{if(!closed)console.error(error);});return reply;};
      return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
    }return value;
  };
  function call(method:string,args:unknown[]=[],transfer:Transferable[]=[],timeout=30_000):Promise<unknown>{
    if(closed)return Promise.reject(new Error('Worker channel closed'));
    const id=++serial;return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Worker timeout: ${method}`));},timeout);
      pending.set(id,{resolve,reject,timer});
      try{port.postMessage({kind:'request',id,method,args:encode(args)},transfer);}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
    });
  }
  const notify=(method:string,args:unknown[]=[],transfer:Transferable[]=[])=>{if(!closed)port.postMessage({kind:'notify',method,args:encode(args)},transfer);};
  const receive=async(event:MessageEvent)=>{
    const m=event.data;if(!m||!['request','reply','notify'].includes(m.kind)||closed)return;
    if(m.kind==='reply'){
      const entry=pending.get(m.id);if(!entry)return;pending.delete(m.id);clearTimeout(entry.timer);
      if(m.error)entry.reject(new Error(m.error));else entry.resolve(m.value);return;
    }
    try{
      const args=decode(m.args) as unknown[];
      const value=await (m.method==='$callback'?callbacks.get(args[0] as number)?.(...args.slice(1)):handler(m.method,args));
      if(m.kind==='request')port.postMessage({kind:'reply',id:m.id,value});
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(m.kind==='request')port.postMessage({kind:'reply',id:m.id,error:message});else console.error(`Worker notification ${m.method}:`,error);
    }
  };
  port.addEventListener('message',receive);
  return {call,notify,handle(value:typeof handler){handler=value;},close(reason='Worker disposed'){
    closed=true;port.removeEventListener('message',receive);for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}pending.clear();callbacks.clear();
  }};
}
export type WorkerChannel=ReturnType<typeof createWorkerChannel>;
