export type CompletionReview = {status:'complete'|'continue'|'needs_input'|'blocked';reason:string;nextStep:string}
// Accept a single JSON object wrapped in prose/fences, never infer completion from prose.
export function parseCompletionReview(raw:string):CompletionReview|undefined {
 const text=raw.replace(/<think>[\s\S]*?<\/think>/gi,'').trim()
 if(/<\/?think>/i.test(text))return
 const start=text.indexOf('{'),end=text.lastIndexOf('}')
 if(start<0||end<start)return
 try{
  const value=JSON.parse(text.slice(start,end+1))
  if(!value||!['complete','continue','needs_input','blocked'].includes(value.status)||typeof value.reason!=='string'||!value.reason.trim())return
  if(value.status==='continue'&&(typeof value.nextStep!=='string'||!value.nextStep.trim()))return
  return {status:value.status,reason:value.reason.trim(),nextStep:typeof value.nextStep==='string'?value.nextStep.trim():''}
 }catch{return}
}
