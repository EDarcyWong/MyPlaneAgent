import fs from 'node:fs'
import path from 'node:path'
import type {ApplicationLogEntry,ApplicationLogLevel} from '../shared/application-log.js'

type LoggerOptions={maxBytes?:number;maxFiles?:number}

export class ApplicationLogger{
 readonly directory:string
 readonly filePath:string
 private readonly maxBytes:number
 private readonly maxFiles:number

 constructor(dataDirectory:string,options:LoggerOptions={}){
  this.directory=path.join(dataDirectory,'logs')
  this.filePath=path.join(this.directory,'myplane-agent.log')
  this.maxBytes=Math.max(1024,options.maxBytes??2*1024*1024)
  this.maxFiles=Math.max(1,Math.min(20,options.maxFiles??5))
  fs.mkdirSync(this.directory,{recursive:true,mode:0o700})
  this.rotateIfNeeded(0)
 }

 debug(scope:string,message:string,details?:unknown){this.write('DEBUG',scope,message,details)}
 info(scope:string,message:string,details?:unknown){this.write('INFO',scope,message,details)}
 warn(scope:string,message:string,details?:unknown){this.write('WARN',scope,message,details)}
 error(scope:string,message:string,details?:unknown){this.write('ERROR',scope,message,details)}

 entries(limit=1000):ApplicationLogEntry[]{
  const lines:string[]=[]
  for(let index=this.maxFiles;index>=1;index--)this.readLines(`${this.filePath}.${index}`,lines)
  this.readLines(this.filePath,lines)
  return lines.slice(-Math.max(1,Math.min(5000,limit))).flatMap(parseEntry)
 }

 clear(){
  for(let index=0;index<=this.maxFiles;index++)try{fs.rmSync(index?`${this.filePath}.${index}`:this.filePath,{force:true})}catch{}
 }

 private write(level:ApplicationLogLevel,scope:string,message:string,details?:unknown){
  const suffix=details===undefined?'':` ${serialize(details)}`
  const line=`${new Date().toISOString()} [${level}] [${clean(scope,80)}] ${clean(message,4000)}${suffix}\n`
  try{
   this.rotateIfNeeded(Buffer.byteLength(line))
   fs.appendFileSync(this.filePath,line,{encoding:'utf8',mode:0o600})
  }catch{/* Logging must never prevent the application from running. */}
 }

 private rotateIfNeeded(incomingBytes:number){
  let size=0
  try{size=fs.statSync(this.filePath).size}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  if(!size||size+incomingBytes<=this.maxBytes)return
  try{fs.rmSync(`${this.filePath}.${this.maxFiles}`,{force:true})}catch{}
  for(let index=this.maxFiles-1;index>=1;index--){
   const source=`${this.filePath}.${index}`,target=`${this.filePath}.${index+1}`
   try{fs.renameSync(source,target)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  }
  fs.renameSync(this.filePath,`${this.filePath}.1`)
 }

 private readLines(file:string,target:string[]){
  try{target.push(...fs.readFileSync(file,'utf8').split('\n').filter(Boolean))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 }
}

function parseEntry(line:string):ApplicationLogEntry[]{
 const match=/^(\S+) \[(DEBUG|INFO|WARN|ERROR)\] \[([^\]]+)\] (.*)$/.exec(line)
 return match?[{timestamp:match[1],level:match[2] as ApplicationLogLevel,scope:match[3],message:match[4].replaceAll('\\n','\n')}]:[]
}

function serialize(value:unknown){
 if(value instanceof Error)return clean(value.stack||`${value.name}: ${value.message}`,12000)
 const seen=new WeakSet<object>()
 try{return clean(JSON.stringify(value,(key,item)=>{
  if(/api.?key|authorization|password|secret|token/i.test(key)&&item)return '[REDACTED]'
  if(typeof item==='object'&&item!==null){if(seen.has(item))return '[Circular]';seen.add(item)}
  return item
 }),12000)}catch{return clean(String(value),12000)}
}

function clean(value:string,limit:number){
 return value
  .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi,'$1[REDACTED]@')
  .replace(/(bearer\s+)[^\s"',;]+/gi,'$1[REDACTED]')
  .replace(/\b(?:sk-ant-[a-z0-9_-]{12,}|sk-[a-z0-9_-]{12,}|hf_[a-z0-9]{12,})\b/gi,'[REDACTED]')
  .replace(/((?:api.?key|authorization|password|secret|token)\s*[:=]\s*)(["']?)[^\s,"';}]+\2/gi,'$1[REDACTED]')
  .replace(/data:(?:image|audio|video)\/[^;,]+;base64,[a-z0-9+/=]+/gi,'[MEDIA_DATA_REDACTED]')
  .replace(/[\r\n]+/g,'\\n')
  .slice(0,limit)
}
