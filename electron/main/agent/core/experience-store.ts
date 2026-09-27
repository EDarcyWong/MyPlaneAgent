import {createHash} from 'node:crypto'
import path from 'node:path'
import {parseExperienceRequest} from './experience-request.js'
import {isWebLookup} from '../../../shared/task-scope.js'
import {readIntegrationJson,writeIntegrationJson} from '../../integration-store.js'
import {recipeDetails,convertibleKind,failureLabels,mismatchHints,type ExperienceFailureKind,type ExperienceMismatch,type ExperienceEntry,type ExperienceState,type ExperienceRecipe,type ExperienceMatchContext} from '../../../shared/experience.js'

const knownTools=new Set(['weather.forecast','agent.web_search','agent.web_fetch','browser.open','browser.read_page','agent.read_file','agent.list_files','agent.search_files'])
export function experienceIntent(query:string):ExperienceEntry['intent']|undefined {
 const request=parseExperienceRequest(query)
 if(request?.kind==='file-read')return 'files'
 if(request?.kind==='web-research'&&!/天气|预报|带伞|下雨|weather|forecast/i.test(query))return 'research'
 if(/代码|编程|实现|开发|应用|知识库|程序|组件|\b(?:code|implement|develop)\b/i.test(query))return
 if(/天气|预报|带伞|下雨|weather|forecast/i.test(query))return 'weather'
 if(/读取|查阅|查看\s+\S+\.\w+|文件内容|read.*file/i.test(query))return 'files'
 if(/查询|查找|搜索|联网|search|research/i.test(query))return 'research'
 if(isWebLookup(query))return 'research'
}
export function defaultRecipe(intent:ExperienceEntry['intent'],tools:string[]):ExperienceRecipe{
 const kind=tools.length===1&&tools[0]==='weather.forecast'?'weather':tools.length===1&&tools[0]==='agent.read_file'?'file-read':tools.length===2&&tools[0]==='agent.web_search'&&tools[1]==='agent.web_fetch'?'web-research':'unsupported'
 return {kind,title:{weather:'天气查询',research:'公开资料查询',files:'文件查阅'}[intent],keywords:[],regions:[],sourceHost:kind==='weather'?'open-meteo.com':'',ttlHours:kind==='weather'?168:24,maxResults:3,maxCharacters:12000}
}
const sensitive=/-----BEGIN|\b(?:sk-|gh[pousr]_)[\w-]{12,}|(?:password|secret|token|api.?key)\s*[:=]/i
export function validateRecipe(value:ExperienceRecipe,kind:ExperienceRecipe['kind']):ExperienceRecipe{
 if(!value||value.kind!==kind||typeof value.title!=='string'||!value.title.trim()||value.title.length>100||sensitive.test(value.title))throw new Error('流程名称或类型无效')
 if(!Array.isArray(value.keywords)||value.keywords.length>8||value.keywords.some(word=>typeof word!=='string'||!word.trim()||word.length>40||sensitive.test(word)))throw new Error('最多填写 8 个非敏感匹配词，每个不超过 40 字')
 if(!Array.isArray(value.regions)||value.regions.some(region=>!['CN','KR','RU','GLOBAL'].includes(region)))throw new Error('地区条件无效')
 if(typeof value.sourceHost!=='string'||value.sourceHost.length>253||value.sourceHost&&!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(value.sourceHost))throw new Error('来源限制应是域名，例如 example.com，不含路径或密钥')
 if(!Number.isInteger(value.ttlHours)||value.ttlHours<1||value.ttlHours>720||!Number.isInteger(value.maxResults)||value.maxResults<1||value.maxResults>5||!Number.isInteger(value.maxCharacters)||value.maxCharacters<1000||value.maxCharacters>24000)throw new Error('有效期或读取范围超出限制')
 if(kind==='weather'&&value.sourceHost!=='open-meteo.com')throw new Error('内置天气验证器仅适用于 open-meteo.com')
 return {kind,title:value.title.trim(),keywords:[...new Set(value.keywords.map(word=>word.trim()))],regions:[...new Set(value.regions)],sourceHost:value.sourceHost.toLowerCase(),ttlHours:value.ttlHours,maxResults:value.maxResults,maxCharacters:value.maxCharacters}
}
export function recipeTools(recipe:ExperienceRecipe){return recipe.kind==='weather'?['weather.forecast']:recipe.kind==='file-read'?['agent.read_file']:['web-research','weather-web'].includes(recipe.kind)?['agent.web_search','agent.web_fetch']:[]}
export function hostMatches(actual:string,required:string){return !required||actual===required||actual.endsWith('.'+required)}

