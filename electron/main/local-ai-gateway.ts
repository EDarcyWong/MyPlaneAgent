import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http'
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import type {RuntimeLoadOptions} from '../shared/local-ai-developer.js'
import type {StudioDownload,StudioLocalModel,StudioModelFile,StudioRuntime} from '../shared/local-ai-studio.js'
import {readIntegrationJson,writeIntegrationJson} from './integration-store.js'
import {modelFile,record,repoId,sseData,textValue} from './local-ai-utils.js'

type Json=Record<string,unknown>
type GatewayBackend={
 models:()=>StudioLocalModel[]
 runtime:()=>StudioRuntime
 credential:()=>string
 load:(id:string,options:RuntimeLoadOptions)=>Promise<StudioRuntime>
 unload:()=>Promise<StudioRuntime>
 files:(repo:string)=>Promise<StudioModelFile[]>
 enqueue:(repo:string,file:string)=>Promise<StudioDownload[]>
 downloads:()=>StudioDownload[]
}
type DownloadJob={repo:string;files:string[];ids:string[];revision:string;startedAt:string;completedAt?:string;total:number}
type SavedResponse={model:string;messages:Json[];bytes:number;expires:number}
class ApiError extends Error {
 constructor(readonly status:number,readonly type:string,message:string,readonly param?:string){super(message)}
}
const failure=(status:number,type:string,message:string,param?:string)=>new ApiError(status,type,message,param)
const firstShard=(file:string)=>!/-\d{5}-of-\d{5}\.gguf$/i.test(file)||/-00001-of-\d{5}\.gguf$/i.test(file)
const hash=(value:string)=>createHash('sha256').update(value).digest()
const stringField=(value:unknown,name:string)=>{if(typeof value!=='string'||!value.trim())throw failure(400,'invalid_request',`${name} must be a non-empty string`,name);return value.trim()}
const routes=new Map<string,string>([
 ['/api/v1/models','GET'],['/api/v1/chat','POST'],['/api/v1/models/load','POST'],['/api/v1/models/unload','POST'],['/api/v1/models/download','POST'],
 ['/v1/models','GET'],['/v1/chat/completions','POST'],['/v1/completions','POST'],['/v1/embeddings','POST'],['/v1/responses','POST'],
 ['/v1/messages','POST'],['/v1/messages/count_tokens','POST'],['/health','GET'],['/props','GET'],['/slots','GET'],['/metrics','GET']
])

