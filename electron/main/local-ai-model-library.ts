import {readdir,stat} from 'node:fs/promises'
import path from 'node:path'
import type {LocalAiDownloadEntry} from '../shared/local-ai.js'
import {stableId} from './local-ai-utils.js'

export const modelPathKey=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file)

// Read metadata only: model weights can be many gigabytes. Do not follow
// directory links, which may lead outside the configured library or form loops.
export async function scanModelDirectory(directory:string):Promise<LocalAiDownloadEntry[]>{
 const models:LocalAiDownloadEntry[]=[],pending=[path.resolve(directory)]
 while(pending.length){
  const folder=pending.pop()!
  let entries
  try{entries=await readdir(folder,{withFileTypes:true})}
  catch(cause){if((cause as NodeJS.ErrnoException).code==='ENOENT')continue;throw new Error(`无法读取模型目录 ${folder}：${String(cause)}`)}
  for(const entry of entries){
   const localPath=path.join(folder,entry.name)
   if(entry.isDirectory()){pending.push(localPath);continue}
   if(!/\.(gguf|safetensors|bin|pt|pth|onnx)$/i.test(entry.name))continue
   try{
    const info=await stat(localPath)
    if(info.isFile())models.push({id:stableId(localPath),repoId:'本地目录',file:entry.name,localPath,size:info.size,downloadedAt:info.mtime.toISOString()})
   }catch(cause){if((cause as NodeJS.ErrnoException).code!=='ENOENT')throw new Error(`无法读取模型文件 ${localPath}：${String(cause)}`)}
  }
 }
 return models.sort((a,b)=>a.localPath.localeCompare(b.localPath))
}

export function mergeScannedModels(existing:LocalAiDownloadEntry[],found:LocalAiDownloadEntry[]){
 const models=new Map(existing.map(item=>[modelPathKey(item.localPath),item]))
 for(const item of found){const key=modelPathKey(item.localPath),previous=models.get(key);models.set(key,previous?{...previous,size:item.size}:item)}
 return [...models.values()]
}
