import {net} from 'electron'
import path from 'node:path'
import {readIntegrationJson,writeIntegrationJson} from './integration-store.js'
import {record,stableId,textValue} from './local-ai-utils.js'

type CachedIcon={dataUrl:string;updatedAt:number}
const maxBytes=512*1024
const ttl=7*24*60*60*1000
const imageTypes=new Set(['image/png','image/jpeg','image/gif','image/webp','image/svg+xml','image/x-icon','image/vnd.microsoft.icon'])

export class LocalAiModelIcons {
 private readonly memory=new Map<string,CachedIcon>()
 private readonly pending=new Map<string,Promise<string>>()
 constructor(private directory:string){}

 private file(author:string){return path.join(this.directory,`${stableId(author)}.json`)}
 async get(author:string):Promise<string>{
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(author))return ''
  let cached=this.memory.get(author)
  if(!cached){
   try{
    const value=readIntegrationJson<CachedIcon|null>(this.file(author),null)
    if(value&&typeof value.dataUrl==='string'&&value.dataUrl.length<maxBytes*1.4&&/^data:image\/(?:png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/.test(value.dataUrl)&&Number.isFinite(value.updatedAt)){cached=value;this.memory.set(author,value)}
   }catch{/* Broken disposable icons must not affect model browsing. */}
  }
  if(cached){
   if(Date.now()-cached.updatedAt>ttl)void this.refresh(author)
   return cached.dataUrl
  }
  return this.refresh(author)
 }

 private refresh(author:string):Promise<string>{
  const pending=this.pending.get(author);if(pending)return pending
  const work=this.download(author).then(dataUrl=>{
   if(dataUrl){
    const item={dataUrl,updatedAt:Date.now()};this.memory.set(author,item)
    try{writeIntegrationJson(this.file(author),item)}catch{/* The in-memory icon remains available. */}
    if(this.memory.size>150)this.memory.delete(this.memory.keys().next().value!)
   }
   return dataUrl||this.memory.get(author)?.dataUrl||''
  }).catch(()=>this.memory.get(author)?.dataUrl||'').finally(()=>this.pending.delete(author))
  this.pending.set(author,work);return work
 }

 private async download(author:string){
  let avatar=''
  // These public profile endpoints require no token. Never forward a Hub token to an image CDN.
  for(const kind of ['organizations','users']){
   const response=await net.fetch(`https://huggingface.co/api/${kind}/${encodeURIComponent(author)}/overview`,{headers:{Accept:'application/json'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)})
   if(!response.ok){await response.body?.cancel();continue}
   avatar=textValue(record(await response.json()).avatarUrl,2000)
   if(avatar)break
  }
  if(!avatar)return ''
  const url=new URL(avatar,'https://huggingface.co')
  if(url.protocol!=='https:'||url.username||url.password||!['huggingface.co','cdn-avatars.huggingface.co'].includes(url.hostname))return ''
  const response=await net.fetch(url.href,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)})
  const mime=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()||''
  if(!response.ok||!imageTypes.has(mime)||Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();return ''}
  if(!response.body)return ''
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0
  try{
   while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>maxBytes)return '';chunks.push(part.value)}
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  // SVG stays an isolated image source; it is never inserted into the document as markup.
  return length?`data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`:''
 }
}
