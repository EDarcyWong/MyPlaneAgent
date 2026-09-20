import {spawn,type ChildProcess} from 'node:child_process'
import {createServer} from 'node:net'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {runtimeExecutableName,validRuntimeExecutable} from './local-ai-runtime-package.js'
import {findVisionProjector} from './local-ai-vision.js'
import type {StudioRuntime,StudioSettings,StudioLocalModel} from '../shared/local-ai-studio.js'
import type {DeveloperPreferences,RuntimeLoadOptions} from '../shared/local-ai-developer.js'

export class LocalAiRuntime {
 private child:ChildProcess|undefined
 private timer:ReturnType<typeof setTimeout>|undefined
 private key=''
 private status:StudioRuntime={state:'stopped',modelId:'',modelName:'',endpoint:'',error:'',logs:[]}
 get apiKey(){return this.key}
 snapshot():StudioRuntime{return {...this.status,logs:[...this.status.logs]}}
 clearLogs(){this.status.logs=[]}
 private log(line:string){for(const part of line.split(/\r?\n/).filter(Boolean))this.status.logs.push(`${new Date().toLocaleTimeString()} ${part.replaceAll(this.key||'\0','[REDACTED]').slice(0,2000)}`);this.status.logs=this.status.logs.slice(-160)}
 async start(settings:StudioSettings,model:StudioLocalModel,options:DeveloperPreferences={host:'127.0.0.1',parallel:1,embedding:false,metrics:true,hasApiKey:false},apiKey='',loadOptions:RuntimeLoadOptions={}){
  if(this.child||this.status.state==='starting')throw new Error('请先卸载当前模型')
  if(!validRuntimeExecutable(settings.runtimePath))throw new Error(`未找到可执行的 ${runtimeExecutableName()}。请在开发者 > 运行时中自动查找、安装官方运行包，或选择解压后具有执行权限的运行文件`)
  if(!model.exists||model.format!=='GGUF')throw new Error('托管运行需要有效的 GGUF 模型文件')
  const projector=findVisionProjector(model.localPath)
  this.status={state:'starting',modelId:model.id,modelName:`myplane-${model.id.slice(0,16)}`,endpoint:`http://127.0.0.1:${settings.runtimePort}/v1`,error:'',logs:[],startedAt:Date.now(),host:options.host,parallel:options.parallel,contextLength:settings.contextLength,embedding:options.embedding}
  try{
   this.status.vision=!!projector
   const listenPort=await new Promise<number>((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const address=probe.address();if(!address||typeof address==='string'){probe.close();reject(new Error('无法分配内部推理端口'));return}probe.close(error=>error?reject(error):resolve(address.port))})})
   if(this.status.state!=='starting')return this.snapshot()
   this.status.endpoint=`http://127.0.0.1:${listenPort}/v1`
   this.key=apiKey||randomUUID()
   const args=['--model',model.localPath,'--host','127.0.0.1','--port',String(listenPort),'--ctx-size',String(settings.contextLength),'--n-gpu-layers',String(settings.gpuLayers),'--threads',String(settings.threads),'--alias',this.status.modelName,'--parallel',String(options.parallel),'--no-webui',...(options.metrics?['--metrics']:[]),...(options.embedding?['--embedding']:['--jinja']),...(loadOptions.eval_batch_size!==undefined?['--batch-size',String(loadOptions.eval_batch_size)]:[]),...(loadOptions.flash_attention!==undefined?['--flash-attn',loadOptions.flash_attention?'on':'off']:[]),...(loadOptions.offload_kv_cache_to_gpu===false?['--no-kv-offload']:[])]
   if(projector)args.push('--mmproj',projector)
   const env={...process.env};for(const name of Object.keys(env))if(name.startsWith('LLAMA_ARG_')||name==='LLAMA_API_KEY')delete env[name]
   env.LLAMA_API_KEY=this.key
   const pathKey=Object.keys(env).find(name=>name.toLowerCase()==='path')||'PATH';env[pathKey]=`${path.dirname(settings.runtimePath)}${path.delimiter}${env[pathKey]||''}`
   const child=spawn(settings.runtimePath,args,{windowsHide:true,shell:false,cwd:path.dirname(settings.runtimePath),env,stdio:['ignore','pipe','pipe']});this.child=child;this.status.pid=child.pid
   this.log(`正在加载 ${model.file}；上下文 ${settings.contextLength}，GPU 层 ${settings.gpuLayers}`)
   this.log(projector?`已加载视觉组件：${path.basename(projector)}`:'未加载视觉组件，当前仅支持文字输入')
   child.stdout?.on('data',data=>this.log(String(data)));child.stderr?.on('data',data=>this.log(String(data)))
   child.once('error',error=>{this.status.state='error';this.status.error=error.message;this.log(error.message);this.child=undefined;clearTimeout(this.timer)})
   child.once('exit',(code,signal)=>{clearTimeout(this.timer);if(this.child===child)this.child=undefined;this.status.pid=undefined;if(this.status.state==='stopping')this.status.state='stopped';else if(this.status.state!=='error'){this.status.state='error';this.status.error=code!==null&&(code>>>0)===0xc0000135?'运行包缺少 DLL，请重新安装完整运行包，不要只复制 llama-server.exe':`模型进程已退出（${code??signal}），请查看日志；检查模型架构、运行包版本、内存和 GPU 参数`};this.log(`进程退出：${code??signal}`)})
   const deadline=Date.now()+300_000
   const poll=async()=>{
    if(this.child!==child||this.status.state!=='starting')return
    try{const response=await fetch(`${this.status.endpoint}/models`,{headers:{Authorization:`Bearer ${this.key}`},signal:AbortSignal.timeout(2000)});if(response.ok){const json=await response.json() as {data?:{id?:string}[]};if(json.data?.some(item=>item.id===this.status.modelName)&&this.child===child&&this.status.state==='starting'){this.status.state='running';this.log('模型已就绪，OpenAI 兼容服务已启动');return}}}catch{}
    if(this.child!==child||this.status.state!=='starting')return
    if(Date.now()>deadline){this.status.state='error';this.status.error='模型加载超过 5 分钟，请查看日志并尝试降低上下文或 GPU 层数';child.kill();return}
    this.timer=setTimeout(()=>void poll(),1000);this.timer.unref()
   };void poll()
   return this.snapshot()
  }catch(error){this.status.state='error';this.status.error=String(error);throw error}
 }
 async stop(){
  clearTimeout(this.timer);const child=this.child
  if(!child){this.status.state='stopped';this.status.error='';return this.snapshot()}
  this.status.state='stopping'
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('模型进程未能退出，请稍后重试')),5000);child.once('exit',()=>{clearTimeout(timeout);resolve()});child.once('error',()=>{clearTimeout(timeout);resolve()});child.kill()})
  return this.snapshot()
 }
 dispose(){clearTimeout(this.timer);if(this.child){this.status.state='stopping';this.child.kill()}}
}
