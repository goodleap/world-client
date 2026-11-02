/** Short confirmation for accepted commands which deliberately release selection.
 * The clock starts only when an authoritative route exists. */
export class CommandGuidance {
  private pending?: { id:string; token:number|string; at?:number };
  request(id:string, token:number|string) { this.pending={id,token}; }
  clear() { this.pending=undefined; }
  sample(seconds:number, current:(id:string)=>{token?:number|string;alive:boolean;route:boolean},selected?:string) {
    const p=this.pending;if(!p)return;
    const state=current(p.id);
    if(!state.alive||state.token!==p.token||selected===p.id){this.clear();return;}
    if(!state.route){if(p.at!==undefined)this.clear();return;}
    p.at??=seconds;
    const elapsed=seconds-p.at;if(elapsed>=2.5){this.clear();return;}
    return {id:p.id,alpha:Math.min(1,(2.5-elapsed)/.5)};
  }
}
