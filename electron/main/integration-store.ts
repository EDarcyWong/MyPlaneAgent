import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
export function readIntegrationJson<T>(file:string,fallback:T):T{
 try{if(fs.statSync(file).size>12_000_000)throw new Error('配置文件超过大小限制');return JSON.parse(fs.readFileSync(file,'utf8')) as T}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw new Error('配置文件无法读取，请先备份后修复：'+path.basename(file))}
}
export function writeIntegrationJson(file:string,value:unknown){
 const text=JSON.stringify(value,null,2);if(Buffer.byteLength(text)>12_000_000)throw new Error('配置总大小超过 12 MB')
 fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp'
 try{fs.writeFileSync(temp,text,{flag:'wx',mode:0o600});fs.renameSync(temp,file)}finally{try{fs.unlinkSync(temp)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')console.warn('临时配置清理失败')}}
}
