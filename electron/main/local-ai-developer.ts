import {safeStorage,type WebContents} from 'electron'
import path from 'node:path'
import os from 'node:os'
import {readIntegrationJson,writeIntegrationJson} from './integration-store.js'
import {numeric,record,textValue} from './local-ai-utils.js'
import {developerRoutes,type DeveloperPreferences,type DeveloperPreferencesInput,type DeveloperResponse,type DeveloperRoute} from '../shared/local-ai-developer.js'

type Stored=Partial<DeveloperPreferences>&{encryptedApiKey?:string}
export class LocalAiDeveloper {
 private stored:Stored
 private readonly file:string
 private requests=new Map<number,AbortController>()
 private logs:string[]=[]
 constructor(root:string){this.file=path.join(root,'local-ai-developer-settings.json');this.stored=readIntegrationJson<Stored>(this.file,{})}
 preferences():DeveloperPreferences{return {host:this.stored.host==='0.0.0.0'?'0.0.0.0':'127.0.0.1',parallel:Math.round(numeric(this.stored.parallel,1,16,1)),embedding:this.stored.embedding===true,metrics:this.stored.metrics!==false,hasApiKey:!!this.stored.encryptedApiKey}}
 save(input:unknown){
  const value=record(input) as DeveloperPreferencesInput,next={...this.stored}
  if(value.host!==undefined){if(!['127.0.0.1','0.0.0.0'].includes(value.host))throw new Error('无效的监听地址');next.host=value.host}
  if(value.parallel!==undefined)next.parallel=Math.round(numeric(value.parallel,1,16,1))
  if(value.embedding!==undefined)next.embedding=value.embedding===true
  if(value.metrics!==undefined)next.metrics=value.metrics===true
  if(value.clearApiKey)delete next.encryptedApiKey
  if(value.apiKey){const key=textValue(value.apiKey,512).trim();if(key.length<16||/[\s,]/.test(key))throw new Error('服务 API Key 至少 16 位，不能包含空白或逗号');if(!safeStorage.isEncryptionAvailable())throw new Error('操作系统安全存储不可用，无法保存服务密钥');next.encryptedApiKey=safeStorage.encryptString(key).toString('base64')}
  writeIntegrationJson(this.file,next);this.stored=next;return this.preferences()
 }
 credential(){if(!this.stored.encryptedApiKey)return '';if(!safeStorage.isEncryptionAvailable())throw new Error('操作系统安全存储不可用，请重新设置服务密钥');return safeStorage.decryptString(Buffer.from(this.stored.encryptedApiKey,'base64'))}
 addresses(){return Object.values(os.networkInterfaces()).flatMap(values=>(values||[]).filter(item=>item.family==='IPv4'&&!item.internal).map(item=>item.address))}
 requestLogs(){return [...this.logs]}
 clearLogs(){this.logs=[]}
 cancel(owner:number){this.requests.get(owner)?.abort()}
 async request(input:unknown,service:{endpoint:string;key:string},sender:WebContents):Promise<DeveloperResponse>{
  const value=record(input),route=textValue(value.route) as DeveloperRoute
  if(!Object.prototype.hasOwnProperty.call(developerRoutes,route))throw new Error('不支持的调试接口')
  if(this.requests.has(sender.id))throw new Error('已有 API 请求正在执行')
  const definition=developerRoutes[route],root=service.endpoint.replace(/\/v1\/?$/,''),jobId=textValue(value.jobId,100)
  if(route==='lmDownloadStatus'&&!/^job_[a-f\d-]{36}$/i.test(jobId))throw new Error('请填写下载接口返回的 job_id')
  const routePath=definition.path.replace(':job_id',encodeURIComponent(jobId)),url=routePath.startsWith('/v1/')?`${service.endpoint.replace(/\/$/,'')}${routePath.slice(3)}`:`${root}${routePath}`
  let body:Record<string,unknown>|undefined
  if(definition.method==='POST'){
   const raw=textValue(value.body,40001);if(raw.length>40000)throw new Error('请求 JSON 超过 40 KB')
   const parsed=JSON.parse(raw||'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('请求体必须是 JSON 对象')
   body=parsed
  }
  const controller=new AbortController(),destroyed=()=>controller.abort(),start=Date.now();this.requests.set(sender.id,controller);sender.once('destroyed',destroyed)
  let status=0
  try{
   const anthropic=route==='messages'||route==='countTokens'
   const response=await fetch(url,{method:definition.method,headers:{'Content-Type':'application/json',...(anthropic?{'anthropic-version':'2023-06-01',...(service.key?{'x-api-key':service.key}:{})}:service.key?{Authorization:`Bearer ${service.key}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(route==='lmLoad'||route==='lmChat'?310000:90000)])})
   status=response.status;let content='',truncated=false
   if(response.body){const reader=response.body.getReader(),decoder=new TextDecoder();try{while(true){const part=await reader.read();content+=decoder.decode(part.value,{stream:!part.done});if(content.length>120000){content=content.slice(0,120000);truncated=true;break}if(part.done)break}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}}
   if(service.key)content=content.replaceAll(service.key,'[REDACTED]')
   return {status,elapsedMs:Date.now()-start,body:content,contentType:response.headers.get('content-type')||'',truncated}
  }finally{
   sender.removeListener('destroyed',destroyed);this.requests.delete(sender.id)
   this.logs.push(`${new Date().toLocaleTimeString()} [API] ${definition.method} ${definition.path} ${status||'网络失败/取消'} ${Date.now()-start}ms`);this.logs=this.logs.slice(-100)
  }
 }
 dispose(){for(const request of this.requests.values())request.abort()}
}
