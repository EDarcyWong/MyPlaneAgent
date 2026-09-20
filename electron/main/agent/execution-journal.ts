import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {readIntegrationJson,writeIntegrationJson} from '../integration-store.js'
import type {ExecutionRecord,FailureKind} from '../../shared/agent-execution.js'
import {AgentWorkspace} from './workspace.js'

export const contentHash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
export function classifyFailure(code:string,message:string):NonNullable<ExecutionRecord['failure']>{
 let kind:FailureKind='tool',nextAction='读取完整证据，修正原因后再尝试。'
 if(/INVALID_ARGUMENTS|UNKNOWN_TOOL|SCHEMA/.test(code)){kind='arguments';nextAction='根据工具 Schema 修正参数，不重放已完成的步骤。'}
 else if(/RESULT_UNKNOWN|INTERRUPTED/.test(code)){kind='unknown';nextAction='先核对实际状态；结果未知的有副作用操作不可自动重放。'}
 else if(/CANCELLED/.test(code)){kind='cancelled';nextAction='核对已有产物和进程状态后继续。'}
 else if(/TIMEOUT/.test(code)){kind='timeout';nextAction='检查是否仍有进程和已生成产物，再调整任务范围。'}
 else if(/VERIFICATION|COMMAND_FAILED|BUILD_FAILED/.test(code)){kind='verification';nextAction='读取结构化诊断，修复相关文件后重新验证。'}
 else if(/ENOENT|环境|找不到|not found/i.test(message)){kind='environment';nextAction='检查运行时、项目配置和依赖，不自动安装或修改全局环境。'}
 else if(/变化|已被修改|基线|唯一匹配/.test(message)){kind='conflict';nextAction='重新读取当前文件并生成新补丁。'}
 return {kind,message:message.slice(0,2000),nextAction}
}

// A durable operation record is written BEFORE invoking side effects. It is
// independent of conversation saves; it cannot make external side effects atomic.
export class ExecutionJournal{
 constructor(private root:string){}
 private directory(taskId:string){if(!/^[a-f\d-]{36}$/i.test(taskId))throw new Error('任务 ID 无效');return path.join(this.root,'executions',taskId)}
 private file(taskId:string,id:string){if(!/^[a-f\d-]{36}$/i.test(id))throw new Error('步骤 ID 无效');return path.join(this.directory(taskId),id+'.json')}
 save(record:ExecutionRecord){record.updatedAt=new Date().toISOString();writeIntegrationJson(this.file(record.taskId,record.id),record);return record}
 list(taskId:string):ExecutionRecord[]{
  const directory=this.directory(taskId);if(!fs.existsSync(directory))return []
  return fs.readdirSync(directory).filter(name=>/^[a-f\d-]{36}\.json$/i.test(name)).map(name=>{
   const record=readIntegrationJson<ExecutionRecord|null>(path.join(directory,name),null)
   if(!record||record.taskId!==taskId||record.id+'.json'!==name||!Array.isArray(record.expectedFiles))throw new Error('执行记录损坏，需核对后恢复')
   return record
  })
 }
 reconcile(record:ExecutionRecord,workspace:AgentWorkspace){
  if(!['running','verifying','unknown'].includes(record.state))return record
  if(!record.effectful){record.state='not-applied';record.verification={status:'unverified',summary:'只读步骤被中断，可重新读取'};return this.save(record)}
  if(record.expectedFiles.length){
   try{
    const hashes=record.expectedFiles.map(expected=>{
     const file=workspace.resolve(expected.path,true);if(!fs.existsSync(file))return null
     const stat=fs.statSync(file);if(!stat.isFile()||stat.size>20*1024*1024)throw new Error('待核对文件超过容量或不是普通文件')
     return contentHash(fs.readFileSync(file))
    })
    if(hashes.every((hash,index)=>hash===record.expectedFiles[index].afterHash)){
     record.state='succeeded';record.verification={status:'passed',summary:'逐文件核对写入后的 SHA-256；不代表功能测试通过'};record.resolution={by:'file-hash',note:'已核对目标内容存在'};delete record.failure;return this.save(record)
    }
    if(hashes.every((hash,index)=>hash===record.expectedFiles[index].beforeHash)){
     record.state='not-applied';record.verification={status:'unverified',summary:'文件仍为操作前版本，可以重新规划'};record.resolution={by:'file-hash',note:'核对全部文件与操作前一致'};return this.save(record)
    }
   }catch{/* Missing permissions, changed workspace, or partial writes need review. */}
  }
  record.state='unknown';record.failure=classifyFailure('RESULT_UNKNOWN','执行中断，无法确认全部副作用');return this.save(record)
 }
 resolve(taskId:string,id:string,outcome:'completed'|'not-applied',note:string){
  const record=this.list(taskId).find(item=>item.id===id);if(!record||record.state!=='unknown')throw new Error('此步骤无需人工核对或状态已变化')
  record.state=outcome==='completed'?'succeeded':'not-applied';record.resolution={by:'user',note};record.verification={status:'unverified',summary:'用户核对执行结果；未代替程序验证'};delete record.failure;return this.save(record)
 }
 remove(taskId:string){const directory=this.directory(taskId);if(path.dirname(path.resolve(directory))!==path.resolve(this.root,'executions'))throw new Error('执行记录目录无效');fs.rmSync(directory,{recursive:true,force:true})}
}
