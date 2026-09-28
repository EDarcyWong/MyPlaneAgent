import type {ModelTokenSample} from '../shared/model-performance.js'
import type {TokenUsage} from '../shared/local-ai-usage.js'

// No prompts, response text or credentials are retained. Each HTTP attempt is separate.
export class ExternalModelPerformanceTracker {
 private sequence=0
 private records=new Map<number,{endpoint:string;sample:ModelTokenSample;characters:number;usage?:TokenUsage}>()
 reset(){this.records.clear()}
 begin(endpoint:string,model:string,now=Date.now()){
  const id=++this.sequence
  this.records.set(id,{endpoint:endpoint.replace(/\/$/,''),characters:0,sample:{source:'external',model,slot:0,task:id,phase:'processing',updatedAt:now,startedAt:now,tokenBasis:'estimated'}})
  while(this.records.size>16)this.records.delete(this.records.keys().next().value!)
  return id
 }
 progress(id:number,characters:number,now=Date.now()){
  const record=this.records.get(id);if(!record||!Number.isFinite(characters)||characters<=record.characters)return
  record.characters=characters
  record.sample.firstOutputMs??=Math.max(0,now-record.sample.startedAt!)
  record.sample.phase='generating'
  this.update(id,now,false)
 }
 usage(id:number,usage:TokenUsage){const record=this.records.get(id);if(record)record.usage={...record.usage,...usage}}
 private update(id:number,now:number,final:boolean){
  const record=this.records.get(id);if(!record)return
  const sample=record.sample,elapsed=Math.max(0,now-sample.startedAt!)
  sample.elapsedMs=elapsed;sample.updatedAt=now;sample.inputTokens=record.usage?.inputTokens
  // Intermediate usage may describe only the beginning of an Anthropic stream.
  const actual=final&&record.usage?.outputTokens!==undefined
  sample.tokenBasis=actual?'usage':'estimated'
  sample.outputTokens=actual?record.usage!.outputTokens:record.characters?Math.ceil(record.characters/4):undefined
  sample.outputRate=(final?elapsed>0:elapsed>=100)&&sample.outputTokens!==undefined?sample.outputTokens/(elapsed/1000):undefined
  if(sample.outputRate!==undefined){
   const history=(sample.history||[]).filter(point=>point.at>=now-60000)
   const point={at:now,outputRate:sample.outputRate}
   if(history.length&&Math.floor(now/500)===Math.floor(history.at(-1)!.at/500))history[history.length-1]=point
   else history.push(point)
   sample.history=history.slice(-120)
  }
 }
 finish(id:number,outcome:NonNullable<ModelTokenSample['outcome']>,characters=0,now=Date.now()){
  const record=this.records.get(id);if(!record)return
  record.characters=Math.max(record.characters,characters)
  this.update(id,now,outcome==='complete')
  record.sample.phase='finished';record.sample.outcome=outcome
 }
 snapshot(endpoint?:string,now=Date.now()){
  return [...this.records.entries()].filter(([,record])=>!endpoint||record.endpoint===endpoint.replace(/\/$/,'')).map(([id,record])=>{
   if(record.sample.phase!=='finished')this.update(id,now,false)
   return structuredClone(record.sample)
  }).sort((a,b)=>b.task-a.task)
 }
}
export const externalModelPerformance=new ExternalModelPerformanceTracker()
