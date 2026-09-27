import fs from 'node:fs'
import path from 'node:path'
import {createServer,type Server} from 'node:http'
import {AgentWorkspace} from './workspace.js'
import type {CapabilityRegistry} from './core/capability-registry.js'
import {readIntegrationJson,writeIntegrationJson} from '../integration-store.js'
export const previewCapabilityNames=new Set(['preview.start','preview.status','preview.stop'])
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.wasm':'application/wasm','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.woff2':'font/woff2'}
export class StaticPreview {
 private enabled=false
 constructor(private settingsFile?:string){if(settingsFile)this.enabled=readIntegrationJson(settingsFile,{enabled:false}).enabled===true}
 state(){return {enabled:this.enabled,running:this.servers.size}}
 async configure(enabled:boolean){if(typeof enabled!=='boolean')throw new Error('插件开关无效');if(this.settingsFile)writeIntegrationJson(this.settingsFile,{enabled});this.enabled=enabled;if(!enabled)await this.dispose();return this.state()}
 private servers=new Map<string,{server:Server;url:string}>()
 private starting=new Set<string>()
 register(registry:CapabilityRegistry){
  for(const operation of ['start','status','stop'] as const)registry.registerBuiltin({name:'preview.'+operation,category:'browser',description:operation==='start'?'启动当前工作目录的纯静态 HTTP 预览，无需 package.json、Python 或 shell。仅监听本机，默认自动分配空闲端口；浏览器使用返回的真实 URL，已启动则复用。':'查询或停止当前工作目录由应用启动的静态预览服务：'+operation,
   parameters:{type:'object',properties:operation==='start'?{port:{type:'integer',minimum:1024,maximum:65535}}:{},additionalProperties:false},source:{type:'builtin'},runtime:'builtin',permissions:['filesystem','network'],tags:operation==='status'?['risk:read']:['requires-approval','risk:high']},async(args,signal,workspace)=>{
    signal.throwIfAborted();if(!workspace)throw new Error('请先选择项目工作目录')
    const root=fs.realpathSync(workspace)
    if(operation==='start')return this.start(root,args.port as number|undefined,signal)
    if(operation==='stop'){await this.stop(root);return {status:'stopped'}}
    return this.servers.has(root)?{status:'running',url:this.servers.get(root)!.url}:{status:'stopped'}
   },()=>this.enabled)
 }
 async start(directory:string,port:number|undefined,signal:AbortSignal){
  signal.throwIfAborted()
  if(!this.enabled)throw new Error('静态网页预览插件未启用')
  const root=fs.realpathSync(directory),workspace=new AgentWorkspace(root)
  if(!fs.statSync(root).isDirectory())throw new Error('工作目录无效')
  if(port!==undefined&&(!Number.isInteger(port)||port<1024||port>65535))throw new Error('端口应为 1024–65535')
  const previous=this.servers.get(root);if(previous)return {status:'running',url:previous.url,reused:true}
  if(this.starting.has(root))throw new Error('该目录的预览服务正在启动')
  this.starting.add(root)
  const server=createServer((req,res)=>{
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store')
   const address=server.address(),actualPort=typeof address==='object'&&address?address.port:0
   if(![`127.0.0.1:${actualPort}`,`localhost:${actualPort}`].includes(req.headers.host||'')){res.writeHead(403);res.end();return}
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
   try{
    const pathname=decodeURIComponent(new URL(req.url||'/',`http://127.0.0.1:${actualPort}`).pathname)
    if(pathname.includes('\\')||pathname.includes('\0'))throw new Error('非法路径')
    const relative=pathname.replace(/^\//,'')||'index.html'
    let file=workspace.resolve(relative)
    if(fs.statSync(file).isDirectory())file=workspace.resolve(path.posix.join(relative,'index.html'))
    const stat=fs.statSync(file);if(!stat.isFile()||stat.size>64*1024*1024)throw new Error('文件不可预览')
    res.setHeader('Content-Type',mime[path.extname(file).toLowerCase()]||'application/octet-stream')
    if(req.method==='HEAD'){res.end();return}
    const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res)
   }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('文件不存在或不允许访问')}
  })
  try{
   await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port??0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve()})})
   signal.throwIfAborted()
   if(!this.enabled)throw new Error('静态网页预览插件已停用')
   const address=server.address();if(!address||typeof address==='string')throw new Error('未获得服务端口')
   const url=`http://127.0.0.1:${address.port}/`;this.servers.set(root,{server,url})
   return {status:'running',url,reused:false,note:'仅提供静态文件；应用退出时停止。使用返回 URL 打开页面。'}
  }catch(error){server.close();throw error}finally{this.starting.delete(root)}
 }
 async stop(root:string){const item=this.servers.get(root);if(!item)return;this.servers.delete(root);item.server.closeAllConnections();await new Promise<void>(resolve=>item.server.close(()=>resolve()))}
 async dispose(){this.enabled=false;await Promise.all([...this.servers.keys()].map(root=>this.stop(root)))}
}
