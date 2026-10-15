import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parseTaskItems,runTaskPlan} from '../dist-electron/main/agent/core/task-plan-runner.js'
import {readyTaskItems,readWorkerBatch} from '../dist-electron/main/agent/core/task-graph.js'
import {chatCapabilityAllowed} from '../dist-electron/main/agent/core/chat-runner.js'

function fixture(items){
 const plan={taskId:'graph',workspace:'/tmp/myplane-task-graph',graphVersion:1,items,updatedAt:''}
 const events=[]
 const options={workspace:plan.workspace,messages:[{role:'user',content:'分析并修改项目'}],filesEnabled:true,webEnabled:true,approvalMode:'full',connection:{endpoint:'http://localhost/unused',key:'',maxTokens:1000,contextLength:8000},model:'fixture',signal:new AbortController().signal,approve:async()=>true,onRequest:()=>{},onUsage:()=>{},onReasoning:()=>{},onActivity:()=>{},onContent:text=>events.push(text),onOutcome:value=>events.push(value)}
 return {plan,options,events,execution:{taskId:plan.taskId,goal:'分析并修改项目',plan,save:()=>{}}}
}

test('task graph validates references, cycles and parallel write requests',()=>{
 const items=parseTaskItems(JSON.stringify({steps:[{key:'a',title:'读取接口',acceptance:'列出接口',mode:'read'},{key:'b',title:'修改接口',acceptance:'源码更新',mode:'write',dependsOn:['a']}]}))
 assert.deepEqual(items[1].dependsOn,[items[0].id])
 assert.deepEqual(readyTaskItems({graphVersion:1,items}),[items[0]])
 items[0].status='complete'
 assert.deepEqual(readyTaskItems({graphVersion:1,items}),[items[1]])
 assert.throws(()=>parseTaskItems(JSON.stringify({steps:[{key:'a',title:'步骤 A',acceptance:'完成 A',dependsOn:['b']},{key:'b',title:'步骤 B',acceptance:'完成 B',dependsOn:['a']}]})),/循环/)
 assert.throws(()=>parseTaskItems(JSON.stringify({steps:[{key:'a',title:'步骤 A',acceptance:'完成 A',dependsOn:['missing']}]})),/未知 key/)
 assert.throws(()=>parseTaskItems(JSON.stringify({steps:[{title:'父项',acceptance:'完成',children:[{title:'写代码',acceptance:'完成',mode:'write',parallel:true}]}]})),/只读/)
})

test('independent read subagents run concurrently, then the parent verifies',async()=>{
 const items=parseTaskItems(JSON.stringify({steps:[{key:'parent',title:'汇总项目资料',acceptance:'两个来源均已读取',children:[
  {key:'one',title:'读取模块 A',acceptance:'取得模块 A 内容',mode:'read',parallel:true},
  {key:'two',title:'读取模块 B',acceptance:'取得模块 B 内容',mode:'read',parallel:true}
 ]}]}))
 const f=fixture(items),started=[],finished=[]
 f.options.messages.push({role:'assistant',content:'旧模型猜测，不能当作子任务证据'})
 let release
 const barrier=new Promise(resolve=>{release=resolve})
 await runTaskPlan(f.options,f.execution,async step=>{
  const title=step.currentStep.title
  assert.equal(step.messages.some(message=>message.role==='assistant'),false)
  if(title.startsWith('读取')){
   assert.equal(step.workerMode,'read')
   assert.equal(step.parallelReadOnly,true)
   started.push(title)
   if(started.length===2)release()
   await Promise.race([barrier,new Promise((_,reject)=>setTimeout(()=>reject(new Error('read workers did not overlap')),1000))])
  }else assert.deepEqual(finished.sort(),['读取模块 A','读取模块 B'])
  finished.push(title);step.onOutcome('complete')
 })
 assert.deepEqual(started.sort(),['读取模块 A','读取模块 B'])
 assert.equal(items.at(-1).status,'complete')
 assert.equal(items.filter(item=>item.parentId).every(item=>item.worker?.mode==='read'),true)
 assert.equal(readWorkerBatch(readyTaskItems(f.plan)).length,0)
})

test('approval mode serializes read workers so prompts cannot overlap',async()=>{
 const items=parseTaskItems(JSON.stringify({steps:[{title:'汇总',acceptance:'完成',children:[{title:'读取 A',acceptance:'完成 A',mode:'read',parallel:true},{title:'读取 B',acceptance:'完成 B',mode:'read',parallel:true}]}]}))
 const f=fixture(items);f.options.approvalMode='ask'
 let active=0,maxActive=0
 await runTaskPlan(f.options,f.execution,async step=>{
  active++;maxActive=Math.max(maxActive,active)
  await new Promise(resolve=>setTimeout(resolve,5))
  active--;step.onOutcome('complete')
 })
 assert.equal(maxActive,1)
})

test('read worker cannot receive editing or command capabilities',()=>{
 const capability=name=>({name,source:{type:'skill',skillId:'agent-tools'},tags:[]})
 const options={filesEnabled:true,webEnabled:true,workerMode:'read'}
 assert.equal(chatCapabilityAllowed(capability('agent.read_file'),options),true)
 assert.equal(chatCapabilityAllowed(capability('agent.write_file'),options),false)
 assert.equal(chatCapabilityAllowed(capability('agent.run_command'),options),false)
 assert.equal(chatCapabilityAllowed(capability('agent.web_search'),{...options,parallelReadOnly:true}),false)
 assert.equal(chatCapabilityAllowed(capability('agent.read_file'),{...options,parallelReadOnly:true}),true)
})

