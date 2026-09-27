import path from 'node:path'
import {readIntegrationJson,writeIntegrationJson} from '../integration-store.js'
import {searchOrders,type SearchEngine,type SearchRegion} from './search-engines.js'
export type SearchHealthRow={region:SearchRegion;engine:SearchEngine;successes:number;failures:number;updatedAt:string;expiresAt:string;deprioritized:boolean}
type Sample={region:SearchRegion;engine:SearchEngine;at:number;ok:boolean}
/** One failure never changes priority. Samples expire, so providers are always retried. */
export class SearchHealth {
 private file:string
 constructor(private directory:string,private now:()=>number=()=>Date.now()){this.file=path.join(directory,'search-health.json')}
 private enabled(){try{return readIntegrationJson(path.join(this.directory,'experience-library.json'),{enabled:true}).enabled===true}catch{return false}}
 private samples():Sample[]{
  const rows=readIntegrationJson<Sample[]>(this.file,[])
  if(!Array.isArray(rows)||rows.length>800)throw new Error('搜索经验格式无效')
  return rows.filter(row=>row&&Object.hasOwn(searchOrders,row.region)&&searchOrders[row.region].includes(row.engine)&&Number.isFinite(row.at)&&row.at<=this.now()&&row.at>this.now()-86400000&&typeof row.ok==='boolean')
 }
 state():SearchHealthRow[]{
  const groups=new Map<string,Sample[]>()
  for(const row of this.samples()){const key=row.region+row.engine;groups.set(key,[...(groups.get(key)||[]),row])}
  return [...groups.values()].map(rows=>{const last=rows.at(-1)!;return {region:last.region,engine:last.engine,successes:rows.filter(r=>r.ok).length,failures:rows.filter(r=>!r.ok).length,updatedAt:new Date(last.at).toISOString(),expiresAt:new Date(last.at+86400000).toISOString(),deprioritized:rows.length>=2&&rows.slice(-2).every(r=>!r.ok)}})
 }
 routing<T extends {region:SearchRegion;basis:string}>(routing:T){
  const base=[...searchOrders[routing.region]]
  if(!this.enabled())return {...routing,order:base}
  let state:SearchHealthRow[];try{state=this.state()}catch{return {...routing,order:base}}
  const poor=new Set(state.filter(row=>row.region===routing.region&&row.deprioritized).map(row=>row.engine))
  const count=routing.region==='CN'?5:3,primary=base.slice(0,count)
  return {...routing,order:[...primary.filter(name=>!poor.has(name)),...primary.filter(name=>poor.has(name)),...base.slice(count)]}
 }
 observe(output:unknown){
  if(!this.enabled())return
  try{
   const value=typeof output==='string'?JSON.parse(output):output as any
   if(!value||!Object.hasOwn(searchOrders,value.region)||!Array.isArray(value.providers))return
   const samples=this.samples(),region=value.region as SearchRegion
   for(const provider of value.providers.slice(0,10)){
    const engine=String(provider.name).toLowerCase() as SearchEngine
    if(!searchOrders[region].includes(engine)||!['ok','empty','failed'].includes(provider.status))continue
    samples.push({region,engine,at:this.now(),ok:provider.status==='ok'&&provider.count>0})
   }
   const bounded=samples.filter((row,index)=>samples.slice(index+1).filter(next=>next.engine===row.engine&&next.region===row.region).length<20)
   writeIntegrationJson(this.file,bounded.slice(-800))
  }catch{/* Optional learning must not turn a successful query into a tool failure. */}
 }
}
