import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {AgentCoreService} from '../dist-electron/main/agent/agent-core-service.js'

test('evidence readback follows actual file versions across writes, checks and external edits',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-evidence-read-')),workspace=path.join(root,'workspace')
 fs.mkdirSync(workspace)
 const core=new AgentCoreService({dataDir:path.join(root,'data'),skillsDir:path.join(root,'skills'),getConnection:()=>({endpoint:'http://127.0.0.1:1/v1',key:''})})
 t.after(async()=>{await core.dispose();fs.rmSync(root,{recursive:true,force:true})})
 await core.initialize()
 const registry=core.getCapabilityRegistry(),signal=new AbortController().signal
 const register=(name,run)=>registry.registerBuiltin({name,category:'test',description:'Test fixture',parameters:{type:'object'},runtime:'builtin',source:{type:'skill',skillId:'agent-tools'},permissions:[]},run)
 register('agent.write_file',async args=>{fs.writeFileSync(path.join(workspace,args.path),args.content);return {status:'saved'}})
 register('agent.read_file',async args=>({text:fs.existsSync(path.join(workspace,args.path))?fs.readFileSync(path.join(workspace,args.path),'utf8'):null}))
 register('agent.run_test',async()=>({exitCode:0}))
 let next=0
 const execute=(capability,args={},activityId='operation-'+ ++next)=>registry.execute({capability,args,workspace,execution:{taskId:'task',workspace,activityId,mode:'write'}},signal)
 const read=async id=>{
  const result=await execute('runtime.read_evidence',{id})
  assert.equal(result.success,true,result.error)
  return result.output
 }
 assert.equal((await execute('agent.write_file',{path:'a.txt',content:'first'},'write')).success,true)
 assert.equal((await read('write')).freshness,'current')
 await execute('agent.run_test',{},'test')
 await execute('agent.run_test',{},'test-again')
 assert.equal((await read('test')).freshness,'current')
 await execute('agent.write_file',{path:'unrelated.txt',content:'other'})
 assert.equal((await read('write')).freshness,'current')
 assert.equal((await read('test')).freshness,'stale')
 const original=JSON.parse((await read('write')).output)
 assert.equal(original.output.status,'saved')
 fs.writeFileSync(path.join(workspace,'a.txt'),'external edit')
 assert.equal((await read('write')).freshness,'stale')
 assert.deepEqual(JSON.parse((await read('write')).output),original,'reading stale evidence must preserve the original record')
 await execute('agent.read_file',{path:'missing.txt'},'missing')
 assert.equal((await read('missing')).freshness,'current')
 fs.writeFileSync(path.join(workspace,'missing.txt'),'created later')
 assert.equal((await read('missing')).freshness,'stale')
 const foreign=await registry.execute({capability:'runtime.read_evidence',args:{id:'write'},workspace,execution:{taskId:'other',workspace,activityId:'foreign'}},signal)
 assert.equal(foreign.success,false);assert.match(foreign.error,/当前任务/)
 await execute('agent.read_file',{path:'a.txt',paths:Array.from({length:41},(_,i)=>'unread-'+i)},'bounded')
 assert.equal((await read('bounded')).freshness,'unknown','a partial version snapshot cannot certify all requested paths')
})

test('reads made during file changes cannot become fresh merely because the old content returns',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-evidence-race-')),workspace=path.join(root,'workspace')
 fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'a.txt'),'before')
 const core=new AgentCoreService({dataDir:path.join(root,'data'),skillsDir:path.join(root,'skills'),getConnection:()=>({endpoint:'http://127.0.0.1:1/v1',key:''})})
 t.after(async()=>{await core.dispose();fs.rmSync(root,{recursive:true,force:true})})
 await core.initialize()
 const registry=core.getCapabilityRegistry(),signal=new AbortController().signal
 registry.registerBuiltin({name:'agent.read_file',category:'test',description:'Test fixture',parameters:{type:'object'},runtime:'builtin',source:{type:'skill',skillId:'agent-tools'},permissions:[]},async()=>{
  fs.writeFileSync(path.join(workspace,'a.txt'),'during');return {text:'during'}
 })
 await registry.execute({capability:'agent.read_file',args:{path:'a.txt'},workspace,execution:{taskId:'task',workspace,activityId:'read'}},signal)
 fs.writeFileSync(path.join(workspace,'a.txt'),'before')
 const result=await registry.execute({capability:'runtime.read_evidence',args:{id:'read'},workspace,execution:{taskId:'task',workspace,activityId:'evidence'}},signal)
 assert.equal(result.success,true);assert.equal(result.output.freshness,'stale')
})
