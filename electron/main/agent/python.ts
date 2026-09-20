import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import {StringDecoder} from 'node:string_decoder'
import {stopProcessTree} from './processes.js'

type PythonRequest={tool:string;args:Record<string,unknown>;workspace:string;code?:string;context?:Record<string,unknown>}
type Pending={started:number;timer:NodeJS.Timeout;abort:()=>void;signal:AbortSignal;onOutput?:(text:string)=>void;resolve:(value:{output:string;elapsedMs:number})=>void;reject:(error:Error)=>void}
const moduleDirectory=path.dirname(fileURLToPath(import.meta.url))

class PythonWorker {
 private stopping:Promise<void>=Promise.resolve()
 private child?:ChildProcessWithoutNullStreams
 private stdout=''
 private stderr=''
 private launchedRevision=''
 private pending=new Map<string,Pending>()
 constructor(private workerFile?:string){}
 private script(){
  const development=path.join(path.resolve(moduleDirectory,'../../../'),'python','agent_tools_worker.py')
  const packaged=typeof process.resourcesPath==='string'?path.join(process.resourcesPath,'python','agent_tools_worker.py'):undefined
  const candidates=[this.workerFile,process.env.MYPLANE_AGENT_TOOLS_PY,packaged,development].filter(Boolean) as string[]
  const found=candidates.find(file=>fs.existsSync(file));if(!found)throw new Error('未找到 Python Agent 工具运行文件')
  return found
 }
 source(){return fs.readFileSync(this.script(),'utf8')}
 revision(){return createHash('sha256').update(this.source()).digest('hex')}
 private settle(id:string,error?:Error,output?:unknown){
  const item=this.pending.get(id);if(!item)return
  this.pending.delete(id);clearTimeout(item.timer);item.signal.removeEventListener('abort',item.abort)
  if(error)item.reject(error)
  else{const text=typeof output==='string'?output:JSON.stringify(output);item.onOutput?.(text.slice(0,40000));item.resolve({output:text,elapsedMs:Date.now()-item.started})}
 }
 private rejectAll(error:Error){for(const id of [...this.pending.keys()])this.settle(id,error)}
 private terminate(error:Error){
  const child=this.child;this.child=undefined;this.launchedRevision='';this.stdout='';this.stderr='';this.rejectAll(error)
  if(child?.pid)this.stopping=stopProcessTree(child.pid).catch(()=>{child.kill('SIGKILL')});else child?.kill('SIGKILL')
 }
 private start(revision:string){
  const executable=process.env.MYPLANE_PYTHON||(process.platform==='win32'?'python':'python3'),child=spawn(executable,[this.script(),'--server'],{windowsHide:true,shell:false,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,USERPROFILE:process.env.USERPROFILE,HOME:process.env.HOME,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'},stdio:['pipe','pipe','pipe']})
  this.child=child;this.launchedRevision=revision;this.stdout='';this.stderr=''
  const stdoutDecoder=new StringDecoder('utf8'),stderrDecoder=new StringDecoder('utf8')
  child.stdout.on('data',chunk=>{
   if(this.child!==child)return;this.stdout+=stdoutDecoder.write(chunk)
   if(this.stdout.length>1000000){this.terminate(new Error('Python 工具返回内容过大'));return}
   let newline=this.stdout.indexOf('\n')
   while(newline>=0){const line=this.stdout.slice(0,newline).trim();this.stdout=this.stdout.slice(newline+1);newline=this.stdout.indexOf('\n');if(!line)continue
    try{const message=JSON.parse(line),id=String(message.id||'');if(!id||!this.pending.has(id))throw new Error('响应 ID 无效');if(message.error)this.settle(id,new Error(String(message.error)));else this.settle(id,undefined,message.output)}catch(error){this.terminate(new Error('Python 工具未返回有效 JSON：'+String(error).slice(0,500)));return}
   }
  })
  child.stderr.on('data',chunk=>{if(this.child===child)this.stderr=(this.stderr+stderrDecoder.write(chunk)).slice(-20000)})
  child.on('error',error=>{if(this.child===child)this.terminate(new Error(`无法启动 Python：${error.message}`))})
  child.on('close',code=>{if(this.child!==child)return;const detail=this.stderr.trim(),message=code===0?'Python 工具进程已退出':'Python 工具进程异常退出：'+(detail||`代码 ${code}`);this.child=undefined;this.launchedRevision='';this.rejectAll(new Error(message.slice(0,1000)))})
  return child
 }
 async execute(request:PythonRequest,signal:AbortSignal,timeoutMs=60000,onOutput?:(text:string)=>void){
  signal.throwIfAborted();const revision=this.revision()
  if(this.child&&this.launchedRevision!==revision)this.terminate(new Error('Python 工具运行文件已更新，正在重启'))
  const child=this.child||this.start(revision),id=randomUUID()
  return new Promise<{output:string;elapsedMs:number}>((resolve,reject)=>{
   const abort=()=>this.terminate(new Error('任务已停止')),timer=setTimeout(()=>this.terminate(new Error('Python 工具执行超时')),timeoutMs)
   this.pending.set(id,{started:Date.now(),timer,abort,signal,onOutput,resolve,reject});signal.addEventListener('abort',abort,{once:true})
   child.stdin.write(JSON.stringify({id,...request})+'\n','utf8',error=>{if(error&&this.pending.has(id))this.terminate(new Error('无法发送 Python 工具请求：'+error.message))})
  })
 }
 dispose(){this.terminate(new Error('Python 工具运行时已关闭'));return this.stopping}
}

// Each invocation owns its process and cancellation boundary. User code cannot
// leave Python globals/caches in another task's interpreter.
export class PythonToolRuntime {
 private workers=new Set<PythonWorker>()
 private metadata:PythonWorker
 private closed=false
 constructor(private workerFile?:string){this.metadata=new PythonWorker(workerFile)}
 source(){return this.metadata.source()}
 revision(){return this.metadata.revision()}
 async execute(request:PythonRequest,signal:AbortSignal,timeoutMs=60000,onOutput?:(text:string)=>void){
  signal.throwIfAborted()
  if(this.closed)throw new Error('Python 工具运行时已关闭')
  if(this.workers.size>=8)throw new Error('Python 执行队列已满，请等待现有步骤结束')
  const worker=new PythonWorker(this.workerFile);this.workers.add(worker)
  try{return await worker.execute(request,signal,timeoutMs,onOutput)}
  finally{await worker.dispose();this.workers.delete(worker)}
 }
 async dispose(){this.closed=true;await Promise.all([...this.workers].map(worker=>worker.dispose()));this.workers.clear()}
}