/** One authenticated public listener; llama-server only listens on a private loopback port. */
export class LocalAiGateway {
 private server:Server|undefined
 private starting:Promise<void>|undefined
 private key=''
 private base=''
 private requests=new Set<AbortController>()
 private logs:string[]=[]
 private loading:Promise<StudioRuntime>|undefined
 private loadOptions:RuntimeLoadOptions={}
 private inferenceCount=0
 private history=new Map<string,SavedResponse>()
 private jobs:Record<string,DownloadJob>={}
 constructor(private readonly backend:GatewayBackend,private readonly jobsFile:string){
  try{
   const saved=readIntegrationJson<Record<string,DownloadJob>>(jobsFile,{})
   for(const [id,job] of Object.entries(saved).slice(-200))if(/^job_[a-f\d-]{36}$/i.test(id)&&job&&Array.isArray(job.files)&&Array.isArray(job.ids)&&typeof job.repo==='string'&&typeof job.revision==='string')this.jobs[id]=job
  }catch{this.log('Download job metadata could not be read; the model download queue is unchanged.')}
 }
 get running(){return this.server?.listening===true}
 get active(){return this.running||!!this.starting}
 get endpoint(){return this.base?`${this.base}/v1`:''}
 get apiKey(){return this.key}
 requestLogs(){return [...this.logs]}
 clearLogs(){this.logs=[]}
 private log(message:string){this.logs.push(`${new Date().toLocaleTimeString()} [API] ${message.replaceAll(this.key||'\0','[REDACTED]').slice(0,500)}`);this.logs=this.logs.slice(-160)}
 async start(host:string,port:number,key:string){
  if(this.running)return
  if(this.starting)return this.starting
  this.key=key||randomUUID();this.base=`http://127.0.0.1:${port}`
  const server=createServer((request,response)=>{void this.handle(request,response)})
  this.server=server;server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=5000
  server.on('error',error=>this.log(`Listener error: ${error.message}`))
  this.starting=new Promise<void>((resolve,reject)=>{
   const onError=(error:Error)=>reject(new Error(`API 端口 ${port} 启动失败：${error.message}`))
   server.once('error',onError);server.listen(port,host,()=>{server.removeListener('error',onError);resolve()})
  })
  try{await this.starting;this.log(`Listening on ${host}:${port}; LM Studio API / OpenAI / Anthropic; authentication required`)}
  catch(error){this.server=undefined;this.key='';throw error}
  finally{this.starting=undefined}
 }
 async stop(){
  if(this.starting)await this.starting.catch(()=>{})
  for(const controller of this.requests)controller.abort()
  const server=this.server;this.server=undefined
  if(server?.listening)await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections()})
  this.history.clear();this.key='';this.log('API server stopped')
 }
 dispose(){for(const controller of this.requests)controller.abort();this.server?.close();this.server?.closeAllConnections();this.history.clear()}
 private send(response:ServerResponse,status:number,body:unknown){if(response.destroyed)return;response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(body))}
 private async write(response:ServerResponse,data:string|Uint8Array){
  if(response.destroyed)throw new Error('Client disconnected')
  await new Promise<void>((resolve,reject)=>{response.write(data,error=>error?reject(error):resolve())})
 }
 private async event(response:ServerResponse,type:string,data:Json={}){await this.write(response,`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`)}
 private errorBody(error:ApiError,anthropic:boolean,native:boolean){
  const type=anthropic?(error.status===401?'authentication_error':error.status===404?'not_found_error':error.status===413?'request_too_large':error.status===429?'rate_limit_error':error.status<500?'invalid_request_error':'api_error'):native?error.type:error.status<500?'invalid_request_error':'server_error'
  return {...(anthropic?{type:'error'}:{}),error:{type,message:error.message,...(!anthropic?{code:error.type,...(error.param?{param:error.param}:{})}:{})}}
 }
 private async body(request:IncomingMessage){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||''))throw failure(415,'invalid_request','Content-Type must be application/json')
  const chunks:Buffer[]=[];let size=0
  for await(const chunk of request){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>8*1024*1024)throw failure(413,'invalid_request','Request body exceeds 8 MB');chunks.push(bytes)}
  try{const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body as Json}
  catch{throw failure(400,'invalid_request','Request body must be a JSON object')}
 }
 private async handle(request:IncomingMessage,response:ServerResponse){
  const started=Date.now(),controller=new AbortController()
  let pathname='',inference=false
  response.setHeader('Access-Control-Allow-Origin','*')
  response.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta')
  response.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS')
  response.setHeader('Cache-Control','no-store')
  const abort=()=>controller.abort();request.once('aborted',abort);response.once('close',abort)
  try{
   pathname=new URL(request.url||'/','http://localhost').pathname
   const statusMatch=pathname.match(/^\/api\/v1\/models\/download\/status\/(job_[a-f\d-]{36})$/i)
   const method=routes.get(pathname)||(statusMatch?'GET':undefined)
   if(!method)throw failure(404,'not_found','Unknown API endpoint')
   if(request.method==='OPTIONS'){response.writeHead(204);response.end();return}
   const auth=request.headers.authorization,bearer=typeof auth==='string'&&/^Bearer /i.test(auth)?auth.slice(7):''
   const supplied=pathname.startsWith('/v1/messages')&&typeof request.headers['x-api-key']==='string'?request.headers['x-api-key']:bearer
   if(!this.key||typeof supplied!=='string'||!timingSafeEqual(hash(supplied),hash(this.key)))throw failure(401,'authentication_error','Invalid API key')
   if(request.method!==method){response.setHeader('Allow',method);throw failure(405,'invalid_request',`Use ${method} for this endpoint`)}
   if(this.requests.size>=32)throw failure(429,'rate_limit_error','Too many active requests')
   if(Number(request.headers['content-length']||0)>8*1024*1024)throw failure(413,'invalid_request','Request body exceeds 8 MB')
   this.requests.add(controller)
   // Let the agent/chat caller's 30-minute generation deadline expire first.
   const requestTimeout=pathname==='/v1/chat/completions'?31*60*1000:20*60*1000
   const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(requestTimeout)])
   const body=method==='POST'?await this.body(request):{}
   if(pathname==='/api/v1/models'){this.send(response,200,{models:this.nativeModels()});return}
   if(pathname==='/api/v1/models/load'){
    const options=this.parseLoad(body),runtime=await this.ensureModel(stringField(body.model,'model'),options,signal)
    this.send(response,200,{type:runtime.embedding?'embedding':'llm',instance_id:runtime.modelName,status:'loaded',load_time_seconds:Math.max(0,(Date.now()-(runtime.startedAt||Date.now()))/1000),...(body.echo_load_config===true?{load_config:{context_length:this.context(runtime),...this.loadOptions}}:{})});return
   }
   if(pathname==='/api/v1/models/unload'){this.send(response,200,await this.unload(stringField(body.instance_id,'instance_id')));return}
   if(pathname==='/api/v1/models/download'){this.send(response,200,await this.download(body));return}
   if(statusMatch){this.send(response,200,this.downloadStatus(statusMatch[1]));return}
   if(pathname==='/v1/models'){
    const runtime=this.backend.runtime()
    this.send(response,200,{object:'list',data:this.models().map(model=>({id:runtime.state==='running'&&runtime.modelId===model.id?runtime.modelName:model.id,object:'model',created:Math.floor((Date.parse(model.downloadedAt)||0)/1000),owned_by:model.repoId}))});return
   }
   if(pathname==='/health'){this.send(response,200,{status:'ok',model_state:this.backend.runtime().state});return}
   inference=method==='POST';if(inference)this.inferenceCount++
   if(pathname==='/api/v1/chat'){await this.chat(body,response,signal);return}
   const runtime=method==='POST'?await this.ensureModel(stringField(body.model,'model'),{},signal):this.backend.runtime()
   if(runtime.state!=='running')throw failure(503,'model_not_loaded','Load a model before using runtime diagnostics')
   await this.proxy(pathname,method,body,runtime,request,response,signal)
  }catch(cause){
   if(!response.destroyed){
    const error=cause instanceof ApiError?cause:failure(502,'internal_error',cause instanceof Error?cause.message:'Local API request failed')
    if(response.headersSent){if(pathname==='/api/v1/chat'){await this.event(response,'error',{error:record(this.errorBody(error,false,true).error)}).catch(()=>{});response.end()}else response.destroy()}
    else{response.setHeader('Connection','close');this.send(response,error.status,this.errorBody(error,pathname.startsWith('/v1/messages'),pathname.startsWith('/api/')));request.resume()}
   }
  }finally{
   if(inference)this.inferenceCount--
   this.requests.delete(controller);request.removeListener('aborted',abort);response.removeListener('close',abort)
   this.log(`${request.method||'GET'} ${pathname} ${response.statusCode} ${Date.now()-started}ms`)
  }
 }
 private models(){return this.backend.models().filter(model=>model.exists&&model.format==='GGUF'&&firstShard(model.file)&&!/(?:^|\/)mmproj[-.]/i.test(model.file))}
 private context(runtime:StudioRuntime){return Math.floor((runtime.contextLength||0)/(runtime.parallel||1))}
 private resolve(identifier:string){
  const runtime=this.backend.runtime(),models=this.models()
  const exact=models.find(model=>model.id===identifier||(runtime.modelId===model.id&&runtime.modelName===identifier))
  if(exact)return exact
  const matches=models.filter(model=>model.repoId===identifier||model.file===identifier||`${model.repoId}/${model.file}`===identifier)
  if(matches.length===1)return matches[0]
  if(matches.length>1)throw failure(400,'invalid_request','Several quantizations match. Use the key returned by /api/v1/models','model')
  throw failure(404,'model_not_found','Model is not downloaded or imported. Query /api/v1/models first','model')
 }
 private parseLoad(body:Json):RuntimeLoadOptions{
  const allowed=['model','context_length','eval_batch_size','flash_attention','offload_kv_cache_to_gpu','echo_load_config']
  for(const key of Object.keys(body))if(!allowed.includes(key))throw failure(501,'not_implemented',`Load option ${key} is not implemented`,key)
  const options:RuntimeLoadOptions={}
  for(const key of ['context_length','eval_batch_size'] as const)if(body[key]!==undefined){const value=body[key];if(typeof value!=='number'||!Number.isInteger(value)||value<(key==='context_length'?512:1)||value>(key==='context_length'?131072:8192))throw failure(400,'invalid_request',`Invalid ${key}`,key);options[key]=value}
  for(const key of ['flash_attention','offload_kv_cache_to_gpu'] as const)if(body[key]!==undefined){if(typeof body[key]!=='boolean')throw failure(400,'invalid_request',`${key} must be boolean`,key);options[key]=body[key]}
  return options
 }
 private async ensureModel(identifier:string,options:RuntimeLoadOptions,signal:AbortSignal){
  const model=this.resolve(identifier)
  if(this.loading)await this.loading
  signal.throwIfAborted()
  let runtime=this.backend.runtime()
  if(['starting','running','stopping'].includes(runtime.state)||runtime.pid){
   if(runtime.modelId!==model.id||runtime.state==='stopping')throw failure(409,'model_busy','Unload the current model before loading another')
   for(const [key,value] of Object.entries(options))if((key==='context_length'?this.context(runtime):this.loadOptions[key as keyof RuntimeLoadOptions])!==value)throw failure(409,'model_busy','Unload the model before changing its load configuration')
  }else{
   const pending=this.backend.load(model.id,options);this.loading=pending
   try{runtime=await pending;this.loadOptions={...options}}finally{if(this.loading===pending)this.loading=undefined}
  }
  const deadline=Date.now()+305000
  while(runtime.state==='starting'&&runtime.modelId===model.id&&Date.now()<deadline){await delay(200,undefined,{signal});runtime=this.backend.runtime()}
  if(runtime.state!=='running'||runtime.modelId!==model.id)throw failure(503,'model_load_failed','Model did not become ready. Check the developer runtime logs.')
  return runtime
 }
 async unload(instance?:string){
  const runtime=this.backend.runtime()
  if(instance&&instance!==runtime.modelName)throw failure(404,'model_not_found','Unknown model instance','instance_id')
  if(this.inferenceCount)throw failure(409,'model_busy','Inference is active. Cancel or finish requests before unloading')
  await this.backend.unload();this.loadOptions={}
  return {instance_id:runtime.modelName}
 }
 private nativeModels(){
  const runtime=this.backend.runtime()
  return this.models().map(model=>{
   const loaded=runtime.state==='running'&&runtime.modelId===model.id
   return {type:loaded&&runtime.embedding?'embedding':'llm',key:model.id,publisher:model.repoId.includes('/')?model.repoId.split('/')[0]:'local',display_name:model.file,architecture:null,quantization:model.quantization?{name:model.quantization,bits_per_weight:null}:null,size_bytes:model.size,params_string:null,format:'gguf',loaded_instances:loaded?[{id:runtime.modelName,config:{context_length:this.context(runtime),parallel:runtime.parallel||1}}]:[]}
  })
 }
 private async proxy(pathname:string,method:string,body:Json,runtime:StudioRuntime,request:IncomingMessage,response:ServerResponse,signal:AbortSignal){
  const key=this.backend.credential(),anthropic=pathname.startsWith('/v1/messages')
  const headers:Record<string,string>={'Content-Type':'application/json',Authorization:`Bearer ${key}`}
  if(anthropic){headers['x-api-key']=key;headers['anthropic-version']=typeof request.headers['anthropic-version']==='string'?request.headers['anthropic-version']:'2023-06-01';if(typeof request.headers['anthropic-beta']==='string')headers['anthropic-beta']=request.headers['anthropic-beta']}
  const upstream=await fetch(`${runtime.endpoint.replace(/\/v1$/,'')}${pathname}`,{method,headers,...(method==='POST'?{body:JSON.stringify({...body,model:runtime.modelName})}:{}),signal})
  if(upstream.status===404&&(anthropic||pathname==='/v1/responses')){await upstream.body?.cancel();throw failure(501,'not_implemented','This llama-server version does not implement this endpoint. Install a recent official runtime in Developer > Runtime.')}
  response.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json','X-Accel-Buffering':'no'})
  if(upstream.body){const reader=upstream.body.getReader();try{while(true){const part=await reader.read();if(part.done)break;await this.write(response,part.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}}
  response.end()
 }
 private async download(body:Json){
  let id=stringField(body.model,'model'),file=''
  if(id.startsWith('https://')){
   const url=new URL(id);if(url.hostname!=='huggingface.co'||url.username||url.password||url.port)throw failure(400,'invalid_request','Use a Hugging Face model repository URL','model')
   const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);id=parts.slice(0,2).join('/')
   if(parts.length>2){if(!['blob','resolve'].includes(parts[2])||parts[3]!=='main'||parts.length<5)throw failure(400,'invalid_request','Use a repository URL or a /blob/main/ GGUF file URL','model');file=modelFile(parts.slice(4).join('/'))}
  }
  const repo=repoId(id),files=await this.backend.files(repo)
  const candidates=files.filter(item=>item.format==='GGUF'&&firstShard(item.file)&&!/(?:^|\/)mmproj[-.]/i.test(item.file))
  const quant=body.quantization===undefined?'':stringField(body.quantization,'quantization').toUpperCase()
  const matching=candidates.filter(item=>(!file||item.file===file)&&(!quant||item.quantization.toUpperCase()===quant))
  const selected=matching.find(item=>item.quantization.toUpperCase()==='Q4_K_M')||matching[0]
  if(!selected)throw failure(404,'model_not_found','No matching GGUF file. Use a GGUF repository and a quantization available in that repository.')
  const split=selected.file.match(/^(.*)-\d{5}-of-(\d{5})\.gguf$/i)
  const group=split?files.filter(item=>item.file.startsWith(`${split[1]}-`)&&item.file.endsWith(`-of-${split[2]}.gguf`)):[selected]
  if(split&&group.length!==Number(split[2]))throw failure(400,'invalid_request','The GGUF shard set is incomplete')
  const names=group.map(item=>item.file),local=this.backend.models()
  if(names.every(name=>local.some(model=>model.exists&&model.repoId===repo&&model.file===name)))return {status:'already_downloaded',total_size_bytes:group.reduce((sum,item)=>sum+item.size,0)}
  const rows=await this.backend.enqueue(repo,selected.file)
  const related=names.map(name=>rows.filter(row=>row.repoId===repo&&row.file===name&&row.revision===selected.revision).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]).filter((row):row is StudioDownload=>!!row)
  if(names.some(name=>!related.some(row=>row.file===name)&&!local.some(model=>model.exists&&model.repoId===repo&&model.file===name)))throw failure(409,'download_conflict','A model file exists outside the library. Import it or choose another model directory.')
  const previous=Object.entries(this.jobs).find(([,job])=>job.repo===repo&&job.revision===selected.revision&&job.files.join('\0')===names.join('\0')&&job.ids.join('\0')===related.map(row=>row.id).join('\0'))
  const jobId=previous?.[0]||`job_${randomUUID()}`
  this.jobs[jobId]=previous?.[1]||{repo,files:names,ids:related.map(row=>row.id),revision:selected.revision||'',startedAt:new Date().toISOString(),total:group.reduce((sum,item)=>sum+item.size,0)}
  for(const old of Object.keys(this.jobs).slice(0,-200))delete this.jobs[old]
  writeIntegrationJson(this.jobsFile,this.jobs)
  return this.downloadStatus(jobId)
 }
 private downloadStatus(jobId:string){
  const job=this.jobs[jobId];if(!job)throw failure(404,'job_not_found','Unknown download job','job_id')
  const rows=this.backend.downloads().filter(row=>job.ids.includes(row.id)),local=this.backend.models()
  let downloaded=0,complete=true,missing=false
  for(const file of job.files){const row=rows.find(item=>item.file===file),model=local.find(item=>item.exists&&item.repoId===job.repo&&item.file===file);if(row?.status==='completed'||model){downloaded+=model?.size||row?.total||row?.received||0}else{complete=false;downloaded+=row?.received||0;if(!row)missing=true}}
  const status=complete?'completed':missing||rows.some(row=>['failed','cancelled'].includes(row.status))?'failed':rows.some(row=>['queued','downloading','verifying'].includes(row.status))?'downloading':'paused'
  const speed=rows.reduce((sum,row)=>sum+(row.status==='downloading'?row.speed:0),0)
  if(complete&&!job.completedAt){job.completedAt=local.filter(model=>model.repoId===job.repo&&job.files.includes(model.file)).map(model=>model.downloadedAt).sort().at(-1)||new Date().toISOString();writeIntegrationJson(this.jobsFile,this.jobs)}
  return {job_id:jobId,status,total_size_bytes:job.total,downloaded_bytes:downloaded,bytes_per_second:speed,started_at:job.startedAt,...(complete?{completed_at:job.completedAt}:speed>0&&job.total>downloaded?{estimated_completion:new Date(Date.now()+(job.total-downloaded)/speed*1000).toISOString()}:{}),...(status==='failed'?{error:{type:'download_failed',message:'Download failed or was cancelled. See the download queue for details.'}}:{})}
 }
 private remember(model:string,messages:Json[]){
  const bytes=Buffer.byteLength(JSON.stringify(messages))
  if(bytes>4*1024*1024)throw failure(413,'invalid_request','Stored conversation exceeds 4 MB. Start a new conversation or use store:false.')
  for(const [id,item] of this.history)if(item.expires<Date.now())this.history.delete(id)
  let total=[...this.history.values()].reduce((sum,item)=>sum+item.bytes,0)
  while(this.history.size&&(this.history.size>=32||total+bytes>16*1024*1024)){const id=this.history.keys().next().value!;total-=this.history.get(id)!.bytes;this.history.delete(id)}
  const id=`resp_${randomUUID()}`;this.history.set(id,{model,messages,bytes,expires:Date.now()+2*60*60*1000});return id
 }
 private async chat(body:Json,response:ServerResponse,signal:AbortSignal){
  const allowed=['model','input','system_prompt','stream','temperature','top_p','top_k','min_p','repeat_penalty','max_output_tokens','context_length','store','previous_response_id']
  for(const key of Object.keys(body))if(!allowed.includes(key))throw failure(501,'not_implemented',`Chat option ${key} is not implemented. Use /v1/chat/completions for client-side tool calls.`,key)
  for(const key of ['stream','store'] as const)if(body[key]!==undefined&&typeof body[key]!=='boolean')throw failure(400,'invalid_request',`${key} must be boolean`,key)
  if(body.system_prompt!==undefined&&typeof body.system_prompt!=='string')throw failure(400,'invalid_request','system_prompt must be a string','system_prompt')
  const model=this.resolve(stringField(body.model,'model'))
  let history:Json[]=[]
  if(body.previous_response_id!==undefined){const id=stringField(body.previous_response_id,'previous_response_id'),saved=this.history.get(id);if(!saved||saved.expires<Date.now())throw failure(404,'not_found','Response history expired or was cleared when the API server stopped','previous_response_id');if(saved.model!==model.id)throw failure(400,'invalid_request','Previous response belongs to another model');history=[...saved.messages]}
  if(body.system_prompt!==undefined)history=[{role:'system',content:body.system_prompt},...history.filter(item=>item.role!=='system')]
  let content:unknown
  if(typeof body.input==='string')content=body.input
  else if(Array.isArray(body.input)&&body.input.length){content=body.input.map(value=>{const item=record(value);if(item.type==='text'&&typeof item.content==='string')return {type:'text',text:item.content};if(item.type==='image'&&typeof item.data_url==='string'&&/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(item.data_url))return {type:'image_url',image_url:{url:item.data_url}};throw failure(400,'invalid_request','input accepts text blocks and base64 data_url image blocks','input')})}
  else throw failure(400,'invalid_request','input must be a string or a non-empty content array','input')
  const messages:Json[]=[...history,{role:'user',content}]
  if(body.store!==false&&Buffer.byteLength(JSON.stringify(messages))>3*1024*1024)throw failure(413,'invalid_request','Conversation is too large to store. Start a new conversation or use store:false.')
  const options=body.context_length===undefined?{}:this.parseLoad({context_length:body.context_length})
  const runtime=await this.ensureModel(model.id,options,signal)
  if(runtime.embedding)throw failure(400,'invalid_request','The loaded model is in embedding mode')
  const payload:Json={model:runtime.modelName,messages,stream:true,stream_options:{include_usage:true}}
  for(const key of ['temperature','top_p','top_k','min_p','repeat_penalty'])if(body[key]!==undefined)payload[key]=body[key]
  if(body.max_output_tokens!==undefined)payload.max_tokens=body.max_output_tokens
  const start=Date.now(),upstream=await fetch(`${runtime.endpoint}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.backend.credential()}`},body:JSON.stringify(payload),signal})
  if(!upstream.ok){await upstream.body?.cancel();throw failure(upstream.status,'inference_error','The model rejected the chat request. Check its supported parameters and the runtime logs.')}
  if(!upstream.body)throw failure(502,'internal_error','The runtime returned no response body')
  const streaming=body.stream===true,output:{type:'message'|'reasoning';content:string}[]=[]
  let usage:Json={},timings:Json={},firstToken:number|undefined,outputBytes=0,complete=false,openBlock:'message'|'reasoning'|undefined
  if(streaming){response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','X-Accel-Buffering':'no'});response.flushHeaders();await this.event(response,'chat.start',{model_instance_id:runtime.modelName})}
  for await(const data of sseData(upstream.body)){
   signal.throwIfAborted()
   if(data==='[DONE]'){complete=true;break}
   const chunk=record(JSON.parse(data));if(chunk.error)throw failure(502,'inference_error','The runtime reported an error while generating')
   if(chunk.usage)usage=record(chunk.usage);if(chunk.timings)timings=record(chunk.timings)
   const choice=record(Array.isArray(chunk.choices)?chunk.choices[0]:undefined),delta=record(choice.delta)
   if(choice.finish_reason!==undefined&&choice.finish_reason!==null)complete=true
   for(const [field,type] of [['reasoning_content','reasoning'],['content','message']] as const){
    const value=delta[field];if(typeof value!=='string'||!value)continue
    firstToken??=Date.now();outputBytes+=Buffer.byteLength(value);if(outputBytes>1024*1024)throw failure(413,'invalid_request','Generated output exceeds the 1 MB response limit')
    if(openBlock!==type){if(streaming&&openBlock)await this.event(response,`${openBlock}.end`);openBlock=type;output.push({type,content:''});if(streaming)await this.event(response,`${type}.start`)}
    output[output.length-1].content+=value;if(streaming)await this.event(response,`${type}.delta`,{content:value})
   }
  }
  if(!complete)throw failure(502,'inference_error','The runtime stream ended before completing the response')
  if(streaming&&openBlock)await this.event(response,`${openBlock}.end`)
  const stats:Json={}
  const values:Json={input_tokens:usage.prompt_tokens,total_output_tokens:usage.completion_tokens,reasoning_output_tokens:record(usage.completion_tokens_details).reasoning_tokens,tokens_per_second:timings.predicted_per_second,time_to_first_token_seconds:firstToken===undefined?undefined:(firstToken-start)/1000}
  for(const [key,value] of Object.entries(values))if(typeof value==='number'&&Number.isFinite(value))stats[key]=value
  const assistant:Json={role:'assistant',content:output.filter(item=>item.type==='message').map(item=>item.content).join('')},reasoning=output.filter(item=>item.type==='reasoning').map(item=>item.content).join('')
  if(reasoning)assistant.reasoning_content=reasoning
  const result={model_instance_id:runtime.modelName,output,stats,...(body.store!==false?{response_id:this.remember(model.id,[...messages,assistant])}:{})}
  if(streaming){await this.event(response,'chat.end',{result});response.end()}else this.send(response,200,result)
 }
}
