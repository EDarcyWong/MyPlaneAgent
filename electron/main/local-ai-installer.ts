import {app,net} from 'electron'
import {createWriteStream,lstatSync,mkdirSync,mkdtempSync,readdirSync,renameSync,rmSync,unlinkSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {Readable,Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {inside,jsonResponse,record,textValue} from './local-ai-utils.js'
import {readIntegrationJson,writeIntegrationJson} from './integration-store.js'
import type {RuntimeCandidate,RuntimeInstallation,RuntimePackage} from '../shared/local-ai-developer.js'

import {extractRuntimeArchive,maxRuntimeArchive as maxArchive,runtimeExecutableName,runtimePackageFlavor,validRuntimeExecutable} from './local-ai-runtime-package.js'
const releaseApi='https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=12'
type PackageEntry=RuntimePackage&{url:string}
export class LocalAiInstaller {
 private offers=new Map<string,PackageEntry>()
 private offersAt=0
 private controller:AbortController|undefined
 private state:RuntimeInstallation={status:'idle',name:'',received:0,total:0,path:'',error:'',verified:false}
 constructor(private root:string,private installed:(runtimePath:string)=>void){}
 snapshot(){return {...this.state}}
 valid(file:string){return validRuntimeExecutable(file)}
 detect(configured:string):RuntimeCandidate[]{
  const rows:RuntimeCandidate[]=[],seen=new Set<string>(),name=runtimeExecutableName()
  const add=(file:string,source:string)=>{const id=process.platform==='win32'?file.toLowerCase():file;if(!seen.has(id)&&this.valid(file)){seen.add(id);rows.push({path:file,source})}}
  add(configured,'当前配置');add(process.env.LLAMA_SERVER||'','LLAMA_SERVER 环境变量')
  try{const saved=readIntegrationJson<{path?:string}>(path.join(this.root,'installed.json'),{});if(saved.path)add(saved.path,'MyPlane 安装')}catch{}
  for(const folder of (process.env.PATH||process.env.Path||'').split(path.delimiter).slice(0,100)){const dir=folder.replace(/^"|"$/g,'');if(path.isAbsolute(dir))add(path.join(dir,name),'PATH')}
  const home=os.homedir(),local=process.env.LOCALAPPDATA||'',programs=process.env.ProgramFiles||''
  const folders=[path.join(home,'scoop','apps','llama.cpp','current'),path.join(home,'.local','bin'),path.join(home,'.llama.cpp','bin'),path.join(process.resourcesPath,'llama.cpp'),...(local?[path.join(local,'Programs','llama.cpp'),path.join(local,'Microsoft','WinGet','Links')]:[]),...(programs?[path.join(programs,'llama.cpp')]:[]),'/opt/homebrew/bin','/usr/local/bin']
  for(const dir of folders){add(path.join(dir,name),'常用安装目录');add(path.join(dir,'bin',name),'常用安装目录')}
  // Only inspect a bounded number of llama-named folders, never scan the whole disk.
  for(const root of [this.root,app.getPath('downloads')]){
   try{for(const entry of readdirSync(root,{withFileTypes:true}).filter(item=>item.isDirectory()&&!item.isSymbolicLink()&&/llama|release-/i.test(item.name)).slice(0,20)){
    const dir=path.join(root,entry.name);add(path.join(dir,name),'运行包目录');add(path.join(dir,'bin',name),'运行包目录')
    for(const child of readdirSync(dir,{withFileTypes:true}).filter(item=>item.isDirectory()&&!item.isSymbolicLink()).slice(0,8)){add(path.join(dir,child.name,name),'运行包目录');add(path.join(dir,child.name,'bin',name),'运行包目录')}
   }}catch{}
  }
  return rows
 }
 async packages():Promise<RuntimePackage[]>{
  if(!['win32','darwin'].includes(process.platform)||!['x64','arm64'].includes(process.arch))throw new Error('自动安装支持 Windows 和 macOS（Intel / Apple Silicon）；其他系统请使用自动查找或手动选择官方运行文件')
  if(this.offers.size&&Date.now()-this.offersAt<300000)return [...this.offers.values()].map(({url,...item})=>item)
  const data=await jsonResponse(await net.fetch(releaseApi,{headers:{Accept:'application/vnd.github+json','User-Agent':'MyPlane'},signal:AbortSignal.timeout(20000)}))
  if(!Array.isArray(data))throw new Error('无法读取官方运行包列表')
  const offers:PackageEntry[]=[]
  for(const value of data){
   const release=record(value);if(release.draft||!Array.isArray(release.assets))continue
   for(const raw of release.assets){
    const item=record(raw),name=textValue(item.name),flavor=runtimePackageFlavor(name,process.platform,process.arch),size=Number(item.size),url=textValue(item.browser_download_url,2000)
    if(!flavor||!Number.isFinite(size)||size<=0||size>maxArchive)continue
    const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='github.com'||!parsed.pathname.startsWith('/ggml-org/llama.cpp/releases/download/'))continue
    offers.push({id:String(item.id),version:textValue(release.tag_name),name,size,url,flavor,sha256:textValue(item.digest).match(/^sha256:([a-f\d]{64})$/i)?.[1]?.toLowerCase()||''})
   }
   if(offers.length)break
  }
  if(!offers.length)throw new Error('最近的官方发布中未找到适合本机系统和架构的二进制运行包，请打开官方发布页手动下载；不要选择 Source code')
  this.offers=new Map(offers.map(item=>[item.id,item]));this.offersAt=Date.now()
  return offers.map(({url,...item})=>item)
 }
 install(id:string){
  if(this.controller)throw new Error('运行包正在安装，请等待完成或取消')
  const item=this.offers.get(id);if(!item)throw new Error('请先刷新官方运行包列表，再选择安装')
  const controller=new AbortController();this.controller=controller
  this.state={status:'downloading',name:item.name,received:0,total:item.size,path:'',error:'',verified:false}
  void this.download(item,controller.signal).catch(error=>{this.state.status=controller.signal.aborted?'cancelled':'error';this.state.error=controller.signal.aborted?'已取消运行包安装':String(error)}).finally(()=>{this.controller=undefined})
  return this.snapshot()
 }
 cancel(){this.controller?.abort();return this.snapshot()}
 private async download(item:PackageEntry,signal:AbortSignal){
  mkdirSync(this.root,{recursive:true});let work:string|undefined=mkdtempSync(path.join(this.root,'install-'))
  try{
   const archive=path.join(work,item.flavor==='metal'?'runtime.tar.gz':'runtime.zip'),hash=createHash('sha256')
   const response=await net.fetch(item.url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15*60*1000)])})
   if(!response.ok||!response.body)throw new Error(`运行包下载失败：HTTP ${response.status}`)
   const meter=new Transform({transform:(chunk:Buffer,_encoding,done)=>{this.state.received+=chunk.length;if(this.state.received>maxArchive||this.state.received>item.size){done(new Error('下载体积超过官方声明大小'));return}hash.update(chunk);done(null,chunk)}})
   await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),meter,createWriteStream(archive,{flags:'wx'}),{signal})
   if(this.state.received!==item.size)throw new Error('运行包下载不完整，请重试')
   const digest=hash.digest('hex');if(item.sha256&&digest!==item.sha256)throw new Error('运行包 SHA-256 校验失败，未解压或启用')
   this.state.verified=!!item.sha256;this.state.status='extracting';signal.throwIfAborted()
   const contents=path.join(work,'contents')
   const binary=path.join('contents',await extractRuntimeArchive(archive,contents,process.platform,signal))
   signal.throwIfAborted();unlinkSync(archive)
   const destination=inside(this.root,`release-${item.version.replace(/[^a-z\d._-]/gi,'_')}-${item.flavor}-${randomUUID().slice(0,8)}`)
   renameSync(work,destination);work=undefined
   const runtimePath=inside(destination,binary)
   writeIntegrationJson(path.join(this.root,'installed.json'),{path:runtimePath,version:item.version,name:item.name,sha256:digest,verified:!!item.sha256})
   this.state.path=runtimePath;this.state.status='ready'
   try{this.installed(runtimePath)}catch(error){this.state.error=`运行包已安装，但配置尚未切换：${String(error)}`}
  }finally{
   if(work){const relative=path.relative(path.resolve(this.root),path.resolve(work));if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&!lstatSync(work).isSymbolicLink())rmSync(work,{recursive:true,force:true})}
  }
 }
 dispose(){this.controller?.abort()}
}
