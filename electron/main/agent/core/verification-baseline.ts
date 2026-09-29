import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import type {TaskVerificationRule,TaskVerificationResult,TaskVerificationRun,VerificationIssue,VerificationComparison} from '../../../shared/task-plan.js'

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function verificationRuleKey(rule:TaskVerificationRule){
  return rule.kind==='file'?JSON.stringify(['file',rule.path,rule.contains??null]):rule.kind==='test'?JSON.stringify(['test',rule.script]):JSON.stringify(['diagnostics',rule.checker,rule.path||'.'])
}
function fileIdentity(file:string,workspace:string){
  const value=path.resolve(workspace,file.replace(/\\/g,'/'))
  return process.platform==='win32'?value.toLowerCase():value
}
const clean=(value:string)=>value.replace(/\u001b\[[0-9;]*m/g,'').replace(/\r\n/g,'\n').replace(/duration[_ ]?m?s\s*:\s*\d+(?:\.\d+)?/gi,'duration:<time>').replace(/\b\d+(?:\.\d+)?\s*(?:ms|seconds|milliseconds)\b/g,'<time>').trim()
function directTestFile(rule:TaskVerificationRule,workspace:string):string|undefined{
  if(rule.kind!=='test')return
  try{
    const manifestFile=path.join(workspace,'package.json')
    if(fs.statSync(manifestFile).size>200000)return
    const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'))
    const command=manifest.scripts?.[rule.script]
    if(typeof command!=='string')return
    const file=command.match(/^\s*node\s+(?:--[a-zA-Z-]+(?:=\S+)?\s+)*(?:\.\/)?(tests?\/[a-zA-Z0-9_./-]+\.test\.[cm]?js)(?:\s|$)/)?.[1]
    if(!file||file.split('/').includes('..'))return
    return fileIdentity(file,workspace)
  }catch{return}
}
const environmentRules:[RegExp,string][]=[
  [/ECONNREFUSED|connection refused|EADDRINUSE|address already in use/i,'先检查依赖服务是否启动及端口是否被占用；恢复服务后复测，不修改业务断言。'],
  [/ModuleNotFoundError|No module named|Cannot find (?:module|package) ['"](?![./\\]|[A-Za-z]:)|command not found|not recognized as an internal|不是内部或外部命令/i,'先核对项目依赖、运行时及 PATH；依赖安装或环境变更应遵循现有授权，再运行原检查。'],
  [/ENOMEM|ENOSPC|heap out of memory|no space left|EACCES|permission denied|权限|未开启|拒绝|未提供验收工具/i,'先检查资源或权限状态；解除环境阻碍后复测，不通过改写代码掩盖失败。'],
  [/missing (?:environment variable|env)|项目没有定义验收脚本|未找到可用的 TypeScript|configuration error|invalid config/i,'先核对检查脚本、工作目录、配置及必要环境变量，保留当前代码。'],
]
export function verificationIssues(rule:TaskVerificationRule,data:Record<string,unknown>,summary:string,workspace:string,blocked=false):{issues:VerificationIssue[];issuesComplete:boolean}{
  const base=verificationRuleKey(rule),output=clean(String(data.output??summary))
  const customTestFile=directTestFile(rule,workspace)
  const issues:VerificationIssue[]=[]
  const add=(category:VerificationIssue['category'],message:string,file?:string,advice?:string)=>{
    const normalized=clean(message).slice(0,1600),identity=file?fileIdentity(file,workspace):undefined
    const key=hash([base,category,identity,normalized])
    if(!issues.some(issue=>issue.key===key))issues.push({key,category,message:normalized,path:identity,advice})
  }
  for(const line of output.split('\n'))for(const [pattern,advice] of environmentRules)if(pattern.test(line)){add('environment',line,undefined,advice);break}
  if(issues.length)return {issues:issues.slice(0,32),issuesComplete:false}
  if(blocked){add('unknown',output);return {issues,issuesComplete:false}}
  if(rule.kind==='file'){add('code',summary,rule.path);return {issues,issuesComplete:true}}
  if(Array.isArray(data.diagnostics))for(const entry of data.diagnostics.slice(0,200)){
    if(entry&&typeof entry==='object'&&typeof entry.path==='string'&&typeof entry.message==='string')add('code',entry.message,entry.path)
  }
  // Untruncated output does not prove the plugin parser recognized every error.
  // Only an explicit exhaustive diagnostic contract can establish absence.
  if(issues.length)return {issues:issues.slice(0,200),issuesComplete:data.diagnosticsComplete===true&&data.truncated===false&&issues.length<200}
  const customFailures:string[]=[]
  for(const line of output.split('\n')){
    const diagnostic=line.match(/^(.+?)(?:\(\d+,\d+\)|:\d+:\d+)\s*[:\-]\s*(error\s+TS\d+:.*)$/i)
    if(diagnostic){add('code',diagnostic[2],diagnostic[1]);continue}
    const custom=line.match(/^\s*FAIL\s{2,}(.+)$/)
    if(custom){customFailures.push(custom[1]);add('code',custom[1],customTestFile);continue}
    const failed=line.match(/^(?:not ok\s+\d+\s+-\s+|FAILED\s+|[×✗]\s+)(.+)$/)
    if(failed){const file=failed[1].match(/^([^\s:]+\.(?:[cm]?[jt]sx?|py))(?:::|\s|$)/)?.[1];add('code',failed[1],file)}
  }
  const customSummary=output.match(/===== 汇总：\d+ 通过 \/ (\d+) 失败 =====/)
  if(customSummary&&customFailures.length===Number(customSummary[1])&&data.truncated===false)return {issues:issues.slice(0,200),issuesComplete:true}
  if(!issues.length)add(/AssertionError|assertion failed|\bexpected\b|断言|error TS\d+/i.test(output)?'code':'unknown',output)
  return {issues:issues.slice(0,200),issuesComplete:false}
}
function evidenceOf(row:TaskVerificationResult,workspace:string):{issues:VerificationIssue[];complete:boolean}{
  if(row.passed)return {issues:[],complete:true}
  // Older saved runs may have stored this harness as one unknown issue.
  // Reparse only when its complete summary is present in the persisted output.
  if(row.rule.kind==='test'&&row.issuesComplete!==true&&/===== 汇总：\d+ 通过 \/ \d+ 失败 =====/.test(row.summary)){
    const parsed=verificationIssues(row.rule,{output:row.summary,truncated:false},row.summary,workspace,row.blocked)
    if(parsed.issuesComplete)return {issues:parsed.issues,complete:true}
  }
  return {issues:row.issues?.length?row.issues:[{key:row.fingerprint,category:'unknown',message:row.summary}],complete:row.issuesComplete===true}
}
export function compareVerification(baseline:TaskVerificationRun|undefined,results:TaskVerificationResult[],modifiedFiles:string[],workspace:string):VerificationComparison{
  const failures:VerificationComparison['failures']=[],resolved:VerificationIssue[]=[]
  const touched=new Set(modifiedFiles.map(file=>fileIdentity(file,workspace)))
  for(const row of results){
    const before=baseline?.results.find(previous=>verificationRuleKey(previous.rule)===verificationRuleKey(row.rule))
    const previous=before?evidenceOf(before,workspace):undefined,latest=evidenceOf(row,workspace)
    const old=previous?.issues||[],current=latest.issues,oldKeys=new Set(old.map(issue=>issue.key)),newKeys=new Set(current.map(issue=>issue.key))
    for(const issue of current){
      const origin=oldKeys.has(issue.key)?'existing':!before||before.blocked||!before.passed&&!previous?.complete?'unknown':'new'
      failures.push({issue,origin,related:row.rule.kind==='file'||!!issue.path&&touched.has(issue.path)})
    }
    if(row.passed||latest.complete&&!row.blocked)resolved.push(...old.filter(issue=>!newKeys.has(issue.key)))
  }
  return {failures,resolved}
}
export function comparisonSummary(comparison:VerificationComparison):string{
  const {failures,resolved}=comparison
  return `基线对比：新增 ${failures.filter(f=>f.origin==='new').length}，原有 ${failures.filter(f=>f.origin==='existing').length}，已解决 ${resolved.length}，环境问题 ${failures.filter(f=>f.issue.category==='environment').length}，无法确定来源 ${failures.filter(f=>f.origin==='unknown').length}。`
}