/** Never persist run inputs or source bodies. Applicability rules are explicitly user-authored. */
export class ExperienceStore {
 private file:string
 private data:ExperienceState
 constructor(directory:string,private now:()=>number=()=>Date.now()){
  this.file=path.join(directory,'experience-library.json')
  this.data=readIntegrationJson(this.file,{enabled:true,entries:[]})
  if(typeof this.data?.enabled!=='boolean'||!Array.isArray(this.data.entries)||this.data.entries.length>300)throw new Error('知识库格式无效，原文件已保留')
  this.data.entries=this.data.entries.map(entry=>{
   if(!entry||!['weather','research','files'].includes(entry.intent)||!['candidate','verified'].includes(entry.status)||typeof entry.id!=='string'||typeof entry.scope!=='string'||!Array.isArray(entry.tools)||entry.tools.some(t=>!knownTools.has(t))||!Number.isSafeInteger(entry.successes)||entry.successes<0||!Number.isSafeInteger(entry.failures)||entry.failures<0||typeof entry.updatedAt!=='string')throw new Error('知识库格式无效，原文件已保留')
   const recipe=defaultRecipe(entry.intent,entry.tools)
   if(entry.lastIssue&&(!Object.hasOwn(failureLabels,entry.lastIssue.kind)||!Number.isFinite(Date.parse(entry.lastIssue.at))))throw new Error('经验运行分类无效')
   if(entry.interruptions!==undefined&&(!Number.isSafeInteger(entry.interruptions)||entry.interruptions<0))throw new Error('经验中断统计无效')
   if(entry.lastMatch&&(!Number.isSafeInteger(entry.lastMatch.revision)||!Number.isFinite(Date.parse(entry.lastMatch.at))||!Array.isArray(entry.lastMatch.reasons)||entry.lastMatch.reasons.length>20||entry.lastMatch.reasons.some(code=>!Object.hasOwn(mismatchHints,code))))throw new Error('经验匹配记录无效')
   if(entry.recipe){
    const acceptedKind=entry.recipe.kind===convertibleKind(entry)?entry.recipe.kind:recipe.kind
    validateRecipe(entry.recipe,acceptedKind)
    if(!Number.isSafeInteger(entry.revision)||entry.revision!<1||!Array.isArray(entry.history)||entry.history.length>10)throw new Error('经验版本格式无效')
    for(const version of entry.history){if(!version||!Number.isSafeInteger(version.revision)||version.revision<1||version.revision>=entry.revision!||!Number.isFinite(Date.parse(version.createdAt)))throw new Error('经验历史格式无效');validateRecipe(version.recipe,version.recipe?.kind===convertibleKind(entry)?version.recipe.kind:recipe.kind)}
   }
   if(entry.verification){const v=entry.verification;if(typeof v.passed!=='boolean'||v.revision!==entry.revision||!Number.isFinite(Date.parse(v.checkedAt))||!Number.isFinite(Date.parse(v.expiresAt))||Date.parse(v.expiresAt)<=Date.parse(v.checkedAt)||!Array.isArray(v.checks)||v.checks.some(c=>typeof c!=='string')||typeof v.reason!=='string')throw new Error('经验验证记录格式无效')}
   return {...entry,recipe:entry.recipe??recipe,revision:entry.revision??1,history:entry.history??[],enabled:entry.enabled===true,uses:entry.uses??0,...(!entry.verification?{status:'candidate' as const,enabled:false}:{})}
  })
 }
 state():ExperienceState{return structuredClone(this.data)}
 get(id:string){const entry=this.data.entries.find(e=>e.id===id);if(!entry)throw new Error('经验记录不存在');return structuredClone(entry)}
 configure(enabled:boolean){if(typeof enabled!=='boolean')throw new Error('知识库开关无效');this.save({...this.data,enabled});return this.state()}
 remove(id:string){this.save({...this.data,entries:this.data.entries.filter(e=>e.id!==id)});return this.state()}
 private save(data:ExperienceState){writeIntegrationJson(this.file,data);this.data=data}
 private put(entry:ExperienceEntry){this.save({...this.data,entries:[...this.data.entries.filter(e=>e.id!==entry.id),entry].slice(-300)})}
 private time(){return new Date(this.now()).toISOString()}
 scope(workspace:string){return createHash('sha256').update(path.resolve(workspace)).digest('hex')}
 private current(id:string,revision:number){const entry=this.get(id);if(entry.revision!==revision)throw new Error('流程版本已变化，请刷新后重试');return entry}
 edit(id:string,revision:number,recipe:ExperienceRecipe){
  const entry=this.current(id,revision)
  return this.revise(entry,validateRecipe(recipe,entry.recipe!.kind))
 }
 private revise(entry:ExperienceEntry,checked:ExperienceRecipe){
  const revision=entry.revision!
  entry.history=[...(entry.history??[]),{revision,recipe:entry.recipe!,createdAt:this.time()}].slice(-10)
  entry.recipe=checked;entry.revision=revision+1;entry.status='candidate';entry.enabled=false;entry.verification=undefined;entry.learning=undefined;entry.updatedAt=this.time()
  this.put(entry);return this.state()
 }
 rollback(id:string,revision:number,target:number){const entry=this.current(id,revision),version=entry.history?.find(v=>v.revision===target);if(!version)throw new Error('历史版本不存在');return this.revise(entry,validateRecipe(version.recipe,version.recipe.kind))}
 convert(id:string,revision:number){
  const entry=this.current(id,revision),kind=convertibleKind(entry)
  if(entry.recipe!.kind!=='unsupported'||!kind)throw new Error('此记录不能转换为现有只读流程模板')
  const recipe={...entry.recipe!,kind,sourceHost:kind==='weather'?'open-meteo.com':entry.recipe!.sourceHost}
  return this.revise(entry,validateRecipe(recipe,kind))
 }
 valid(entry:ExperienceEntry){return entry.status==='verified'&&entry.verification?.passed===true&&entry.verification.revision===entry.revision&&Date.parse(entry.verification.expiresAt)>this.now()}
 enable(id:string,revision:number,enabled:boolean){const entry=this.current(id,revision);if(typeof enabled!=='boolean'||enabled&&(!this.valid(entry)||entry.recipe!.kind==='unsupported'))throw new Error('请先用当前版本试运行并通过验证');entry.enabled=enabled;this.put(entry);return this.state()}
 verify(id:string,revision:number,passed:boolean,checks:string[],reason:string,kind:ExperienceFailureKind='validation'){
  if(!passed&&kind!=='validation')return this.issue(id,revision,kind)
  const entry=this.current(id,revision)
  entry.verification={revision,passed,checkedAt:this.time(),expiresAt:new Date(this.now()+entry.recipe!.ttlHours*3600000).toISOString(),checks,reason}
  entry.status=passed?'verified':'candidate';entry.enabled=false;entry.updatedAt=this.time()
  if(!passed)this.applyIssue(entry,kind)
  else{entry.lastIssue=undefined;entry.lastFailure=undefined}
  this.put(entry);return this.state()
 }
 diagnose(query:string,context:ExperienceMatchContext){
  const intent=experienceIntent(query)
  return this.data.entries.filter(entry=>entry.intent===intent).map(entry=>{
   const recipe=entry.recipe!,reasons:ExperienceMismatch[]=[]
   if(!this.data.enabled)reasons.push('library-off')
   if(entry.scope!==this.scope(context.workspace))reasons.push('workspace')
   if(recipe.kind==='unsupported')reasons.push('unsupported')
   if(!this.valid(entry))reasons.push(entry.status==='verified'&&entry.verification?.passed?'expired':'unverified')
   else if(!entry.enabled)reasons.push('disabled')
   if(recipe.kind==='file-read'?!context.filesEnabled:!context.webEnabled)reasons.push(recipe.kind==='file-read'?'files':'network')
   if(!recipeTools(recipe).every(tool=>context.tools.includes(tool)))reasons.push('tools')
   if(recipe.regions.length&&!recipe.regions.includes(context.region))reasons.push('region')
   if(!recipe.keywords.every(word=>query.toLowerCase().includes(word.toLowerCase())))reasons.push('keywords')
   if(context.sourceHost&&!hostMatches(recipe.sourceHost,context.sourceHost)||recipe.kind==='web-research'&&recipe.sourceHost&&!context.sourceHost&&!recipe.keywords.length)reasons.push('source')
   return {entry:structuredClone(entry),reasons}
  }).sort((a,b)=>Number(a.reasons.includes('workspace'))-Number(b.reasons.includes('workspace'))||a.reasons.length-b.reasons.length||Number(b.entry.recipe!.kind==='weather-web')-Number(a.entry.recipe!.kind==='weather-web')||(b.entry.recipe!.keywords.length+Number(!!b.entry.recipe!.sourceHost))-(a.entry.recipe!.keywords.length+Number(!!a.entry.recipe!.sourceHost))||b.entry.updatedAt.localeCompare(a.entry.updatedAt))
 }
 match(query:string,context:ExperienceMatchContext){return this.diagnose(query,context).find(item=>!item.reasons.length)?.entry}
 noteMatch(id:string,revision:number,reasons:ExperienceMismatch[]){const entry=this.current(id,revision);entry.lastMatch={revision,at:this.time(),reasons};this.put(entry)}
 issue(id:string,revision:number,kind:ExperienceFailureKind){
  const entry=this.current(id,revision)
  this.applyIssue(entry,kind)
  if(kind==='validation')entry.failures++
  else entry.interruptions=(entry.interruptions??0)+1
  this.put(entry);return this.state()
 }
 private applyIssue(entry:ExperienceEntry,kind:ExperienceFailureKind){
  entry.lastIssue={kind,at:this.time()};entry.lastFailure=failureLabels[kind]
  if(kind==='validation'){entry.enabled=false;entry.status='candidate'}
 }
 use(id:string,revision:number,passed?:boolean,kind:ExperienceFailureKind='validation'){
  const entry=this.current(id,revision);entry.lastUsedAt=this.time()
  if(passed===undefined)entry.uses=(entry.uses??0)+1
  else if(!passed)this.applyIssue(entry,kind)
  else{entry.lastIssue=undefined;entry.lastFailure=undefined}
  this.put(entry)
 }
 recordOutcome(id:string,revision:number,passed:boolean,kind:ExperienceFailureKind){
  const entry=this.current(id,revision)
  if(passed)entry.successes++
  else if(kind==='validation')entry.failures++
  else entry.interruptions=(entry.interruptions??0)+1
  entry.updatedAt=this.time();this.put(entry)
 }
 noteLearning(id:string,revision:number,status:'verified'|'candidate'|'blocked',reason:string){
  const entry=this.current(id,revision);entry.learning={at:this.time(),status,reason};this.put(entry)
 }
 context(query:string,workspace:string){
  if(!this.data.enabled)return ''
  const intent=experienceIntent(query);if(!intent)return ''
  const entries=this.data.entries.filter(e=>e.intent===intent&&e.scope===this.scope(workspace)&&e.enabled&&this.valid(e))
  return entries.length?'已验证的方法（仍需本次执行证据）：'+entries.map(e=>this.describe(e)).join('；'):''
 }
 describe(entry:ExperienceEntry){return JSON.stringify({id:entry.id,revision:entry.revision,recipe:entry.recipe,...recipeDetails(entry.recipe!)})}
 record(query:string,workspace:string,tools:string[],success:boolean,validator?:'weather-v1',kind:ExperienceFailureKind='validation',weatherSource?:string){
  if(!this.data.enabled)return
  const intent=experienceIntent(query),steps=tools.slice(0,16)
  if(!intent||!steps.length||tools.length>16||steps.some(t=>!knownTools.has(t)))return
  if(weatherSource&&(intent!=='weather'||convertibleKind({intent,tools:steps})!=='weather-web'))throw new Error('天气来源与任务方法不匹配')
  const learnedRecipe=weatherSource?validateRecipe({...defaultRecipe(intent!,steps),kind:'weather-web',title:'天气查询 · '+weatherSource,sourceHost:weatherSource},'weather-web'):undefined
  const scope=this.scope(workspace),id=createHash('sha256').update(JSON.stringify(weatherSource?[scope,intent,'weather-source',weatherSource]:[scope,intent,steps])).digest('hex'),previous=this.data.entries.find(e=>e.id===id)
  const entry:ExperienceEntry={...previous,id,scope,intent,tools:steps,status:previous?.status??'candidate',successes:(previous?.successes??0)+(success?1:0),failures:(previous?.failures??0)+(!success&&kind==='validation'?1:0),updatedAt:this.time(),recipe:previous?.recipe??defaultRecipe(intent,steps),revision:previous?.revision??1,history:previous?.history??[],enabled:previous?.enabled??false,uses:previous?.uses??0}
  if(!previous&&learnedRecipe)entry.recipe=learnedRecipe
  if(success&&intent==='weather'&&validator==='weather-v1'&&entry.recipe?.kind==='weather'&&entry.revision===1){
   entry.lastIssue=undefined;entry.lastFailure=undefined
   entry.status='verified';entry.enabled=previous?previous.enabled:true
   entry.verification={revision:entry.revision!,passed:true,checkedAt:this.time(),expiresAt:new Date(this.now()+entry.recipe.ttlHours*3600000).toISOString(),checks:recipeDetails(entry.recipe).checks,reason:'天气程序已校验本次地点、日期、单位和数值；不保存预报答案。'}
  }
  if(!success){this.applyIssue(entry,kind);if(kind!=='validation')entry.interruptions=(entry.interruptions??0)+1}
  this.put(entry)
  return this.get(id)
 }
}

