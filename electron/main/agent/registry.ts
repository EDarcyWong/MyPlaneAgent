import type {PreparedAction} from './workspace.js'
import {Ajv,type ValidateFunction} from 'ajv'
import {Ajv2020} from 'ajv/dist/2020.js'
import {Ajv2019} from 'ajv/dist/2019.js'
import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {agentTools,agentContextTools,readTools} from './tools.js'
export type ToolDefinition={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}}
export type ToolSpec={prepare?:(args:Record<string,unknown>,signal:AbortSignal,context:Record<string,unknown>)=>Promise<PreparedAction>;revision?:string;destination?:string;definition:ToolDefinition;source:string;risk:'read'|'write'|'high';timeoutMs:number;execute?:(args:Record<string,unknown>,signal:AbortSignal,context?:Record<string,unknown>)=>Promise<string>}
export class ToolError extends Error {
 constructor(public code:string,message:string,public details?:unknown){super(message);this.name='ToolError'}
}
export class ToolRegistry {
 private entries=new Map<string,{spec:ToolSpec;validate:ValidateFunction}>()
 constructor(specs:ToolSpec[]){
  const options={allErrors:true,strict:false,validateFormats:false,ownProperties:true,coerceTypes:false,useDefaults:false,removeAdditional:false},ajv=new Ajv(options),modern=new Ajv2020(options),intermediate=new Ajv2019(options)
  for(const spec of specs){const name=spec.definition.function.name;if(!/^[a-zA-Z0-9_-]{1,64}$/.test(name)||this.entries.has(name))throw new ToolError('TOOL_SCHEMA','工具名称无效或重复');const schema=spec.definition.function.parameters,dialect=String(schema.$schema||'');const compiler=dialect.includes('2020-12')||!dialect&&spec.source.startsWith('mcp')?modern:dialect.includes('2019-09')?intermediate:ajv;this.entries.set(name,{spec,validate:compiler.compile(schema)})}
 }
 definitions(){return [...this.entries.values()].map(entry=>entry.spec.definition)}
 snapshot(){return [...this.entries.values()].map(entry=>({name:entry.spec.definition.function.name,revision:entry.spec.revision,source:entry.spec.source}))}
 get(name:string){const entry=this.entries.get(name);if(!entry)throw new ToolError('UNKNOWN_TOOL','模型请求了未提供的工具');return entry.spec}
 parse(name:string,raw:string){
  this.get(name);let args:unknown
  try{args=JSON.parse(raw)}catch{throw new ToolError('INVALID_ARGUMENTS','工具参数不是有效 JSON；请修正后再调用')}
  const entry=this.entries.get(name)!
  if(!entry.validate(args))throw new ToolError('INVALID_ARGUMENTS','工具参数不符合 Schema',entry.validate.errors?.slice(0,8).map(error=>({field:error.instancePath||'/',rule:error.keyword,message:error.message,params:error.params})))
  return args as Record<string,unknown>
 }
}
export const builtinSpecs=():ToolSpec[]=>([...agentTools,...agentContextTools] as ToolDefinition[]).map(definition=>({definition,source:'builtin',risk:readTools.has(definition.function.name)||['set_plan','read_history','read_tool_result','inspect_build','reconcile_execution'].includes(definition.function.name)?'read':['build_project','run_command','run_test','run_test_case','get_diagnostics','http_request','web_search','web_fetch'].includes(definition.function.name)?'high':'write',timeoutMs:['read_document','create_document','create_spreadsheet','image_ocr','archive_inspect','web_search','web_fetch'].includes(definition.function.name)?120000:['run_test_case','get_diagnostics'].includes(definition.function.name)?300000:30000}))
export function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';return JSON.stringify(value)??'null'}
export const fingerprint=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex')
export function redact(value:unknown):unknown{
 if(Array.isArray(value))return value.slice(0,20).map(redact)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([key,item])=>[key,/(key|token|password|secret|credential|authorization|content|oldText|newText|before|after|command|env|arguments)/i.test(key)?'[已隐藏]':redact(item)]))
 return typeof value==='string'?value.replace(/(?:Bearer\s+|sk-)[\w.\-/]+/gi,'[已隐藏]').slice(0,300):value
}
export function appendAudit(directory:string,record:Record<string,unknown>){
 const dir=path.join(directory,'audit');fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,String(record.taskId)+'.jsonl')
 if(fs.existsSync(file)&&fs.statSync(file).size>5_000_000)fs.renameSync(file,file+'.previous')
 fs.appendFileSync(file,JSON.stringify(redact(typeof record.source==='string'&&record.source.startsWith('mcp:')?{...record,args:{fields:Object.keys((record.args||{}) as object)}}:record))+'\n',{mode:0o600})
}
// Await cooperative cancellation rather than abandoning a promise that might still write.
export async function boundedTool<T>(parent:AbortSignal,ms:number,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
 const timeout=new AbortController(),signal=AbortSignal.any([parent,timeout.signal]);const timer=setTimeout(()=>timeout.abort(new ToolError('TOOL_TIMEOUT','工具执行超时；请核对执行结果后继续')),ms)
 try{signal.throwIfAborted();const result=await work(signal);signal.throwIfAborted();return result}finally{clearTimeout(timer)}
}
