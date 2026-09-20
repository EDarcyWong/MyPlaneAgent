import {createReadStream,createWriteStream,existsSync,mkdirSync,renameSync,statSync,unlinkSync} from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {Readable,Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {readIntegrationJson,writeIntegrationJson} from './integration-store.js'
import {inside,modelFile,repoId} from './local-ai-utils.js'
import type {StudioDownload,StudioModelFile} from '../shared/local-ai-studio.js'
import type {LocalAiDownloadEntry} from '../shared/local-ai.js'

export class LocalAiDownloads {
 private rows:StudioDownload[]
 private active:{id:string;controller:AbortController}|undefined
 private disposed=false
 constructor(private file:string,private directory:()=>string,private headers:()=>Record<string,string>,private completed:(entry:LocalAiDownloadEntry)=>void,private request:(url:string,options:RequestInit)=>Promise<Response>=fetch){
  this.rows=readIntegrationJson<StudioDownload[]>(file,[])
  if(!Array.isArray(this.rows))throw new Error('下载队列数据格式错误')
  for(const row of this.rows){if(['downloading','verifying','queued'].includes(row.status)){row.status='paused';row.error='上次下载已中断，可继续下载'}row.speed=0}
 }
 list(){return this.rows.map(row=>({...row}))}
 private persist(){writeIntegrationJson(this.file,this.rows)}
 enqueue(repo:string,files:StudioModelFile[]){
  const safeRepo=repoId(repo),directory=this.directory()
  for(const file of files){
   const name=modelFile(file.file)
   if(this.rows.some(row=>row.repoId===safeRepo&&row.file===name&&!['cancelled','failed','completed'].includes(row.status)))continue
   if(!file.revision||!/^[a-f\d]{40,64}$/i.test(file.revision))throw new Error('无法确定模型版本，请重新获取文件列表')
   const id=randomUUID(),folder=inside(directory,`${safeRepo.replaceAll('/','--')}--${file.revision.slice(0,12)}`),target=inside(folder,name)
   if(existsSync(target))continue
   this.rows.push({id,repoId:safeRepo,file:name,revision:file.revision,sha256:file.sha256,target,status:'queued',received:0,total:file.size||0,speed:0,error:'',createdAt:new Date().toISOString()})
  }
  this.persist();this.pump();return this.list()
 }
 action(id:string,action:string){
  const row=this.rows.find(item=>item.id===id);if(!row)throw new Error('下载任务不存在')
  if(action==='pause'){
   if(!['queued','downloading'].includes(row.status))throw new Error('当前任务不能暂停')
   row.status='paused';row.speed=0;if(this.active?.id===id)this.active.controller.abort()
  }else if(action==='resume'){
   if(!['paused','failed'].includes(row.status))throw new Error('当前任务不能继续')
   row.status='queued';row.error=''
  }else if(action==='cancel'){
   if(row.status==='completed')throw new Error('已完成的模型请在我的模型中管理')
   row.status='cancelled';row.speed=0
   if(this.active?.id===id)this.active.controller.abort();else this.removePartial(row)
  }else if(action==='remove'){
   if(this.active?.id===id||!['completed','cancelled','failed'].includes(row.status))throw new Error('请先取消该下载任务')
   this.removePartial(row);this.rows=this.rows.filter(item=>item.id!==id)
  }else throw new Error('无效的下载操作')
  this.persist();this.pump();return this.list()
 }
 private partial(row:StudioDownload){return `${row.target}.${row.id}.part`}
 private removePartial(row:StudioDownload){const file=this.partial(row);if(existsSync(file))unlinkSync(file)}
 private pump(){
  if(this.active||this.disposed)return
  const row=this.rows.find(item=>item.status==='queued');if(!row)return
  const controller=new AbortController();this.active={id:row.id,controller}
  void this.run(row,controller.signal).catch(error=>{if(!['paused','cancelled','queued'].includes(row.status)){row.status='failed';row.error=String(error)}row.speed=0}).finally(()=>{if(row.status==='cancelled'){try{this.removePartial(row)}catch(error){row.error=String(error)}}this.active=undefined;try{this.persist()}catch(error){row.status='failed';row.error=String(error)}this.pump()})
 }
 private async run(row:StudioDownload,signal:AbortSignal){
  row.status='downloading';row.error='';mkdirSync(path.dirname(row.target),{recursive:true})
  const partial=this.partial(row);let offset=existsSync(partial)?statSync(partial).size:0
  if(row.total>0&&offset>row.total)offset=0
  row.received=offset
  if(!(row.total>0&&offset===row.total)){
  const url=`https://huggingface.co/${row.repoId.split('/').map(encodeURIComponent).join('/')}/resolve/${row.revision}/${row.file.split('/').map(encodeURIComponent).join('/')}`
  const headers={...this.headers(),...(offset?{Range:`bytes=${offset}-`,...(row.etag?{'If-Range':row.etag}:{})}:{})}
  const response=await this.request(url,{headers,signal:AbortSignal.any([signal,AbortSignal.timeout(24*60*60*1000)])})
  if(!response.ok)throw new Error(response.status===401||response.status===403?'模型需要访问权限，请在设置中填写 Hugging Face Token，并在模型主页接受许可':`下载失败：HTTP ${response.status}`)
  if(!response.body)throw new Error('下载响应为空')
  const range=response.headers.get('content-range')
  if(response.status===206){if(!range?.startsWith(`bytes ${offset}-`)){await response.body.cancel();throw new Error('断点位置不一致，请取消任务后重新下载')}}else offset=0
  row.etag=response.headers.get('etag')||undefined;row.received=offset
  const size=Number(response.headers.get('content-length'))
  if(size>0)row.total=offset+size
  let lastTime=Date.now(),lastBytes=offset,lastPersist=Date.now()
  const meter=new Transform({transform:(chunk:Buffer,_encoding,callback)=>{row.received+=chunk.length;const time=Date.now();if(time-lastTime>=500){row.speed=(row.received-lastBytes)*1000/(time-lastTime);lastTime=time;lastBytes=row.received}if(time-lastPersist>4000){lastPersist=time;try{this.persist()}catch(error){callback(error as Error);return}}callback(null,chunk)}})
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),meter,createWriteStream(partial,{flags:offset?'a':'w'}),{signal})
  }
  signal.throwIfAborted()
  if(row.total&&row.received!==row.total)throw new Error('文件大小不完整，可继续下载')
  row.status='verifying';row.speed=0
  if(row.sha256){const hash=createHash('sha256');for await(const chunk of createReadStream(partial)){signal.throwIfAborted();hash.update(chunk)}if(hash.digest('hex')!==row.sha256){unlinkSync(partial);row.received=0;throw new Error('SHA-256 校验失败，请重试下载')}}
  signal.throwIfAborted()
  if(existsSync(row.target))throw new Error('目标文件已存在，为保护现有文件，下载未覆盖它')
  renameSync(partial,row.target)
  try{this.completed({id:row.id,repoId:row.repoId,file:row.file,localPath:row.target,size:statSync(row.target).size,downloadedAt:new Date().toISOString()})}catch(error){renameSync(row.target,partial);throw error}
  row.status='completed';row.total=row.received
 }
 dispose(){this.disposed=true;if(this.active){const row=this.rows.find(item=>item.id===this.active?.id);if(row){row.status='paused';row.speed=0}this.active.controller.abort()}this.persist()}
}
