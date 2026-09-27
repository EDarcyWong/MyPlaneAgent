import type {TaskItem,TaskVerificationRule} from '../../../shared/task-plan.js'

export const verificationRuleGuide='verification 必须是数组，最多 4 项。只支持以下三种 JSON 对象：{"kind":"file","path":"index.html","contains":"应包含的文字"}（contains 可省略，仅检查文件存在）；{"kind":"test","script":"test"}（script 必须是项目已定义的 test/check/lint/build 或这些名称的冒号子脚本）；{"kind":"diagnostics","checker":"auto","path":"."}（checker 只能是 auto、typescript、python 三者之一，path 可省略）。不要把候选值拼成一个字符串；不支持任意 command、URL、浏览器或人工检查规则。'
const scriptPattern=/^(test|check|lint|build)(:[A-Za-z0-9_-]+)?$/
export const isVerificationScript=(value:unknown):value is string=>typeof value==='string'&&scriptPattern.test(value)
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)

/** Normalize only equivalent representations; never silently discard a condition. */
export function parseVerificationRules(value:unknown):TaskVerificationRule[]{
  if(value===undefined||value===null)return []
  const rows=Array.isArray(value)?value:object(value)?[value]:undefined
  if(!rows||rows.length>4)throw new Error('验收规则应为最多 4 项的数组')
  return rows.map((input,index)=>{
    const fail=(message:string):never=>{throw new Error(`第 ${index+1} 条验收规则：${message}`)}
    if(!object(input))return fail('需要 JSON 对象，不能使用文字或空值')
    const aliases:Record<string,string>={file_exists:'file',file_contains:'file',test_script:'test',typecheck:'diagnostics'}
    const canonical=(value:string)=>Object.hasOwn(aliases,value)?aliases[value]:value
    const kindValue=input.kind??input.type
    if(typeof kindValue!=='string')return fail('缺少 kind 字段')
    const kind=canonical(kindValue)
    if(input.kind!==undefined&&input.type!==undefined&&canonical(String(input.type))!==kind)return fail('kind 与 type 不一致')
    const allowed=kind==='file'?['path','contains']:kind==='test'?['script']:kind==='diagnostics'?['checker','path']:kind==='command'?['command']:[]
    const extra=Object.keys(input).filter(key=>!['kind','type',...allowed].includes(key))
    if(extra.length)return fail('存在无法解释的字段：'+extra.join(', ').slice(0,200))
    if(kind==='file'){
      if(typeof input.path!=='string'||!input.path.trim()||input.path.length>2000)return fail('file 需要有效的 path')
      if(input.contains!==undefined&&(typeof input.contains!=='string'||!input.contains.length||input.contains.length>2000))return fail('contains 必须是 1–2000 字符的文字')
      if(kindValue==='file_contains'&&input.contains===undefined)return fail('file_contains 缺少 contains，不能降级为文件存在检查')
      return {kind:'file',path:input.path,...(input.contains===undefined?{}:{contains:input.contains as string})}
    }
    if(kind==='test'||kind==='command'){
      const supplied=kind==='command'?input.command:input.script
      // Exact npm script invocations are equivalent to the existing script tool.
      // Arguments, chaining, other executables and shell syntax remain forbidden.
      const script=typeof supplied==='string'?(supplied==='npm test'?'test':supplied.match(/^npm run ((?:test|check|lint|build)(?::[A-Za-z0-9_-]+)?)$/)?.[1]??(kind==='test'?supplied:undefined)):undefined
      if(!isVerificationScript(script))return fail('只支持已有测试脚本名；不能执行任意命令或附加 shell 参数')
      return {kind:'test',script}
    }
    if(kind==='diagnostics'){
      const checker=input.checker??'auto'
      if(typeof checker!=='string'||!['auto','typescript','python'].includes(checker))return fail('checker 应为 auto、typescript、python 中的一个值')
      if(input.path!==undefined&&(typeof input.path!=='string'||!input.path.trim()||input.path.length>2000))return fail('diagnostics 的 path 无效')
      return {kind:'diagnostics',checker:checker as 'auto'|'typescript'|'python',...(input.path===undefined?{}:{path:input.path as string})}
    }
    return fail('不支持的 kind：'+kind.slice(0,80)+'；仅支持 file、test、diagnostics')
  })
}

export function prepareVerificationRules(value:unknown):Pick<TaskItem,'verification'|'verificationProblem'>{
  try{return {verification:parseVerificationRules(value),verificationProblem:undefined}}
  catch(error){return {verification:[],verificationProblem:{input:value,message:error instanceof Error?error.message:String(error),attempts:0}}}
}

/** A repair must retain every understood condition and cannot delete unknown ones. */
export function validateRuleRepair(original:unknown,replacement:unknown):TaskVerificationRule[]{
  const rules=parseVerificationRules(replacement)
  const originals=Array.isArray(original)?original:[original]
  if(!rules.length||rules.length<originals.length)throw new Error('纠正结果不能删除验收条件或返回空数组')
  const remaining=rules.map(rule=>JSON.stringify(rule))
  for(const value of originals){
    let known:TaskVerificationRule[]
    try{known=parseVerificationRules([value])}catch{continue}
    for(const rule of known){
      const at=remaining.indexOf(JSON.stringify(rule))
      if(at<0)throw new Error('纠正结果改变了原有可执行的验收条件')
      remaining.splice(at,1)
    }
  }
  return rules
}
