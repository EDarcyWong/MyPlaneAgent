import {createHash,randomUUID} from 'node:crypto'
import type {AgentToolSaveInput,AgentToolVersion,AgentToolView} from '../../shared/local-ai-tools.js'
import {readIntegrationJson,writeIntegrationJson} from '../integration-store.js'
import {agentTools,readTools} from './tools.js'
import {builtinSpecs,ToolRegistry,type ToolDefinition,type ToolSpec} from './registry.js'
import {PythonToolRuntime} from './python.js'
import {AgentWorkspace} from './workspace.js'

type Stored={id:string;key:string;builtin:boolean;enabled:boolean;archived:boolean;activeVersion:number;versions:AgentToolVersion[]}
const builtinPython=(key:string)=>`def execute(args, context):\n    return builtin(${JSON.stringify(key)}, args, context)\n`
export class AgentToolStore {
 private tools:Stored[]
 constructor(private file:string,private python:PythonToolRuntime){
  this.tools=readIntegrationJson<Stored[]>(file,[]);this.seed()
 }
 private risk(tool:Pick<Stored,'builtin'|'key'>,version:Pick<AgentToolVersion,'python'|'risk'>):AgentToolVersion['risk']{
  if(!tool.builtin||version.python!==builtinPython(tool.key))return 'high'
  const floor=builtinSpecs().find(spec=>spec.definition.function.name===tool.key)?.risk||'high'
  const levels={read:0,write:1,high:2};return levels[version.risk]>=levels[floor]?version.risk:floor
 }
 private seed(){
  let changed=false;const runtimeRevision=this.python.revision()
  for(const definition of agentTools as ToolDefinition[]){const key=definition.function.name;if(this.tools.some(tool=>tool.key===key))continue;const id=randomUUID(),version:AgentToolVersion={toolId:id,version:1,name:key,description:definition.function.description,parameters:definition.function.parameters,python:builtinPython(key),risk:readTools.has(key)||['read_history','set_plan'].includes(key)?'read':['run_command','run_test','run_test_case','get_diagnostics','http_request'].includes(key)?'high':'write',timeoutMs:['read_document','create_document','create_spreadsheet','image_ocr','archive_inspect'].includes(key)?120000:['run_test_case','get_diagnostics'].includes(key)?300000:30000,runtimeRevision,changeNote:'系统初始版本',createdAt:new Date().toISOString()};this.tools.push({id,key,builtin:true,enabled:true,archived:false,activeVersion:1,versions:[version]});changed=true}
  for(const tool of this.tools.filter(item=>item.builtin)){const current=tool.versions.find(version=>version.version===tool.activeVersion);if(!current||current.python!==builtinPython(tool.key)||current.runtimeRevision===runtimeRevision)continue;const version=Math.max(0,...tool.versions.map(item=>item.version))+1;tool.versions.push({...current,version,runtimeRevision,changeNote:'同步 Python 运行时实现 '+runtimeRevision.slice(0,12),createdAt:new Date().toISOString()});tool.activeVersion=version;changed=true}
  for(const tool of this.tools)for(const version of tool.versions){const risk=this.risk(tool,version);if(version.risk!==risk){version.risk=risk;changed=true}}
  if(changed)this.persist()
 }
 private persist(){writeIntegrationJson(this.file,this.tools)}
 private get(id:string){const tool=this.tools.find(item=>item.id===id);if(!tool)throw new Error('工具不存在');return tool}
 private view(tool:Stored):AgentToolView{const current=tool.versions.find(version=>version.version===tool.activeVersion);if(!current)throw new Error('工具当前版本不存在');return structuredClone({...tool,current})}
 list(){return this.tools.filter(tool=>!tool.archived).map(tool=>this.view(tool))}
 save(input:AgentToolSaveInput){
  if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input.key))throw new Error('工具标识需以字母开头，只能包含字母、数字、下划线和连字符')
  if(!input.name?.trim()||input.name.length>100||!input.description?.trim()||input.description.length>1500)throw new Error('工具名称或说明无效')
  if(!input.parameters||typeof input.parameters!=='object'||Array.isArray(input.parameters))throw new Error('参数 Schema 必须是 JSON 对象')
  new ToolRegistry([{definition:{type:'function',function:{name:input.key,description:input.description,parameters:input.parameters}},source:'python:validation',risk:input.risk,timeoutMs:input.timeoutMs}])
  if(typeof input.python!=='string'||!input.python.includes('def execute(')||input.python.length>100000)throw new Error('Python 实现必须定义 execute(args, context)')
  if(!['read','write','high'].includes(input.risk)||!Number.isInteger(input.timeoutMs)||input.timeoutMs<1000||input.timeoutMs>300000)throw new Error('权限或超时无效')
  let tool=input.id?this.get(input.id):undefined
  if(!tool){if(this.tools.some(item=>item.key===input.key))throw new Error('工具标识已存在');tool={id:randomUUID(),key:input.key,builtin:false,enabled:true,archived:false,activeVersion:0,versions:[]};this.tools.push(tool)}
  if(tool.key!==input.key)throw new Error('工具标识创建后不能修改')
  const risk=this.risk(tool,input)
  const version=Math.max(0,...tool.versions.map(item=>item.version))+1,next:AgentToolVersion={toolId:tool.id,version,name:input.name.trim(),description:input.description.trim(),parameters:structuredClone(input.parameters),python:input.python,risk,timeoutMs:input.timeoutMs,...(tool.builtin&&input.python===builtinPython(tool.key)?{runtimeRevision:this.python.revision()}:{}),changeNote:String(input.changeNote||'').slice(0,300),createdAt:new Date().toISOString()}
  tool.versions.push(next);tool.activeVersion=version;this.persist();return this.view(tool)
 }
 toggle(id:string,enabled:boolean){const tool=this.get(id);tool.enabled=enabled;this.persist();return this.view(tool)}
 restore(id:string,version:number){const tool=this.get(id),source=tool.versions.find(item=>item.version===version);if(!source)throw new Error('历史版本不存在');return this.save({id,key:tool.key,name:source.name,description:source.description,parameters:source.parameters,python:source.python,risk:source.risk,timeoutMs:source.timeoutMs,changeNote:`从 v${version} 恢复`})}
 specs(workspace:string):ToolSpec[]{return this.list().filter(tool=>tool.enabled).map(tool=>{
  const v=tool.current,definition:ToolDefinition={type:'function',function:{name:tool.key,description:v.description,parameters:v.parameters}}
  const execute=async(args:Record<string,unknown>,signal:AbortSignal,context:Record<string,unknown>={})=>{
   if(!tool.builtin||v.python!==builtinPython(tool.key))return (await this.python.execute({tool:tool.key,args,workspace,code:v.python,context},signal,v.timeoutMs)).output
   if(!['write_file','replace_text','apply_patch','create_document','create_spreadsheet','run_command','run_test'].includes(tool.key))return (await this.python.execute({tool:tool.key,args,workspace,code:v.python,context},signal,v.timeoutMs)).output
   const prepared=await this.python.execute({tool:tool.key,args,workspace,code:v.python,context:{...context,phase:'plan'}},signal,v.timeoutMs),value=JSON.parse(prepared.output)
   const committed=await this.python.execute({tool:tool.key,args,workspace,code:v.python,context:{...context,phase:'commit',plan:value.plan}},signal,v.timeoutMs),result=JSON.parse(committed.output)
   return JSON.stringify({...result,_preview:value.preview})
  }
  const prepare:ToolSpec['prepare']=tool.builtin&&v.python===builtinPython(tool.key)&&['write_file','replace_text','apply_patch','create_document','create_spreadsheet','run_command','run_test'].includes(tool.key)?async(args,signal,context)=>{
   if(['run_command','run_test'].includes(tool.key))return new AgentWorkspace(workspace).prepare(tool.key,args,signal)
   const prepared=await this.python.execute({tool:tool.key,args,workspace,code:v.python,context:{...context,phase:'plan'}},signal,v.timeoutMs),value=JSON.parse(prepared.output)
   return {preview:value.preview,artifact:value.artifact,expectedFiles:value.plan.changes.map((change:{path:string;expected:string|null;afterHex?:string;after?:string})=>({path:change.path,beforeHash:change.expected,afterHash:createHash('sha256').update(change.afterHex!==undefined?Buffer.from(change.afterHex,'hex'):Buffer.from(change.after||'')).digest('hex')})),execute:async commitSignal=>{
    const committed=await this.python.execute({tool:tool.key,args,workspace,code:v.python,context:{...context,phase:'commit',plan:value.plan}},commitSignal,v.timeoutMs)
    return JSON.stringify({...JSON.parse(committed.output),_preview:value.preview})
   }}
  }:undefined
  return {prepare,definition,revision:`${tool.id}:v${v.version}`,source:tool.builtin?'python:builtin':'python:custom',risk:v.risk,timeoutMs:v.timeoutMs,destination:'本机 Python',execute}
 })}
 version(id:string,version?:number){const tool=this.get(id),found=tool.versions.find(item=>item.version===(version||tool.activeVersion));if(!found)throw new Error('工具版本不存在');return structuredClone({tool,version:found})}
}
