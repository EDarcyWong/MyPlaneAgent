export type {TaskCompletionReview as CompletionReview} from '../../../shared/task-plan.js'
import type {TaskCompletionReview as CompletionReview} from '../../../shared/task-plan.js'
// Accept a single JSON object wrapped in prose/fences, never infer completion from prose.
export function parseCompletionReview(raw:string):CompletionReview|undefined {
 const text=raw.replace(/<think>[\s\S]*?<\/think>/gi,'').trim()
 if(/<\/?think>/i.test(text))return
 const start=text.indexOf('{'),end=text.lastIndexOf('}')
 if(start<0||end<start)return
 try{
  const value=JSON.parse(text.slice(start,end+1))
  if(!value||!['complete','continue','needs_input','blocked'].includes(value.status)||typeof value.reason!=='string'||!value.reason.trim())return
  let implementation:CompletionReview['implementation']
  if(value.implementation!==undefined){
   const result=value.implementation
   if(!result||!['missing','present','unknown'].includes(result.status)||!Array.isArray(result.evidenceIds)||result.evidenceIds.length>8||result.evidenceIds.some((id:unknown)=>typeof id!=='string'||id.length>100))return
   implementation={status:result.status,evidenceIds:result.evidenceIds}
  }
  let actions:CompletionReview['actions']
  if(value.actions!==undefined){
   if(!Array.isArray(value.actions)||value.actions.length>6)return
   actions=[]
   for(const action of value.actions){
    if(!action||typeof action.title!=='string'||!action.title.trim()||action.title.length>240||typeof action.capability!=='string'||action.capability.length>150||!action.args||typeof action.args!=='object'||Array.isArray(action.args)||JSON.stringify(action.args).length>6000||typeof action.basis!=='string'||!action.basis.trim()||action.basis.length>500||typeof action.required!=='boolean')return
    actions.push({title:action.title.trim(),capability:action.capability,args:action.args,basis:action.basis,required:action.required})
   }
  }
  if(value.status==='continue'&&(typeof value.nextStep!=='string'||!value.nextStep.trim())&&!actions?.some(action=>action.required))return
  return {...(implementation?{implementation}:{}),...(actions?{actions}:{}),...(Array.isArray(value.optionalChecks)?{optionalChecks:value.optionalChecks.filter((item:unknown)=>typeof item==='string'&&item.trim()).slice(0,8).map((item:string)=>item.slice(0,500))}:{}),status:value.status,reason:value.reason.trim(),nextStep:typeof value.nextStep==='string'&&value.nextStep.trim()?value.nextStep.trim():actions?.some(action=>action.required)?'执行下一项必要检查':'',...(Array.isArray(value.missingEvidence)?{missingEvidence:value.missingEvidence.filter((item:unknown)=>typeof item==='string'&&item.trim()).slice(0,8).map((item:string)=>item.slice(0,500))}:{})}
 }catch{return}
}
