import {spawn} from 'node:child_process'
import {StringDecoder} from 'node:string_decoder'
import {stopProcessTree} from './processes.js'
import {ToolError} from './registry.js'

export type ProcessRequest={executable:string;args?:string[];cwd:string;shell?:boolean;timeoutMs:number;maxOutputBytes?:number}
export type ProcessResult={exitCode:number|null;durationMs:number;output:string;error?:string;termination?:'cancelled'|'timeout'|'output-limit';truncated:boolean}
export async function executeProcess(request:ProcessRequest,signal:AbortSignal,onOutput?:(text:string)=>void):Promise<ProcessResult>{
 signal.throwIfAborted()
 const env:NodeJS.ProcessEnv={}
 for(const key of ['PATH','HOME','USERPROFILE','SystemRoot','ComSpec','PATHEXT','TEMP','TMP','TMPDIR','LANG','LC_ALL'])if(process.env[key])env[key]=process.env[key]
 return new Promise((resolve,reject)=>{
  const started=Date.now(),limit=request.maxOutputBytes??2_000_000
  const child=spawn(request.executable,request.args||[],{cwd:request.cwd,shell:request.shell===true,env,detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','pipe','pipe']})
  let output='',bytes=0,settled=false,truncated=false,spawned=false,termination:ProcessResult['termination'],cleanup:Promise<void>|undefined
  child.once('spawn',()=>{spawned=true})
  const stop=()=>cleanup??=(async()=>{
   if(!child.pid)return
   if(process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');return}catch{/* Already exited, or group unavailable. */}}
   await stopProcessTree(child.pid)
   try{child.kill('SIGKILL')}catch{/* Already exited. */}
  })()
  const abort=()=>{termination='cancelled';void stop()}
  const timer=setTimeout(()=>{termination='timeout';void stop()},request.timeoutMs)
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
  const decoders=[new StringDecoder('utf8'),new StringDecoder('utf8')]
  const append=(chunk:Buffer,index:number)=>{
   const available=Math.max(0,limit-bytes);bytes+=chunk.length
   output+=decoders[index].write(chunk.subarray(0,available));onOutput?.(output)
   if(bytes>limit){truncated=true;termination??='output-limit';void stop()}
  }
  child.stdout.on('data',chunk=>append(chunk,0));child.stderr.on('data',chunk=>append(chunk,1))
  const finish=async(error?:Error,code:number|null=null)=>{
   if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort)
   if(cleanup)await cleanup
   output+=decoders.map(decoder=>decoder.end()).join('')
   if(error){reject(spawned?error:new ToolError('PROCESS_START_FAILED','无法启动执行环境：'+error.message));return}
   resolve({exitCode:code,durationMs:Date.now()-started,output,truncated,...(termination?{termination,error:termination==='cancelled'?'任务已停止':termination==='timeout'?'命令超过运行时间限制，已请求终止进程树':'命令输出超过容量，已请求终止进程树'}:{})})
  }
  child.on('error',error=>{void finish(error)});child.on('close',code=>{void finish(undefined,code)})
 })
}
