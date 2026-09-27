import {createHash} from 'node:crypto'
import {scopeExcludes,projectChecksRequested,projectCheckTools,type TaskScope} from '../../../shared/task-scope.js'
import type {TaskReviewAction,TaskReviewQueue,TaskReviewCheck} from '../../../shared/task-plan.js'
const allowed=new Set(['browser.open','browser.read_page','browser.inspect','browser.screenshot','browser.click','preview.status','preview.start','agent.read_file','agent.list_files','agent.file_info','agent.inspect_project','agent.search_files','agent.get_diagnostics','agent.run_test'])
const observations=new Set(['browser.read_page','browser.inspect','browser.screenshot','preview.status','agent.read_file','agent.list_files','agent.file_info','agent.inspect_project','agent.search_files','agent.get_diagnostics','agent.run_test'])
const sourceObservations=new Set(['agent.read_file','agent.list_files','agent.file_info','agent.inspect_project','agent.search_files','agent.get_diagnostics','agent.run_test'])
const revisionFor=(queue:TaskReviewQueue,capability:string)=>sourceObservations.has(capability)||['browser.open','browser.click'].includes(capability)?queue.fileRevision??0:observations.has(capability)?queue.revision:0
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='snapshot').sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value
const signature=(action:TaskReviewAction)=>createHash('sha256').update(JSON.stringify([action.capability,canonical(action.args)])).digest('hex')
export function reviewActionAllowed(action:TaskReviewAction,scope?:TaskScope,projectChanged=false){
 if(!allowed.has(action.capability))return false
 if(!scope)return true
 if(!projectChanged&&!projectChecksRequested(scope.goal)&&projectCheckTools.has(action.capability))return false
 if(!action.basis||!scope.goal.includes(action.basis))return false
 if(scopeExcludes(scope,action.title+' '+JSON.stringify(action.args)))return false
 if(scope.kind==='open-preview'&&!['browser.open','browser.read_page','preview.status','preview.start','agent.read_file','agent.list_files','agent.file_info','agent.inspect_project'].includes(action.capability))return false
 return true
}
/** Queue decisions are persisted by the caller; a review never directly runs a tool. */
export function enqueueReviewActions(queue:TaskReviewQueue,actions:TaskReviewAction[],scope?:TaskScope,validate?:(action:TaskReviewAction)=>string|undefined){
 const rejected:string[]=[]
 for(const action of actions){
  if(action.required===false)continue
  if(!reviewActionAllowed(action,scope,(queue.fileRevision||0)>0)){rejected.push(action.title);continue}
  const base=signature(action),revision=revisionFor(queue,action.capability)
  const invalid=validate?.(action)
  if(invalid){
   rejected.push(action.title+'：'+invalid)
   if(!queue.checks.some(check=>check.signature===base&&check.status==='invalid')&&queue.checks.length<32)queue.checks.push({...action,id:createHash('sha256').update(base+':invalid:'+queue.checks.length).digest('hex').slice(0,20),signature:base,revision,attempts:0,status:'invalid',summary:invalid})
   continue
  }
  const existing=queue.checks.find(check=>check.signature===base&&(check.status==='pending'||check.revision===revision))
  if(existing){if(existing.status==='invalid'||existing.status==='deferred'){existing.status='pending';existing.attempts=0;existing.args=action.args}else if(existing.status==='failed'&&existing.attempts<2){existing.status='pending';existing.args=action.args};continue}
  if(queue.checks.filter(check=>!['invalid','deferred'].includes(check.status)).length>=16){rejected.push('已达到 16 项自动检查上限');break}
  queue.checks.push({...action,id:createHash('sha256').update(base+':'+queue.checks.length).digest('hex').slice(0,20),signature:base,revision,attempts:0,status:'pending'})
 }
 return rejected
}
export function nextReviewCheck(queue:TaskReviewQueue):TaskReviewCheck|undefined{
 if(queue.phase==='implement')return
 for(const check of queue.checks){
  if(check.status!=='pending')continue
  check.revision=revisionFor(queue,check.capability)
  const completed=queue.checks.find(other=>other!==check&&other.signature===check.signature&&other.revision===check.revision&&other.status==='complete')
  if(completed){check.status='complete';check.activityId=completed.activityId;check.summary='复用已保存的成功检查结果';continue}
  if(check.attempts>=2){check.status='failed';continue}
  check.status='running';check.attempts++;return check
 }
}
export function recoverReviewQueue(queue:TaskReviewQueue){
 for(const check of queue.checks){
  if(check.status==='failed'&&check.summary?.startsWith('工具未执行，请修正参数后重试：')){check.status='invalid';check.attempts=0}
  if(sourceObservations.has(check.capability)&&queue.fileRevision===undefined)check.revision=0
  if(check.status==='running'){
  // An interrupted click/start might already have happened. Read its state first.
  check.status='failed';check.attempts=observations.has(check.capability)?Math.min(check.attempts,1):2
  check.summary='上次检查执行被中断；先读取当前状态，禁止直接重放可能已执行的操作。'
  }
 }
}
