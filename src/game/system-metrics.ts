/** Bounded counters: no per-frame logs, retained samples or scene traversal. */
export class SystemMetrics {
  private samples=new Map<string,{calls:number;totalMs:number;lastMs:number;maxMs:number}>();
  run<T>(name:string,work:()=>T):T {
    const start=performance.now();
    try{return work();}finally{
      const ms=performance.now()-start,s=this.samples.get(name)??{calls:0,totalMs:0,lastMs:0,maxMs:0};
      s.calls++;s.totalMs+=ms;s.lastMs=ms;s.maxMs=Math.max(s.maxMs,ms);this.samples.set(name,s);
    }
  }
  snapshot(){return Object.fromEntries([...this.samples].map(([name,s])=>[name,{calls:s.calls,lastMs:s.lastMs,meanMs:s.totalMs/s.calls,maxMs:s.maxMs}]));}
}
