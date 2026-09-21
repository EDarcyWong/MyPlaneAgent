import type {ProcessResult} from './execution-supervisor.js'
import type {Diagnostic} from './build-profile.js'

export type TestFailureCategory='passed'|'assertion'|'test-defect-candidate'|'dependency'|'environment'|'configuration'|'timeout'|'cancelled'|'output-limit'|'resource'|'transient'|'unknown'
export type TestFailureAnalysis={
 category:TestFailureCategory
 confidence:number
 summary:string
 failedTests:string[]
 evidence:string[]
 retryPolicy:{automatic:boolean;controlledRerun:boolean;maxAttempts:number;reason:string}
 nextActions:string[]
 guardrails:string[]
}

const ansi=/\x1b\[[0-?]*[ -/]*[@-~]/g
const clean=(value:string)=>value.replace(ansi,'').replace(/\r/g,'')
const unique=(values:string[],limit:number)=>[...new Set(values.map(value=>value.trim()).filter(Boolean))].slice(0,limit)

export function parseFailedTests(output:string):string[]{
 const found:string[]=[]
 for(const raw of clean(output).split('\n')){
  const line=raw.trim()
  let match=line.match(/^not ok\s+\d+\s+-\s+(.+)$/i)
  if(match){found.push(match[1]);continue}
  match=line.match(/^FAILED\s+([^\s]+(?:::[^\s]+)*)/)
  if(match){found.push(match[1]);continue}
  match=line.match(/^FAIL\s+(.+?(?:\.[cm]?[jt]sx?|\.py))(?:\s|$)/)
  if(match){found.push(match[1]);continue}
  match=line.match(/^[×✗]\s+(.+)$/)
  if(match)found.push(match[1])
 }
 return unique(found,25)
}

const evidenceFor=(output:string,patterns:RegExp[])=>unique(clean(output).split('\n').map(line=>line.trim()).filter(line=>line.length>0&&patterns.some(pattern=>pattern.test(line))).map(line=>line.slice(0,500)),8)

export function analyzeTestResult(result:Pick<ProcessResult,'exitCode'|'output'|'termination'|'error'>,diagnostics:Diagnostic[],action:string):TestFailureAnalysis{
 const output=clean(result.output),searchable=output+'\n'+(result.error||''),failedTests=parseFailedTests(output)
 const guardrails=['不得通过删除、跳过或弱化测试来制造通过','修改后先复跑失败测试，再运行受影响测试，最后运行回归测试']
 if(result.exitCode===0&&!result.termination)return {category:'passed',confidence:1,summary:`${action} 执行通过；退出码为 0，但只证明本次命令通过。`,failedTests:[],evidence:[],retryPolicy:{automatic:false,controlledRerun:false,maxAttempts:0,reason:'测试已经通过，无需重跑。'},nextActions:['结合改动风险决定是否扩大回归范围。'],guardrails}
 if(result.termination){
  const category=result.termination==='timeout'?'timeout':result.termination==='cancelled'?'cancelled':'output-limit'
  const summary=category==='timeout'?'测试执行超时，尚不能据此判断是代码缺陷还是运行环境问题。':category==='cancelled'?'测试被取消，结果不完整。':'测试输出超过容量限制，结果不完整。'
  const nextActions=category==='timeout'?['检查卡死位置、异步资源和进程状态。','缩小到单个失败测试并增加诊断信息；确认原因后再调整超时。']:category==='cancelled'?['核对是否仍有子进程和副作用。','用户继续任务后重新选择验证范围。']:['先读取已保存的完整工具结果并缩小测试范围。','不要把截断输出当作完整失败集合。']
  return {category,confidence:1,summary,failedTests,evidence:unique([result.error||'',...diagnostics.slice(0,5).map(item=>item.message)],8),retryPolicy:{automatic:false,controlledRerun:false,maxAttempts:0,reason:'中断或不完整结果必须先核对状态，不能自动重放。'},nextActions,guardrails}
 }

 const rules:{category:Exclude<TestFailureCategory,'passed'|'unknown'>;patterns:RegExp[];confidence:number;summary:string;rerun:boolean;actions:string[]}[]=[
  {category:'timeout',patterns:[/\btimeout\b|timed out|超时/i],confidence:.98,summary:'测试执行超时，尚不能据此判断是代码缺陷还是运行环境问题。',rerun:false,actions:['检查卡死位置、异步资源和进程状态。','缩小到单个失败测试并增加诊断信息；确认原因后再调整超时。']},
  {category:'resource',patterns:[/heap out of memory|ENOMEM|ENOSPC|no space left|too many open files|EMFILE|out of memory/i],confidence:.97,summary:'测试受到内存、磁盘或句柄等资源限制。',rerun:false,actions:['检查资源使用和未释放的进程、文件或连接。','修复资源问题后再运行原测试。']},
  {category:'dependency',patterns:[/cannot find (?:module|package)|module not found|ModuleNotFoundError|ImportError|ERR_MODULE_NOT_FOUND|could not resolve|missing dependency/i],confidence:.94,summary:'测试缺少依赖或依赖解析失败。',rerun:false,actions:['核对锁文件、依赖声明和当前运行时，不自动修改全局环境。','修复依赖后运行原测试。']},
  {category:'configuration',patterns:[/no tests? found|configuration error|config(?:uration)? file|unknown option|invalid config|missing (?:environment variable|env)|未找到.*测试|配置.*错误/i],confidence:.88,summary:'测试配置、参数或测试发现过程可能有误。',rerun:false,actions:['检查测试脚本、配置文件、工作目录和测试发现规则。','配置修复后运行原测试。']},
  {category:'environment',patterns:[/command not found|not recognized as an internal|ENOENT|EACCES|permission denied|address already in use|EADDRINUSE|connection refused|ECONNREFUSED|无法启动执行环境/i],confidence:.92,summary:'运行环境、权限、端口或外部服务导致测试无法正常执行。',rerun:false,actions:['检查运行时、权限、端口和依赖服务状态。','环境恢复后运行原测试，不修改业务断言。']},
  {category:'transient',patterns:[/ECONNRESET|socket hang up|temporary failure|temporarily unavailable|service unavailable|HTTP\s+50[234]|rate limit/i],confidence:.75,summary:'输出包含可能的瞬时外部故障；单次失败不能证明测试不稳定。',rerun:true,actions:['保留当前日志和随机种子，允许受控重跑一次。','若结果不一致，标记为 flaky 候选并隔离调查；不要持续重试。']},
  {category:'test-defect-candidate',patterns:[/beforeAll|beforeEach|afterAll|afterEach|fixture.*(?:failed|error)|test setup failed|mock.*(?:not configured|unexpected)/i],confidence:.62,summary:'失败发生在测试夹具、生命周期或 mock 中，可能是测试代码缺陷，也可能由产品代码触发。',rerun:false,actions:['核对需求契约和测试前置条件。','只有证据证明预期过期或夹具错误时才修改测试。']},
  {category:'assertion',patterns:[/AssertionError|assert\.\w+|expected.+(?:received|actual)|\bexpected\b|断言/i],confidence:.82,summary:'测试出现确定性断言失败，需要定位产品实现或测试预期之间的偏差。',rerun:false,actions:['读取首个业务相关堆栈、断言期望和实际值。','提出一个根因假设并做最小修改，然后定向复测。']}
 ]
 const rule=rules.find(candidate=>candidate.patterns.some(pattern=>pattern.test(searchable)))
 const diagnosticEvidence=diagnostics.slice(0,5).map(item=>`${item.file||''}${item.line?':'+item.line:''} ${item.code||''} ${item.message}`.trim())
 if(rule){
  const evidence=unique([...evidenceFor(searchable,rule.patterns),...diagnosticEvidence],8)
  return {category:rule.category,confidence:rule.confidence,summary:rule.summary,failedTests,evidence,retryPolicy:{automatic:false,controlledRerun:rule.rerun,maxAttempts:rule.rerun?1:0,reason:rule.rerun?'仅允许保留证据后的受控重跑；第二次失败必须改变方案。':'当前失败需要先增加证据或修复原因，盲目重跑没有价值。'},nextActions:rule.actions,guardrails}
 }
 return {category:'unknown',confidence:.35,summary:'测试失败，但现有输出不足以可靠分类。',failedTests,evidence:unique(diagnosticEvidence,8),retryPolicy:{automatic:false,controlledRerun:false,maxAttempts:0,reason:'证据不足时不得盲目重跑或猜测修改。'},nextActions:['获取完整日志、首个失败堆栈、运行时版本和随机种子。','缩小到最小失败测试；仍无法分类时停止自动修改并报告。'],guardrails}
}
