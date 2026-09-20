import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {Client,StreamableHTTPClientTransport,type Tool,type Transport} from '@modelcontextprotocol/client'
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio'
import {readIntegrationJson,writeIntegrationJson} from '../integration-store.js'
import type {McpServerInput,McpServerView} from '../../shared/local-ai-mcp.js'
import {ToolRegistry,ToolError,fingerprint,type ToolSpec} from './registry.js'
import {stopProcessTree} from './processes.js'
import {bounded} from './workspace.js'
type Saved=Omit<McpServerInput,'env'|'token'>&{id:string;secret?:string;approvedSchemas?:Record<string,string>}
type Live={revision:string;client:Client;transport:Transport;tools:Tool[];status:McpServerView['status'];error?:string;identity?:string;controller:AbortController}
export class AgentMcpManager {
 private running=new Map<string,Live>()
 private connecting=new Set<string>()
 constructor(private file:string,private project:(id:string)=>{workspace:string},private encrypt:(value:string)=>string,private decrypt:(value:string)=>string){}
 private saved(){return readIntegrationJson<Saved[]>(this.file,[])}
 private config(id:string){const item=this.saved().find(item=>item.id===id);if(!item)throw new Error('MCP 服务不存在');return item}
 private view(item:Saved):McpServerView{const live=this.running.get(item.id);let secret:{env?:Record<string,string>;token?:string}={},credentialError='';try{secret=item.secret?JSON.parse(this.decrypt(item.secret)):{}}catch{credentialError='系统凭据暂不可用，请解锁安全存储或重新配置连接。'}return {...item,secret:undefined,approvedSchemas:undefined,envKeys:Object.keys(secret.env||{}),hasToken:!!secret.token,status:live?.status||'disconnected',error:live?.error||credentialError||undefined,identity:live?.identity,tools:(live?.tools||[]).map(tool=>({name:tool.name,description:(tool.description||'').slice(0,1000),enabled:!!item.enabledTools?.includes(tool.name)&&item.approvedSchemas?.[tool.name]===fingerprint(tool)}))} as McpServerView}
 list(){return this.saved().map(item=>this.view(item))}
 save(input:McpServerInput){
  this.project(input.projectId);const all=this.saved(),old=input.id?this.config(input.id):undefined
  if(old&&this.running.get(old.id)?.status==='connecting')throw new Error('连接中，请稍后再修改')
  const id=old?.id||randomUUID(),name=bounded(input.name,'服务名称',80)
  if(!['stdio','http'].includes(input.transport))throw new Error('传输类型无效')
  let command:string|undefined,url:string|undefined
  if(input.transport==='stdio'){command=bounded(input.command,'可执行文件',2000);if(!path.isAbsolute(command)||!fs.statSync(command).isFile())throw new Error('请选择已安装程序的绝对路径');if(!Array.isArray(input.args)||input.args.length>50||input.args.some(arg=>typeof arg!=='string'||arg.length>4000))throw new Error('参数必须是字符串数组')}
  else{const parsed=new URL(bounded(input.url,'服务地址',2000));if(parsed.username||parsed.password||parsed.hash||parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)))throw new Error('远程 MCP 需要 HTTPS；仅本机地址允许 HTTP');url=parsed.toString()}
  const secret=old?.secret?JSON.parse(this.decrypt(old.secret)):{}
  if(input.env!==undefined){if(!input.env||Array.isArray(input.env)||Object.keys(input.env).length>30||Object.entries(input.env).some(([key,value])=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||typeof value!=='string'||value.length>8000))throw new Error('环境变量格式无效');secret.env=input.env}
  if(input.token!==undefined){if(typeof input.token!=='string'||input.token.length>8000)throw new Error('Token 无效');secret.token=input.token}
  const changed=!!old&&(old.projectId!==input.projectId||old.transport!==input.transport||old.command!==command||old.url!==url||JSON.stringify(old.args)!==JSON.stringify(input.args)||old.protocol!==(input.protocol||'legacy')||input.env!==undefined||input.token!==undefined)
  if(changed&&this.running.get(id)?.status==='connected')throw new Error('请先断开服务，再修改连接或凭据')
  const live=this.running.get(id),enabledTools=input.enabledTools||[],schemas:Record<string,string>={}
  if(!Array.isArray(enabledTools)||enabledTools.length>20||enabledTools.some(name=>typeof name!=='string'))throw new Error('最多启用 20 个工具')
  for(const name of enabledTools){const tool=live?.status==='connected'?live.tools.find(tool=>tool.name===name):undefined;if(!tool)throw new Error('请先连接服务，再选择工具');new ToolRegistry([{definition:{type:'function',function:{name:'validate_schema',description:'',parameters:tool.inputSchema as Record<string,unknown>}},source:'mcp',risk:'high',timeoutMs:60000}]);schemas[name]=fingerprint(tool)}
  const next:Saved={id,name,projectId:input.projectId,transport:input.transport,command,url,args:input.args||[],protocol:input.protocol==='modern'?'modern':'legacy',enabledTools:changed?[]:enabledTools,approvedSchemas:changed?{}:schemas,...(Object.keys(secret).length?{secret:this.encrypt(JSON.stringify(secret))}:{})}
  writeIntegrationJson(this.file,[...all.filter(item=>item.id!==id),next]);return this.view(next)
 }
 async connect(id:string){
  if(this.connecting.has(id))throw new Error('服务正在连接');this.connecting.add(id)
  try{return await this.connectOnce(id)}finally{this.connecting.delete(id)}
 }
 private async connectOnce(id:string){
  if(this.running.get(id)?.status==='connecting')throw new Error('服务正在连接')
  await this.disconnect(id);const config=this.config(id),project=this.project(config.projectId),secret=config.secret?JSON.parse(this.decrypt(config.secret)):{}
  const client=new Client({name:'MyPlane',version:'0.2.3'},{capabilities:{},versionNegotiation:{mode:config.protocol==='modern'?{pin:'2026-07-28'}:'legacy'},inputRequired:{autoFulfill:false}})
  const transport:Transport=config.transport==='stdio'?new StdioClientTransport({command:config.command!,args:config.args,env:secret.env||{},cwd:project.workspace,stderr:'pipe',maxBufferSize:1000000}):new StreamableHTTPClientTransport(new URL(config.url!),{requestInit:{redirect:'error',...(secret.token?{headers:{Authorization:'Bearer '+secret.token}}:{})},reconnectionOptions:{maxRetries:0,maxReconnectionDelay:1000,initialReconnectionDelay:1000,reconnectionDelayGrowFactor:1},fetch:async(url,init)=>{
   if(new URL(String(url)).origin!==new URL(config.url!).origin)throw new Error('禁止跨域 MCP 请求')
   const response=await fetch(url,{...init,redirect:'error'});if(Number(response.headers.get('content-length'))>1000000)throw new Error('MCP 响应过大');if(!response.body)return response;const reader=response.body.getReader();let size=0;return new Response(new ReadableStream({async pull(controller){try{const chunk=await reader.read();if(chunk.done){controller.close();return}size+=chunk.value.length;if(size>1000000){await reader.cancel();controller.error(new Error('MCP 响应过大'));return}controller.enqueue(chunk.value)}catch(error){controller.error(error)}},cancel:reason=>reader.cancel(reason)}),{status:response.status,statusText:response.statusText,headers:response.headers})
  }})
  if(transport instanceof StdioClientTransport)transport.stderr?.on('data',()=>{/* Drain without storing credentials in stderr. */})
  const live:Live={revision:randomUUID(),client,transport,tools:[],status:'connecting',controller:new AbortController()};this.running.set(id,live)
  client.onclose=()=>{if(this.running.get(id)===live){live.status='disconnected';live.tools=[]}}
  client.onerror=()=>{live.error='MCP 连接异常，请检查服务后手动重连；不会自动重放调用'}
  client.setNotificationHandler('notifications/tools/list_changed',()=>{live.tools=[];live.error='工具列表发生变化，请断开并重连后重新核对工具权限'})
  const deadline=setTimeout(()=>live.controller.abort(new Error('MCP 连接超时')),20000)
  try{
   await client.connect(transport,{timeout:15000,signal:live.controller.signal});if(live.controller.signal.aborted)throw new Error('连接已取消')
   const result=await client.listTools({}, {timeout:15000,signal:live.controller.signal,cacheMode:'bypass'})
   if(result.tools.length>100||JSON.stringify(result.tools).length>200000)throw new Error('服务工具列表过大，请缩小服务范围')
   live.tools=result.tools;live.identity=JSON.stringify(client.getServerVersion());live.status='connected'
   new ToolRegistry(this.specs(config.projectId));return this.view(config)
  }catch(error){if(transport instanceof StdioClientTransport&&transport.pid)await stopProcessTree(transport.pid);await client.close().catch(()=>{});live.status='error';live.error='连接或工具发现失败，请检查程序、地址、协议版本或凭据。';throw new Error(live.error)}finally{clearTimeout(deadline)}
 }
 specs(projectId:string):ToolSpec[]{return this.saved().filter(config=>config.projectId===projectId).flatMap(config=>{
  const live=this.running.get(config.id);if(live?.status!=='connected')return []
  return live.tools.filter(tool=>config.enabledTools?.includes(tool.name)&&config.approvedSchemas?.[tool.name]===fingerprint(tool)).map(tool=>({definition:{type:'function' as const,function:{name:'mcp_'+config.id.replace(/-/g,'').slice(0,12)+'_'+fingerprint(tool.name).slice(0,12),description:(config.name+': '+tool.name+' — '+(tool.description||'')).slice(0,1500),parameters:tool.inputSchema as Record<string,unknown>}},revision:live.revision,destination:config.transport==='http'?config.url:config.command,source:'mcp:'+config.id,risk:'high' as const,timeoutMs:60000,execute:async(args:Record<string,unknown>,signal:AbortSignal)=>{
   const current=this.config(config.id);if(live.status!=='connected'||!current.enabledTools?.includes(tool.name)||current.approvedSchemas?.[tool.name]!==fingerprint(tool)||!live.tools.some(item=>fingerprint(item)===fingerprint(tool)))throw new ToolError('MCP_CHANGED','服务或工具权限已变化，请重新连接并核对')
   try{const latest=await live.client.listTools({}, {signal,timeout:10000,cacheMode:'bypass'});if(!latest.tools.some(current=>fingerprint(current)===fingerprint(tool)))throw new ToolError('MCP_CHANGED','服务工具定义发生变化，请重新发现并核对权限');const result=await live.client.callTool({name:tool.name,arguments:args},{signal,timeout:60000});const text=JSON.stringify({isError:result.isError,content:result.content.map(item=>item.type==='text'?{type:'text',text:item.text}:{type:item.type,note:'非文本结果未自动下载或执行'}),structuredContent:result.structuredContent});if(result.isError)throw new ToolError('MCP_TOOL_ERROR',text.slice(0,1000),{result:JSON.parse(text)});return text}catch(error){if(error instanceof ToolError)throw error;await this.disconnect(config.id);throw new ToolError('RESULT_UNKNOWN','MCP 调用中断或超时，结果可能未知；请核对外部状态，不会自动重放')}
  }}))
 })}
 async disconnect(id:string){const live=this.running.get(id);if(!live)return;live.controller.abort();this.running.delete(id);if(live.transport instanceof StdioClientTransport&&live.transport.pid)await stopProcessTree(live.transport.pid);await live.client.close().catch(()=>{})}
 async remove(id:string){await this.disconnect(id);writeIntegrationJson(this.file,this.saved().filter(item=>item.id!==id))}
 async dispose(){await Promise.all([...this.running.keys()].map(id=>this.disconnect(id)))}
}