test('a write subagent cannot change files outside its assigned scope',async()=>{
 const items=parseTaskItems(JSON.stringify({steps:[{key:'edit',title:'修改模块 A',acceptance:'模块 A 更新',mode:'write',fileScope:['src/a.js']}]}))
 const f=fixture(items)
 await runTaskPlan(f.options,f.execution,async step=>{
  assert.equal(step.workerMode,'write')
  assert.match(await step.beforeMutation({name:'agent.write_file'},{path:'src/b.js'}),/超出已分配文件范围/)
  step.onOutcome('blocked')
 })
 assert.equal(items[0].status,'blocked')
 assert.equal(items[0].worker.id,'worker-'+items[0].id)
})

test('a write subagent cannot leave its scope through a symbolic link',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-task-scope-'))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 fs.mkdirSync(path.join(root,'src'))
 fs.mkdirSync(path.join(root,'outside'))
 fs.symlinkSync(path.join(root,'outside'),path.join(root,'src','alias'))
 const items=parseTaskItems(JSON.stringify({steps:[{title:'修改源码',acceptance:'源码已更新',mode:'write',fileScope:['src']}]}))
 const f=fixture(items);f.options.workspace=root;f.plan.workspace=root
 await runTaskPlan(f.options,f.execution,async step=>{
  assert.match(await step.beforeMutation({name:'agent.write_file'},{path:'src/alias/new.js'}),/超出已分配文件范围/)
  step.onOutcome('blocked')
 })
 assert.equal(fs.existsSync(path.join(root,'outside','new.js')),false)
})

test('saved graph resumes after a completed child without replaying it',async()=>{
 const items=parseTaskItems(JSON.stringify({steps:[{title:'汇总',acceptance:'全部完成',children:[{title:'读取 A',acceptance:'完成 A',mode:'read',parallel:true},{title:'读取 B',acceptance:'完成 B',mode:'read',parallel:true}]}]}))
 items[0].status='complete';items[0].summary='已读取 A'
 const f=fixture(items),ran=[]
 await runTaskPlan(f.options,f.execution,async step=>{ran.push(step.currentStep.title);step.onOutcome('complete')})
 assert.deepEqual(ran,['读取 B','汇总'])
})

test('advice-only fallback removes stale child links from a saved graph',async()=>{
 const items=parseTaskItems(JSON.stringify({steps:[{title:'梳理项目可优化项',acceptance:'列出优化建议',children:[{title:'读取源码',acceptance:'取得源码资料',mode:'read'}]}]}))
 const f=fixture(items)
 f.plan.scope={goal:'项目还可以怎么优化',kind:'general',required:['项目还可以怎么优化'],optional:[]}
 let saved
 f.execution.save=plan=>{saved=plan}
 await runTaskPlan(f.options,f.execution,async step=>step.onOutcome('complete'))
 assert.equal(saved.items.length,1)
 assert.equal(saved.items[0].childIds,undefined)
 assert.equal(saved.items[0].worker,undefined)
 assert.equal(saved.items[0].status,'complete')
})

test('parent verification inherits completed child edits and evidence',async()=>{
 const items=parseTaskItems(JSON.stringify({steps:[{title:'实现并核验功能',acceptance:'子项结果已整合',children:[{title:'修改源码',acceptance:'功能已写入',mode:'write'}]}]}))
 items[0].status='complete';items[0].modifiedFiles=['src/feature.js'];items[0].evidenceIds=['child-edit']
 const f=fixture(items)
 await runTaskPlan(f.options,f.execution,async step=>{
  assert.equal(step.currentStep.implementationChanged,true)
  assert.deepEqual(step.currentStep.implementationPaths,['src/feature.js'])
  step.onOutcome('complete')
 })
 assert.equal(items[1].status,'complete')
 assert.ok(items[1].evidenceIds.includes('child-edit'))
})

test('parent verification does not claim edits from an unrelated completed branch',async()=>{
 const items=parseTaskItems(JSON.stringify({steps:[
  {title:'修改独立模块',acceptance:'独立模块已更新',mode:'write'},
  {title:'核对资料',acceptance:'读取结果完整',children:[{title:'读取说明',acceptance:'说明已读取',mode:'read'}]}
 ]}))
 items[0].status='complete';items[0].modifiedFiles=['src/unrelated.js']
 items[1].status='complete'
 const f=fixture(items)
 await runTaskPlan(f.options,f.execution,async step=>{
  assert.equal(step.currentStep.implementationChanged,false)
  assert.deepEqual(step.currentStep.implementationPaths,[])
  step.onOutcome('complete')
 })
})

test('a resumed subagent keeps its tool budget and stops before replay',async()=>{
 const items=parseTaskItems(JSON.stringify({steps:[{title:'读取源码',acceptance:'内容已确认',mode:'read'}]}))
 items[0].worker={id:'worker-'+items[0].id,mode:'read',assignedAt:'2026-10-15',maxRounds:8,maxToolCalls:2,toolCalls:2}
 items[0].status='blocked'
 const f=fixture(items)
 await runTaskPlan(f.options,f.execution,async()=>assert.fail('exhausted worker must not call model'))
 assert.equal(items[0].status,'blocked')
 assert.match(items[0].summary,/工具调用已达到/)
})
