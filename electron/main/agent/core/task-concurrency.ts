import path from 'node:path'
import type {TaskItem,TaskPlan} from '../../../shared/task-plan.js'
import {canonicalPath} from './execution-runtime.js'
import {taskWriteScopes} from './task-worker-context.js'
import type {ParallelWorkerMode} from './parallel-capabilities.js'

export const maxParallelWorkers=4
export type WorkerAdmission={mode:ParallelWorkerMode|'exclusive';paths:string[]}
const exclusive=():WorkerAdmission=>({mode:'exclusive',paths:[]})
const inside=(file:string,dir:string)=>file===dir||file.startsWith(dir+path.sep)
const identity=(file:string)=>process.platform==='win32'?file.toLowerCase():file

/** Admission lasts for the whole item, including its local verification and repairs. */
export function workerAdmission(plan:TaskPlan,item:TaskItem):WorkerAdmission {
  if(!plan.graphVersion||!item.parallel||item.childIds?.length||item.repairPending)return exclusive()
  if(item.mode==='read')return {mode:'read',paths:[]}
  if(item.mode!=='write'||!item.fileScope?.length||item.verificationProblem||!item.verification?.length||item.verification.some(rule=>rule.kind!=='file'))return exclusive()
  try{
    const root=identity(canonicalPath(plan.workspace))
    const groups=taskWriteScopes(plan,item).map(group=>group.map(scope=>identity(canonicalPath(plan.workspace,scope))))
    if(groups.some(group=>!group.length||group.some(scope=>!inside(scope,root))))return exclusive()
    let paths=groups[0]
    for(const group of groups.slice(1))paths=paths.flatMap(a=>group.flatMap(b=>inside(a,b)?[a]:inside(b,a)?[b]:[]))
    paths=[...new Set(paths)]
    if(!paths.length||item.verification.some(rule=>rule.kind!=='file'||!paths.some(scope=>inside(identity(canonicalPath(plan.workspace,rule.path)),scope))))return exclusive()
    return {mode:'scoped-write',paths}
  }catch{return exclusive()}
}

export function canRunTogether(a:WorkerAdmission,b:WorkerAdmission):boolean {
  if(a.mode==='exclusive'||b.mode==='exclusive'||a.mode!==b.mode)return false
  return a.mode==='read'||!a.paths.some(left=>b.paths.some(right=>inside(left,right)||inside(right,left)))
}

