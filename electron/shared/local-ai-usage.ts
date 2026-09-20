// Counts come from the model service; missing values are never estimated as zero.
export type TokenUsage={inputTokens?:number;outputTokens?:number;totalTokens?:number}
export type TokenUsageTotals={requests:number;inputTokens:number;outputTokens:number;totalTokens:number;inputReports:number;outputReports:number;totalReports:number;incompleteHistory?:boolean}
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined
export function readTokenUsage(payload:unknown):TokenUsage|undefined{
 const data=object(payload),usage=object(data.usage),timings=object(data.timings)
 const inputTokens=count(usage.prompt_tokens)??count(usage.input_tokens)??count(timings.prompt_n)
 const outputTokens=count(usage.completion_tokens)??count(usage.output_tokens)??count(timings.predicted_n)
 const totalTokens=count(usage.total_tokens)??(inputTokens!==undefined&&outputTokens!==undefined?count(inputTokens+outputTokens):undefined)
 if(inputTokens===undefined&&outputTokens===undefined&&totalTokens===undefined)return
 return {...(inputTokens!==undefined?{inputTokens}:{}),...(outputTokens!==undefined?{outputTokens}:{}),...(totalTokens!==undefined?{totalTokens}:{})}
}
export function mergeTokenUsage(previous:TokenUsage|undefined,next:TokenUsage):TokenUsage{
 const merged={...previous,...next}
 if(next.totalTokens===undefined&&(next.inputTokens!==undefined||next.outputTokens!==undefined)){
  if(merged.inputTokens!==undefined&&merged.outputTokens!==undefined)merged.totalTokens=merged.inputTokens+merged.outputTokens
  else delete merged.totalTokens
 }
 return merged
}
export function emptyTokenUsageTotals():TokenUsageTotals{return {requests:0,inputTokens:0,outputTokens:0,totalTokens:0,inputReports:0,outputReports:0,totalReports:0}}
// Usage frames are cumulative snapshots for ONE request, not token deltas.
export function updateTokenUsageTotals(total:TokenUsageTotals,previous:TokenUsage|undefined,next:TokenUsage){
 for(const [field,reports] of [['inputTokens','inputReports'],['outputTokens','outputReports'],['totalTokens','totalReports']] as const){
  const before=previous?.[field],after=next[field]
  total[field]+=(after??0)-(before??0)
  total[reports]+=Number(after!==undefined)-Number(before!==undefined)
 }
}
export function sumTokenUsage(usages:(TokenUsage|undefined)[]):TokenUsageTotals{
 const total=emptyTokenUsageTotals();total.requests=usages.length
 for(const usage of usages)if(usage)updateTokenUsageTotals(total,undefined,usage)
 return total
}
