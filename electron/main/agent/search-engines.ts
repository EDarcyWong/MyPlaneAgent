export type SearchRegion='CN'|'KR'|'RU'|'GLOBAL'
export type SearchEngine='google'|'bing'|'yahoo'|'yandex'|'duckduckgo'|'baidu'|'shenma'|'so'|'sogou'|'naver'
export const searchOrders:Record<SearchRegion,SearchEngine[]>={
 CN:['baidu','bing','so','sogou','shenma','google','duckduckgo','yahoo','yandex','naver'],
 KR:['naver','google','bing','duckduckgo','yahoo','yandex','baidu','so','sogou','shenma'],
 RU:['yandex','google','bing','duckduckgo','yahoo','baidu','so','sogou','shenma','naver'],
 GLOBAL:['google','bing','duckduckgo','yahoo','yandex','baidu','so','sogou','shenma','naver']
}
/** A routing hint, not a claim of GPS/IP location. Query language is not location. */
export function searchRegion(input:{override?:string;timezone?:string;locale?:string}={}){
 const override=(input.override??process.env.MYPLANE_SEARCH_REGION??'AUTO').toUpperCase()
 if(override!=='AUTO'){
  if(!Object.hasOwn(searchOrders,override))throw new Error('MYPLANE_SEARCH_REGION 必须为 AUTO、CN、KR、RU 或 GLOBAL')
  return {region:override as SearchRegion,basis:'override'}
 }
 const timezone=input.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone
 const locale=input.locale??Intl.DateTimeFormat().resolvedOptions().locale
 if(['Asia/Shanghai','Asia/Chongqing','Asia/Chungking','Asia/Harbin','Asia/Urumqi'].includes(timezone))return {region:'CN' as const,basis:'timezone'}
 if(timezone==='Asia/Seoul')return {region:'KR' as const,basis:'timezone'}
 if(/^(?:Europe\/(?:Moscow|Kaliningrad|Samara|Kirov|Saratov|Ulyanovsk|Volgograd|Astrakhan)|Asia\/(?:Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Vladivostok|Khandyga|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr))$/.test(timezone))return {region:'RU' as const,basis:'timezone'}
 if(timezone&& !['UTC','Etc/UTC','Etc/GMT','GMT'].includes(timezone))return {region:'GLOBAL' as const,basis:'timezone'}
 const territory=locale.replace(/_/g,'-').match(/-(CN|KR|RU)(?:-|$)/i)?.[1]?.toUpperCase()
 return {region:(territory??'GLOBAL') as SearchRegion,basis:territory?'locale':'default'}
}
export function searchEngineUrl(engine:SearchEngine,query:string,limit:number){
 const definitions:Record<SearchEngine,[string,Record<string,string>]>={
  google:['https://www.google.com/search',{q:query,num:String(limit)}],
  bing:['https://www.bing.com/search',{q:query,format:'rss'}],
  yahoo:['https://search.yahoo.com/search',{p:query}],
  yandex:['https://yandex.com/search/',{text:query}],
  duckduckgo:['https://html.duckduckgo.com/html/',{q:query}],
  baidu:['https://www.baidu.com/s',{wd:query,rn:String(limit)}],
  shenma:['https://m.sm.cn/s',{q:query}],
  so:['https://www.so.com/s',{q:query}],
  sogou:['https://www.sogou.com/web',{query}],
  naver:['https://search.naver.com/search.naver',{query}]
 }
 const [url,params]=definitions[engine];return url+'?'+new URLSearchParams(params)
}
export function relevantSearchResult(query:string,title:string,snippet:string){
 const stop=new Set(['what','when','where','which','how','the','and','for','with','from','this','that','please','search','find','about','is','are','of','to','in','on','a','an','com','www','http','https','site'])
 const terms=(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]).filter(word=>!stop.has(word))
 const anchors=terms.flatMap(word=>/[\u3400-\u9fff]/.test(word)&&word.length>2?Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)):[word])
 const text=(title+' '+snippet).toLowerCase()
 return !anchors.length||anchors.some(term=>text.includes(term))
}
/** Try providers in regional order; never substitute an encyclopedia search page. */
export async function runSearchPlan<T>(region:SearchRegion,signal:AbortSignal,search:(engine:SearchEngine)=>Promise<T[]>,order:SearchEngine[]=searchOrders[region]){
 const providers:Array<{name:SearchEngine;status:'ok'|'empty'|'failed';count?:number;error?:string}>=[]
 for(const name of order){
  signal.throwIfAborted()
  try{
   const results=await search(name);signal.throwIfAborted()
   providers.push({name,status:results.length?'ok':'empty',count:results.length})
   if(results.length)return {providers,results}
  }catch(error){signal.throwIfAborted();providers.push({name,status:'failed',error:String((error as {code?:string})?.code||'WEB_SEARCH_FAILED')})}
 }
 return {providers,results:[] as T[]}
}
