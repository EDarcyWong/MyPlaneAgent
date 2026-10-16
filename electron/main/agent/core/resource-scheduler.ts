export type ResourceClaim={key:string;mode:'read'|'write'}
type Waiter={claims:ResourceClaim[];resolve:(release:()=>void)=>void;reject:(error:unknown)=>void;signal:AbortSignal;abort:()=>void}
/** Atomic, fair multi-resource acquisition; a cancelled waiter never owns a lock. */
export class ResourceScheduler {
  private active=new Set<ResourceClaim[]>()
  private pending:Waiter[]=[]
  private conflicts(a:ResourceClaim[],b:ResourceClaim[]) {return a.some(x=>b.some(y=>x.key===y.key&&(x.mode==='write'||y.mode==='write')))}
  acquire(claims:ResourceClaim[],signal:AbortSignal,onWait?:()=>void):Promise<()=>void> {
    signal.throwIfAborted()
    return new Promise((resolve,reject)=>{
      const waiter:Waiter={claims,resolve,reject,signal,abort:()=>{this.pending=this.pending.filter(item=>item!==waiter);reject(signal.reason);this.drain()}}
      this.pending.push(waiter);signal.addEventListener('abort',waiter.abort,{once:true});this.drain()
      if(this.pending.includes(waiter))try{onWait?.()}catch(error){this.pending=this.pending.filter(item=>item!==waiter);signal.removeEventListener('abort',waiter.abort);reject(error);this.drain()}
    })
  }
  private drain() {
    for(let i=0;i<this.pending.length;) {
      const waiter=this.pending[i]
      if([...this.active].some(claims=>this.conflicts(claims,waiter.claims))||this.pending.slice(0,i).some(other=>this.conflicts(other.claims,waiter.claims))){i++;continue}
      this.pending.splice(i,1);waiter.signal.removeEventListener('abort',waiter.abort);this.active.add(waiter.claims)
      let released=false
      waiter.resolve(()=>{if(released)return;released=true;this.active.delete(waiter.claims);this.drain()})
    }
  }
}
