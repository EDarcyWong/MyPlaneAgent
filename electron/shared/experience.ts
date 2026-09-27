export type ExperienceEntry = {
  id: string
  intent: 'weather' | 'research' | 'files'
  status: 'candidate' | 'verified'
  tools: string[]
  successes: number
  failures: number
  updatedAt: string
  scope: string
  revision?: number
  recipe?: ExperienceRecipe
  enabled?: boolean
  verification?: ExperienceVerification
  history?: ExperienceVersion[]
  lastUsedAt?: string
  uses?: number
  learning?:{at:string;status:'verified'|'candidate'|'blocked';reason:string}
  lastFailure?: string
  lastIssue?: {kind:ExperienceFailureKind;at:string}
  interruptions?: number
  lastMatch?: {revision:number;at:string;reasons:ExperienceMismatch[]}
}
export type ExperienceFailureKind='validation'|'temporary'|'denied'|'cancelled'|'unavailable'|'input'|'changed'|'incomplete'
export const failureLabels:Record<ExperienceFailureKind,string>={
 validation:'结果校验失败，已暂停复用，请重新试运行。',
 temporary:'网络或服务暂时不可用，可稍后重试；原验证和启用状态保留。',
 denied:'本次操作未获授权，已停止；原验证和启用状态保留。',
 cancelled:'本次操作已取消；原验证和启用状态保留。',
 unavailable:'工具或读取目标暂不可用，请检查后重试；原验证和启用状态保留。',
 input:'本次参数不满足流程要求，请修正输入；原验证和启用状态保留。',
 changed:'流程已修改、停用或过期，本次执行已停止。',
 incomplete:'本次任务尚未完成，不能据此判断流程失效；原验证和启用状态保留。'
}
export type ExperienceMismatch='library-off'|'workspace'|'unsupported'|'unverified'|'expired'|'disabled'|'network'|'files'|'tools'|'region'|'keywords'|'source'|'parameters'|'plan'
export const mismatchHints:Record<ExperienceMismatch,{label:string;action:string;panel?:'trial'|'edit'}>={
 'library-off':{label:'知识库已停用',action:'开启页面顶部的知识库开关'},
 workspace:{label:'工作目录不同',action:'切换到产生此流程的原项目'},
 unsupported:{label:'尚未建立可复用的查询方法',action:'在知识库补充来源并验证方法'},
 unverified:{label:'当前版本未通过验证',action:'试运行验证',panel:'trial'},
 expired:{label:'验证已过期',action:'重新试运行',panel:'trial'},
 disabled:{label:'此流程未启用',action:'验证通过后启用此流程'},
 network:{label:'本次未允许联网',action:'在当前会话或项目中允许联网'},
 files:{label:'本次未允许文件访问',action:'选择工作项目并允许文件访问'},
 tools:{label:'所需工具不可用',action:'在插件菜单检查所需工具'},
 region:{label:'当前地区不符合条件',action:'查看适用条件',panel:'edit'},
 keywords:{label:'匹配词不符合',action:'查看匹配词',panel:'edit'},
 source:{label:'指定来源与流程条件不符',action:'查看来源条件',panel:'edit'},
 parameters:{label:'本次请求无法绑定为简单流程',action:'明确查询词或相对文件路径，多步骤请求交给通用处理'},
 plan:{label:'当前任务已有执行计划',action:'继续当前计划，避免重复执行'}
}
export type ExperienceRecipe = {
  kind: 'weather' | 'weather-web' | 'web-research' | 'file-read' | 'unsupported'
  title: string
  keywords: string[]
  regions: string[]
  sourceHost: string
  ttlHours: number
  maxResults: number
  maxCharacters: number
}
/** Recognised read-only traces can be converted into a fixed template, never replayed verbatim. */
export function convertibleKind(entry:Pick<ExperienceEntry,'intent'|'tools'>):Exclude<ExperienceRecipe['kind'],'unsupported'>|undefined{
 const tools=entry.tools
 if(!tools.length)return
 if(entry.intent==='weather'&&tools.every(tool=>tool==='weather.forecast'))return 'weather'
 if(entry.intent==='weather'&&tools.every(tool=>['agent.web_search','agent.web_fetch','browser.open','browser.read_page'].includes(tool)))return 'weather-web'
 if(entry.intent==='research'&&tools.every(tool=>['agent.web_search','agent.web_fetch','browser.open','browser.read_page'].includes(tool)))return 'web-research'
 if(entry.intent==='files'&&tools.includes('agent.read_file')&&tools.every(tool=>['agent.list_files','agent.search_files','agent.read_file'].includes(tool)))return 'file-read'
}
export type ExperienceVerification = {revision:number;passed:boolean;checkedAt:string;expiresAt:string;checks:string[];reason:string}
export type ExperienceVersion = {revision:number;recipe:ExperienceRecipe;createdAt:string}
export type ExperienceState = { enabled: boolean; entries: ExperienceEntry[] }
export type ExperienceTrialInput = {id:string;revision:number;projectId?:string;webEnabled:boolean;values:Record<string,string>}
export type ExperienceMatchContext = {workspace:string;region:string;webEnabled:boolean;filesEnabled:boolean;tools:string[];sourceHost?:string}

export function recipeDetails(recipe:ExperienceRecipe){
  if(recipe.kind==='weather-web')return {parameters:['city：本次城市','day：今天 / 明天 / 后天 / YYYY-MM-DD'],steps:[`在 ${recipe.sourceHost||'待补充的天气来源'} 限定网站搜索本次城市与目标日期`,'读取该网站的最新预报正文','核对来源、城市、绝对日期及天气数据；不复用旧预报'],checks:['正文来自指定天气网站','正文包含本次城市与目标日期','包含天气及温度信息','试运行还需核对预期正文片段'],failure:'缺少来源或结果不符合当前城市、日期时不采用，交回通用查询；网页核对不代表完整气象准确性认证。'}
  if(recipe.kind==='weather')return {parameters:['city：目标城市','day：今天 / 明天 / 后天 / YYYY-MM-DD'],steps:['用 city 定位城市与时区','将 day 换算为目标城市日期','查询每日预报','校验地点、日期、单位、数值范围'],checks:['城市唯一匹配','目标日期已覆盖','温度与降水概率有效'],failure:'缺少参数则询问；接口或校验失败时回到通用查询，不使用旧答案。'}
  if(recipe.kind==='web-research')return {parameters:['query：本次查询词','expectedText：仅试运行时提供的预期正文片段'],steps:['web_search(query)：按地区选择主流引擎','选择符合来源条件的实际结果链接','web_fetch(结果链接)：读取最新正文','核对正文与查询词；试运行还核对 expectedText'],checks:['非空且相关的搜索结果','正文来自实际搜索链接','来源约束匹配','试运行预期文本存在'],failure:'页面不可用或校验失败时，按结果上限尝试其他实际搜索链接；无可用结果后交回通用 Agent。权限被拒绝则立即停止。'}
  if(recipe.kind==='file-read')return {parameters:['path：当前工作目录内的相对路径','expectedText：仅试运行时提供的预期文件片段'],steps:['校验 path 位于当前授权目录内','read_file(path)：重新读取文件','核对读取结果；试运行还核对 expectedText'],checks:['目录范围有效','文件读取成功','试运行预期文本存在'],failure:'文件不存在、路径越界或内容检查失败时停止，不用历史文件正文作答。'}
  return {parameters:[],steps:['尚未提炼出明确的数据来源与处理方法'],checks:['需要建立查询方法并用当前结果验证'],failure:'可转换的记录先补充方法并试运行；其余任务继续由通用 Agent 处理。'}
}

