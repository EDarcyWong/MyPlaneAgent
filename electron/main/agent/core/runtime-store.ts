import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import type {TaskPlan} from '../../../shared/task-plan.js'
import type {CapabilityExecutionResult} from '../../../shared/types/capability.js'

export type StoredOperation={id:string;taskId:string;itemId?:string;workerId?:string;workspace:string;capability:string;args:Record<string,unknown>;createdAt:string;parentEvidenceId?:string;revision:number;effectKey?:string;expectedFiles?:Array<{file:string;before:string;after:string}>}
/** SQLite commits metadata and evidence together. Large payloads are content-addressed. */
export class RuntimeStore {
  private db:DatabaseSync
  private blobs:string
  private closed=false
  constructor(directory:string) {
    fs.mkdirSync(directory,{recursive:true});this.blobs=path.join(directory,'evidence');fs.mkdirSync(this.blobs,{recursive:true})
    this.db=new DatabaseSync(path.join(directory,'runtime.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, workspace TEXT NOT NULL, state TEXT NOT NULL, metadata TEXT NOT NULL, result_hash TEXT);
      CREATE TABLE IF NOT EXISTS plans(task_id TEXT PRIMARY KEY, workspace TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(workspace TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS effects(key TEXT PRIMARY KEY, operation_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS operations_task ON operations(task_id);
      PRAGMA user_version=1;`)
    // A process interruption is not a failed/no-effect execution.
    this.db.exec("UPDATE operations SET state='unknown' WHERE state='running'")
  }
  revision(workspace:string):number {return Number((this.db.prepare('SELECT revision FROM revisions WHERE workspace=?').get(workspace) as {revision:number}|undefined)?.revision||0)}
  has(id:string){return !!this.db.prepare('SELECT 1 FROM operations WHERE id=?').get(id)}
  begin(operation:StoredOperation) {
    this.db.exec('BEGIN IMMEDIATE')
    try{
      this.db.prepare('INSERT INTO operations(id,task_id,workspace,state,metadata) VALUES(?,?,?,?,?)').run(operation.id,operation.taskId,operation.workspace,'running',JSON.stringify(operation))
      if(operation.effectKey)this.db.prepare('INSERT INTO effects VALUES(?,?) ON CONFLICT(key) DO UPDATE SET operation_id=excluded.operation_id').run(operation.effectKey,operation.id)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  previousEffect(key:string,taskId:string,workspace:string) {
    const row=this.db.prepare('SELECT operation_id FROM effects WHERE key=?').get(key) as {operation_id:string}|undefined
    return row?this.read(row.operation_id,taskId,workspace):undefined
  }
  finish(operation:StoredOperation,result:CapabilityExecutionResult,mutates:boolean) {
    const body=JSON.stringify(result),hash=createHash('sha256').update(body).digest('hex'),file=path.join(this.blobs,hash+'.json')
    if(!fs.existsSync(file)){
      const temporary=file+'.'+randomUUID()+'.tmp'
      try{fs.writeFileSync(temporary,body,{mode:0o600,flush:true});fs.renameSync(temporary,file)}finally{fs.rmSync(temporary,{force:true})}
    }
    this.db.exec('BEGIN IMMEDIATE')
    try{
      this.db.prepare('UPDATE operations SET state=?, result_hash=? WHERE id=?').run(result.outcome||'unknown',hash,operation.id)
      if(mutates)this.db.prepare('INSERT INTO revisions VALUES(?,1) ON CONFLICT(workspace) DO UPDATE SET revision=revision+1').run(operation.workspace)
      this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  read(id:string,taskId:string,workspace:string) {
    const row=this.db.prepare('SELECT state,metadata,result_hash FROM operations WHERE id=? AND task_id=? AND workspace=?').get(id,taskId,workspace) as {state:string;metadata:string;result_hash?:string}|undefined
    if(!row)throw new Error('当前任务不存在该证据')
    const operation=JSON.parse(row.metadata) as StoredOperation
    const result=row.result_hash?JSON.parse(fs.readFileSync(path.join(this.blobs,row.result_hash+'.json'),'utf8')) as CapabilityExecutionResult:undefined
    return {operation,state:row.state,result,stale:(result?.metadata?.revision??operation.revision)!==this.revision(workspace)}
  }
  savePlan(plan:TaskPlan) {this.db.prepare('INSERT INTO plans VALUES(?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET workspace=excluded.workspace,updated_at=excluded.updated_at,body=excluded.body').run(plan.taskId,plan.workspace,plan.updatedAt,JSON.stringify(plan))}
  loadPlan(taskId:string,workspace:string):TaskPlan|undefined {
    const row=this.db.prepare('SELECT body FROM plans WHERE task_id=? AND workspace=?').get(taskId,workspace) as {body:string}|undefined
    return row?JSON.parse(row.body):undefined
  }
  close(){if(!this.closed){this.closed=true;this.db.close()}}
}
