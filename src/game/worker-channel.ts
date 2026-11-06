import { expose,wrap,transfer,releaseProxy } from 'comlink';
import type { Endpoint } from 'comlink';

export interface ChannelTransport{postMessage(message:unknown,transfer?:Transferable[]):void;addEventListener(type:'message',listener:(event:MessageEvent)=>void):void;removeEventListener(type:'message',listener:(event:MessageEvent)=>void):void;start?():void}
/** Comlink owns RPC, error transport and transferable ownership. The adapter
 * adds game-lifecycle cancellation and callback IDs inside batched UI data. */
export function createWorkerChannel(port:ChannelTransport){
  let callbackId=0,closed=false;
  const pending=new Set<(error:Error)=>void>(),listeners=new Set<(event:MessageEvent)=>void>();
  const endpoint:ChannelTransport={postMessage:(data,list)=>port.postMessage(data,list),start:()=>port.start?.(),
    addEventListener(type,listener){listeners.add(listener);port.addEventListener(type,listener);},removeEventListener(type,listener){listeners.delete(listener);port.removeEventListener(type,listener);}};
  const scopes=new Map<string,Set<number>>();
  const callbacks=new Map<number,(...args:unknown[])=>unknown>(),known=new WeakMap<(...args:never[])=>unknown,number>();
  let handler:(method:string,args:unknown[])=>unknown=()=>{throw new Error('Worker not initialized');};
  const encode=(value:unknown,ids?:Set<number>):unknown=>{
    if(typeof value==='function'){
      let id=known.get(value as (...args:never[])=>unknown);if(id===undefined){id=++callbackId;known.set(value as (...args:never[])=>unknown,id);callbacks.set(id,value as (...args:unknown[])=>unknown);}else if(!callbacks.has(id))callbacks.set(id,value as (...args:unknown[])=>unknown);ids?.add(id);return {$callback:id};
    }
    if(Array.isArray(value))return value.map(v=>encode(v,ids));
    if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v,ids)]));
    return value;
  };
  const decode=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(decode);
    if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
      if('$callback'in value)return (...args:unknown[])=>{const reply=call('$callback',[value.$callback,...args]);void reply.catch(error=>{if(!closed)console.error(error);});return reply;};
      return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
    }return value;
  };
  interface Service{dispatch(packet:{method:string;args:unknown}):Promise<unknown>}
  expose({async dispatch(packet:{method:string;args:unknown}){
    if(closed)throw new Error('Worker channel closed');
    // Only the batched DOM API contains callbacks. State patches, geometry and
    // commands are already cloneable; let Comlink/browser transport copy them
    // once, without recursively rebuilding every record at both endpoints.
    const args=(packet.method==='ui'?decode(packet.args):packet.args) as unknown[];
    return packet.method==='$callback'?callbacks.get(args[0] as number)?.(...args.slice(1)):handler(packet.method,args);
  }} satisfies Service,endpoint as Endpoint);
  const remote=wrap<Service>(endpoint as Endpoint);
  function call(method:string,args:unknown[]=[],list:Transferable[]=[],timeout=30_000):Promise<unknown>{
    if(closed)return Promise.reject(new Error('Worker channel closed'));
    return new Promise((resolve,reject)=>{
      const finish=(error?:Error,value?:unknown)=>{clearTimeout(timer);pending.delete(cancel);if(error)reject(error);else resolve(value);};
      const cancel=(error:Error)=>finish(error),timer=setTimeout(()=>finish(new Error(`Worker timeout: ${method}`)),timeout);pending.add(cancel);
      const retired=new Set<number>();
      const encoded=method==='ui'?[((args[0]??[]) as {method:string;args:unknown[]}[]).map(call=>{
        const scope=call.method==='bind'?`bind:${String(call.args[0])}`:call.method;
        const ids=new Set<number>(),values=encode(call.args,ids),old=scopes.get(scope);
        if(old)for(const id of old)if(!ids.has(id))retired.add(id);scopes.set(scope,ids);
        return {method:call.method,args:values};
      })]:args;
      const release=()=>{for(const id of retired)if(![...scopes.values()].some(ids=>ids.has(id)))callbacks.delete(id);};
      remote.dispatch(transfer({method,args:encoded},list)).then(value=>{release();finish(undefined,value);},error=>{release();finish(error);});
    });
  }
  return {call,notify(method:string,args:unknown[]=[],list:Transferable[]=[]){if(!closed)void call(method,args,list).catch(error=>{if(!closed)console.error(error);});},
    snapshot:()=>({callbacks:callbacks.size,pending:pending.size}),
    handle(value:typeof handler){handler=value;},close(reason='Worker disposed'){
      if(closed)return;closed=true;for(const cancel of pending)cancel(new Error(reason));callbacks.clear();scopes.clear();remote[releaseProxy]();
      for(const listener of listeners)port.removeEventListener('message',listener);listeners.clear();
    }};
}
export type WorkerChannel=ReturnType<typeof createWorkerChannel>;
