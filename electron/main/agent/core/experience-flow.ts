import type {ExperienceEntry,ExperienceRecipe,ExperienceFailureKind} from '../../../shared/experience.js'
import {experienceFailure} from './experience-failure.js'
import type {StudioToolActivity} from '../../../shared/local-ai-studio.js'
import {AgentWorkspace} from '../workspace.js'
import {relevantSearchResult} from '../search-engines.js'
import {hostMatches,recipeTools} from './experience-store.js'
import {parseExperienceRequest} from './experience-request.js'
import {parseWeatherRequest,weatherDate} from './weather-workflow.js'
import {isWebLookup} from '../../../shared/task-scope.js'

export type FlowAction={capability:string;args:Record<string,unknown>}
export function flowInputs(query:string,recipe:ExperienceRecipe):Record<string,string>|undefined{
 if(recipe.kind==='weather-web'){const request=parseWeatherRequest(query);if(request?.city&&request.day)try{weatherDate(request.day,'Asia/Shanghai',new Date());return request}catch{};return}
 const request=parseExperienceRequest(query)
 return request?.kind===recipe.kind?request.values:recipe.kind==='web-research'&&isWebLookup(query)&&!parseWeatherRequest(query)?{query:query.trim()}:undefined
}
function parsed(value:unknown):Record<string,any>{
 try{const data=typeof value==='string'?JSON.parse(value):value;return data&&typeof data==='object'&&!Array.isArray(data)?data:{}}catch{return {}}
}
export class ExperienceFlow {
 private index=0
 private page=''
 private pages:string[]=[]
 private awaiting?:FlowAction
 finished=false
 passed=false
 reason=''
 failureKind:ExperienceFailureKind='incomplete'
 private validationRejected=false
 checks:string[]=[]
 readonly failedReadIds=new Set<string>()
 private skippedPages=0
 readonly tools:string[]
 constructor(readonly entry:ExperienceEntry,private values:Record<string,string>,private workspace:string,private expectedText?:string,readonly isCurrent:()=>boolean=()=>true){
  this.tools=recipeTools(entry.recipe!)
  if(!['file-read','web-research','weather-web'].includes(entry.recipe!.kind))throw new Error('此流程没有通用执行器')
  if(entry.recipe!.kind==='weather-web'){
   if(!entry.recipe!.sourceHost||!values.city||!values.day)throw new Error('请补充天气来源网站、城市与日期')
   const request=parseWeatherRequest(values.city+values.day+'天气')
   if(!request?.city||!request.day)throw new Error('城市或日期不支持，请明确填写')
   this.values={...values,date:weatherDate(values.day,'Asia/Shanghai',new Date()),query:values.city+' '+weatherDate(values.day,'Asia/Shanghai',new Date())+' 天气预报'}
  }
  if(expectedText!==undefined&&(!expectedText.trim()||expectedText.length>300))throw new Error('试运行须提供 1–300 字的预期正文片段')
 }
 next():FlowAction|undefined{
  if(this.finished||this.awaiting)return
  if(!this.isCurrent())throw new Error('流程已被编辑、停用或过期')
  const recipe=this.entry.recipe!
  if(recipe.kind==='file-read'){
   if(!this.values.path)throw new Error('缺少相对文件路径')
   new AgentWorkspace(this.workspace).resolve(this.values.path)
   return this.awaiting={capability:'agent.read_file',args:{path:this.values.path,startLine:1,endLine:200}}
  }
  if(!this.values.query||this.values.query.length>300)throw new Error('查询词需为 1–300 字')
  return this.awaiting=this.index===0?{capability:'agent.web_search',args:{query:this.values.query+(recipe.kind==='weather-web'?' site:'+recipe.sourceHost:''),limit:recipe.maxResults}}:{capability:'agent.web_fetch',args:{url:this.page,maxCharacters:recipe.maxCharacters}}
 }
 fail(reason:string,kind:ExperienceFailureKind='validation'){this.finished=true;this.passed=false;this.reason=reason;this.failureKind=kind;this.awaiting=undefined}
 private rejectPage(reason:string,kind:ExperienceFailureKind='validation'){
  if(kind==='validation')this.validationRejected=true
  this.skippedPages++
  this.reason=reason+'；尝试下一条符合条件的搜索结果。'
  const next=this.pages.shift()
  if(next){this.page=next;return}
  this.fail(reason+'；已无符合条件的备用结果。',this.validationRejected?'validation':kind)
 }
 observe(activity:StudioToolActivity){
  if(!this.awaiting||activity.capability!==this.awaiting.capability||!['complete','error','denied'].includes(activity.status))return
  const action=this.awaiting;this.awaiting=undefined
  if(!this.isCurrent()){this.fail('流程版本已变化，本次结果不用于认证新版本','changed');return}
  if(activity.status!=='complete'){
   const kind=activity.status==='denied'?'denied':experienceFailure(activity.output)
   if(activity.status==='error'&&action.capability==='agent.web_fetch'&&kind!=='denied'&&kind!=='cancelled'){this.failedReadIds.add(activity.id);this.rejectPage('网页读取失败',kind)}
   else this.fail(activity.status==='denied'?'流程操作被拒绝':'流程工具执行失败',kind)
   return
  }
  const data=parsed(activity.output),recipe=this.entry.recipe!
  if(action.capability==='agent.web_search'){
   const rows=Array.isArray(data.results)?data.results:[]
   const candidates=rows.filter((item:any)=>{
    try{const url=new URL(item.url);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&hostMatches(url.hostname,recipe.sourceHost)&&relevantSearchResult(this.values.query,String(item.title||''),String(item.snippet||''))}catch{return false}
   })
   this.pages=[...new Set<string>(candidates.map((item:any)=>item.url))].slice(0,recipe.maxResults)
   if(!this.pages.length){this.fail('没有匹配查询词及来源条件的搜索结果',rows.length?'validation':'temporary');return}
   this.page=this.pages.shift()!;this.index=1;this.checks.push('搜索返回相关且符合来源条件的链接');return
  }
  const reject=(reason:string)=>action.capability==='agent.web_fetch'?this.rejectPage(reason):this.fail(reason)
  if(typeof data.text!=='string'||!data.text.trim()){reject('工具未返回可验证的正文');return}
  if(action.capability==='agent.read_file'){
   if(data.path!==this.values.path){this.fail('读取结果路径不匹配');return}
  }else{
   try{const final=new URL(data.finalUrl||data.url);if((data.requestedUrl||data.url)!==this.page||!['https:','http:'].includes(final.protocol)||final.username||final.password||!hostMatches(final.hostname,recipe.sourceHost))throw new Error()}catch{reject('正文来源与实际搜索链接或来源限制不匹配');return}
   if(!relevantSearchResult(this.values.query,String(data.title||''),data.text)){reject('网页正文与本次查询没有可核对的关联');return}
  }
  if(this.expectedText&&!data.text.includes(this.expectedText)){reject('正文中未找到本次试运行提供的预期片段');return}
  if(recipe.kind==='weather-web'&&!weatherPageMatches(data.text,this.values.city,this.values.date)){reject('天气正文未同时提供本次城市、目标日期和温度信息');return}
  this.checks.push(action.capability==='agent.read_file'?'在当前授权目录读取指定文件':'已读取实际搜索链接，正文与本次查询相关')
  if(this.expectedText)this.checks.push('正文包含本次提供的预期片段（片段不保存）')
  this.finished=true;this.passed=true;this.reason=(this.skippedPages?'已跳过 '+this.skippedPages+' 条不可用或未通过检查的结果。':'')+'本次流程检查通过；仅证明读取流程和本次证据有效，不代表所有事实已核实。'
 }
}
/** Conservative evidence check; never infer a forecast date from retrieval time. */
export function weatherPageMatches(text:string,city:string,date:string){
 const [year,month,day]=date.split('-').map(Number)
 const dates=[date,`${year}年${month}月${day}日`,`${year}/${month}/${day}`]
 return !!city&&text.includes(city)&&dates.some(value=>text.includes(value))&&/天气|预报/.test(text)&&/-?\d+(?:\.\d+)?\s*(?:°C|℃|摄氏度)/i.test(text)
}
