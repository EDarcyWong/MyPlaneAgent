import {createHash} from 'node:crypto'
import type {AgentWorkspace,PreparedAction} from './workspace.js'
import {executeProcess,type ProcessRequest} from './execution-supervisor.js'
import {ToolError} from './registry.js'
import {analyzeTestResult} from './test-analysis.js'

export type Diagnostic={file?:string;line?:number;column?:number;severity:'error'|'warning';code?:string;message:string}
export function parseDiagnostics(text:string):Diagnostic[]{
 const result:Diagnostic[]=[]
 for(const raw of text.replace(/\x1b\[[0-9;]*m/g,'').split(/\r?\n/)){
  let match=raw.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+([\w-]+):\s*(.*)$/)
  if(match){result.push({file:match[1],line:+match[2],column:+match[3],severity:match[4] as 'error'|'warning',code:match[5],message:match[6]});continue}
  match=raw.match(/^(.+?):(\d+)(?::(\d+))?:\s*(error|warning)(?:\s+([\w-]+))?:\s*(.*)$/)
  if(match){result.push({file:match[1],line:+match[2],column:match[3]?+match[3]:undefined,severity:match[4] as 'error'|'warning',code:match[5],message:match[6]});continue}
  match=raw.match(/^\s*(?:E\s+|ERROR\s+|FAILED\s+)(.+)$/)
  if(match)result.push({severity:'error',message:match[1]})
  if(result.length>=100)break
 }
 return result.slice(0,100)
}
export type BuildProfile={kind:'node'|'python'|'unknown';profileHash?:string;scripts:string[];lockfile?:string;packageManager?:string;note:string}
export function inspectBuild(workspace:AgentWorkspace):BuildProfile{
 const has=(name:string)=>{try{workspace.read(name);return true}catch{return false}}
 if(has('package.json')){
  const text=workspace.read('package.json'),manifest=JSON.parse(text)
  const scripts=Object.keys(manifest.scripts||{}).filter(name=>/^(test|check|lint|build)(:[a-zA-Z0-9_-]+)?$/.test(name)&&typeof manifest.scripts[name]==='string')
  const lockfile=['package-lock.json','pnpm-lock.yaml','yarn.lock'].find(has)
  return {kind:'node',profileHash:createHash('sha256').update(text).update(lockfile?workspace.read(lockfile):'').digest('hex'),scripts,lockfile,packageManager:typeof manifest.packageManager==='string'?manifest.packageManager.split('@')[0]:lockfile==='pnpm-lock.yaml'?'pnpm':lockfile==='yarn.lock'?'yarn':'npm',note:'仅发现项目配置，未执行脚本或安装依赖。'}
 }
 if(['pyproject.toml','setup.py','requirements.txt'].some(has)){
  const names=['pyproject.toml','setup.py','requirements.txt'].filter(has)
  return {kind:'python',profileHash:createHash('sha256').update(names.map(name=>workspace.read(name)).join('\n')).digest('hex'),scripts:['test'],packageManager:'python',note:'使用当前配置的 Python 环境执行 pytest；不自动安装依赖。'}
 }
 return {kind:'unknown',scripts:[],note:'尚未发现受支持的 Node/Python 项目；其他项目可使用明确的命令工具。'}
}
export function prepareBuild(workspace:AgentWorkspace,args:Record<string,unknown>):PreparedAction{
 const profile=inspectBuild(workspace),action=String(args.action||'build')
 if(!profile.scripts.includes(action))throw new ToolError('INVALID_ARGUMENTS','项目未定义此构建/验证动作，请先调用 inspect_build')
 const timeout=Number(args.timeoutSeconds||120)
 const manager=profile.packageManager
 if(!manager||!['npm','pnpm','yarn','python'].includes(manager))throw new ToolError('INVALID_ARGUMENTS','暂不支持项目声明的包管理器')
 let executable=manager,argv=['run',action],shell=false
 if(profile.kind==='python'){executable=process.env.MYPLANE_PYTHON||(process.platform==='win32'?'python':'python3');argv=['-m','pytest']}
 else if(process.platform==='win32'){
  // Only fixed manager names and validated manifest script identifiers enter cmd.
  executable=process.env.ComSpec||'cmd.exe';argv=['/d','/s','/c',`${manager} run ${action}`]
 }
 const request:ProcessRequest={executable,args:argv,cwd:workspace.root,shell,timeoutMs:timeout*1000,sandbox:'prefer',...(profile.kind==='python'?{sandboxImage:process.env.MYPLANE_SANDBOX_PYTHON_IMAGE?.trim()||'python:3.12-slim'}:{})}
 return {preview:{command:[executable,...argv].join(' '),cwd:workspace.root,note:'优先在本机已有容器沙盒中执行，默认断网并限制资源；沙盒不可用时需用户确认后降级，不自动安装依赖。'},execute:async(signal,onOutput)=>{
  if(inspectBuild(workspace).profileHash!==profile.profileHash)throw new ToolError('BUILD_CONFLICT','构建配置或锁文件在确认期间发生变化，请重新检查')
  const result=await executeProcess(request,signal,onOutput),diagnostics=parseDiagnostics(result.output)
  const failureAnalysis=analyzeTestResult(result,diagnostics,action)
  // Put structured, actionable fields before raw output so paged tool results
  // still expose the diagnosis and retry policy to the model.
  return JSON.stringify({exitCode:result.exitCode,durationMs:result.durationMs,termination:result.termination,error:result.error,truncated:result.truncated,sandbox:result.sandbox,profile:{kind:profile.kind,hash:profile.profileHash,action},diagnostics,failureAnalysis,validation:{passed:result.exitCode===0&&!result.termination,note:'仅确认本次构建/测试命令结果，不代表全部需求通过。'},output:result.output})
 }}
}
