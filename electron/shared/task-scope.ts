export type TaskScope={goal:string;kind:'open-preview'|'general';required:string[];optional:string[]}
/** Classify the requested operation, not a list of supported information topics. */
export function isWebLookup(goal:string){
 const text=goal.replace(/https?:\/\/[^\s)\]）]+/gi,' 网页 ')
 if(/修改|修复|实现|开发|编写|创建|删除|部署|安装|保存到|写入|生成.*(?:文件|报告)|代码|源码|项目|脚本|编译|构建|类型检查|测试|诊断|文件|目录|数据库|执行|运行|发送|提交|预约|预订|购买|支付|重启|关闭|\b(?:code|implement|develop|fix|edit|write|save|test|build|compile|diagnostics|typescript|python|tsc|npm|file|directory|database|execute|run|send|submit|book|buy|pay|restart)\b/i.test(text))return false
 // Bare factual questions ("成都明天限行尾号多少") need no search keyword.
 const question=/什么|多少|哪些|哪天|哪里|何时|几点|什么时候|是否|怎么样|如何|吗[？?。！!\s]*$|\b(?:what|when|where|which|who|how)\b/i.test(text)
 const lookup=/查询|查找|搜索|查一下|查下|搜一下|搜一搜|查一查|告诉我|\b(?:search|look\s*up|lookup|find)\b/i.test(text)
 const webRead=/网页|网站|页面|联网|\b(?:website|webpage)\b/i.test(text)&&/读取|获取|核对|查看|提取|\b(?:read|fetch)\b/i.test(text)
 return !!text.trim()&&(question||lookup||webRead||/天气|预报|下雨|带伞|\b(?:weather|forecast)\b/i.test(text))
}
export const projectCheckTools=new Set(['agent.get_diagnostics','agent.run_test','agent.run_test_case','agent.build_project'])
/** A follow-up that authorizes acting on advice from the current task. */
export function implementsPriorAdvice(goal:string){
 for(const part of goal.split('\n用户补充：').reverse()){
  const text=part.trim()
  if(/(?:不要|无需|先别|不必|暂不|停止).{0,12}(?:修改|实现|落实|实施|改动)|(?:只|仅).{0,10}(?:列建议|提建议|分析|梳理)/.test(text))return false
  if(/^(?:请|帮我|麻烦)?(?:按|根据|依照|照着)(?:(?:前面|之前|上述|刚才|这些|所列|你的|上次|该)(?:的)?)?(?:优化|改进)?建议.{0,20}(?:优化|改进|修改|实现|落实|实施|完成|执行|处理|修复|重构)/.test(text)
   ||/^(?:请|帮我|麻烦)?(?:落实|实施|实现|执行|完成|优化|改进|修改|修复|重构)(?:前面|之前|上述|刚才|这些|所列|你的|上次|该)?(?:的)?建议/.test(text))return true
 }
 return false
}
export function projectAdviceRequested(goal:string){
 const text=goal.trim()
 return !implementsPriorAdvice(text)&&/可优化|优化(?:项|点|建议|方向|空间|清单)|(?:怎么|如何|怎样|还可以|还能).{0,16}优化|(?:分析|梳理|评估).{0,40}(?:性能|代码质量|可维护性|用户体验|测试覆盖)/.test(text)&&!/\b(?:run|execute)\s+(?:the\s+)?(?:tests?|build|diagnostics)\b|(?:运行|执行|通过).{0,16}(?:测试|编译|构建|诊断)|(?:并|同时|然后).{0,16}(?:修改|修复|实现|重构|落地)/i.test(text)
}
/** Project checks need a user task basis; model-authored verification rules alone are not one. */
export function projectChecksRequested(goal:string){
 const text=goal.replace(/https?:\/\/[^\s)\]）]+/gi,' ')
 // Unknown legacy task scope cannot safely discard existing acceptance rules.
 if(!text.trim())return true
 if(projectAdviceRequested(text))return false
 const explicitCheck=/类型检查|单元测试|集成测试|回归测试|(?:运行|执行|通过).*(?:测试|编译|构建|诊断)|检查.*(?:代码|源码|项目|脚本|类型)|\b(?:typecheck|tsc|npm|compile)\b|\b(?:run|execute)\s+(?:the\s+)?(?:tests?|build|diagnostics)\b/i.test(text)
 const change=/修改|修复|实现|开发|编写|创建|添加|增加|替换|调整|优化|删除|重构|部署|安装|写入|制作|做|生成|\b(?:implement|develop|fix|edit|write|refactor|build|create)\b/i.test(text)
 const software=/代码|源码|项目|脚本|函数|组件|程序|应用|网站|网页|游戏|接口|数据库|\.(?:[cm]?[jt]sx?|py|vue|html|css)\b|\b(?:code|project|script|function|component|app|website|api|database)\b/i.test(text)
 return explicitCheck||change&&software
}
export function createTaskScope(goal:string):TaskScope{
 const text=goal.trim()
 const opening=/^(?:请|帮我|麻烦)?(?:打开|运行|启动|预览)(?:一下)?(?:这个|当前|该)?(?:项目|页面|网页)(?:看看|看一下)?[。！!\s]*$/.test(text)
 return {goal:text,kind:opening?'open-preview':'general',required:opening?['打开项目主入口，确认加载成功、页面可访问且无已捕获的加载错误']:text?[text]:[],optional:opening?['其他变体入口的全面测试','全部按钮的交互覆盖','性能、FPS 稳定性或压力测试','画面外观的专项验收']:[]}
}
export const scopeInstruction=(scope:TaskScope)=>'固定验收范围（由应用保存，评审不能自行扩大）：'+JSON.stringify(scope)+'。必验项仅来自原始用户目标及明确补充；发现其他文件、按钮或 FPS 数值不构成新增要求。可选项只列为建议，不能阻止完成。'+(implementsPriorAdvice(scope.goal)?'用户最新补充要求落实先前建议，须规划并执行具体修改，保留可验证的改动证据；先前只列建议的限制不再适用于实施阶段。不要再次仅生成优化建议清单。':'')+(scope.kind==='open-preview'?'打开项目只需主入口加载与访问检查，不等于完整测试项目。用 preview.status/start 确认当前工作目录的预览地址，再用 browser.read_page 核对该地址的主入口。':isWebLookup(scope.goal)?'当前为只读网页查询，按真实页面证据核对来源、目标字段与日期；要求发布时间时须读取页面发布信息，不能用抓取时间代替。不要启动本地项目、执行编译检查或通过修改代码处理网页查询失败。':'')
export function scopeExcludes(scope:TaskScope|undefined,text:string){
 return scope?.kind==='open-preview'&&/index[2-9]\d*\.html|变体|所有入口|全部入口|性能|FPS|帧率|压力测试|所有按钮|全部按钮|屋顶显隐|手动开门|货架标签|视觉|外观|画面.*正确/i.test(text)
}
