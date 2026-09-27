import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {parseVerificationRules,prepareVerificationRules,validateRuleRepair} from '../dist-electron/main/agent/core/verification-rules.js'
import {parseTaskItems,runTaskPlan} from '../dist-electron/main/agent/core/task-plan-runner.js'

test('equivalent model formats normalize without dropping conditions',()=>{
 assert.deepEqual(parseVerificationRules({type:'file_contains',path:'index.html',contains:'ready'}),[{kind:'file',path:'index.html',contains:'ready'}])
 assert.deepEqual(parseVerificationRules([{kind:'typecheck',path:'.'},{kind:'command',command:'npm run test:unit'},{type:'test_script',script:'npm test'}]),[{kind:'diagnostics',checker:'auto',path:'.'},{kind:'test',script:'test:unit'},{kind:'test',script:'test'}])
 assert.deepEqual(parseVerificationRules(null),[])
 for(const rule of [
  {kind:'command',command:'npm run test && echo unexpected'},
  {kind:'command',command:'npm test -- --update'},
  {kind:'command',command:'node script.js'},
  {kind:'file',path:'a',exists:false},
  {kind:'file',path:'a',contains:'x',notContains:'y'},
  {kind:'file_contains',path:'a'},
  {kind:'file',type:'test',path:'a'},
  {kind:'diagnostics',checker:'auto|typescript|python'}
 ])assert.throws(()=>parseVerificationRules([rule]))
 assert.throws(()=>parseVerificationRules([{kind:'constructor'}]),/不支持的 kind/)
})

test('invalid rules preserve the task and original data as a repairable configuration problem',()=>{
 const input=[{kind:'http',url:'http://localhost:8080'}]
 const prepared=prepareVerificationRules(input)
 assert.deepEqual(prepared.verification,[])
 assert.deepEqual(prepared.verificationProblem.input,input)
 const items=parseTaskItems(JSON.stringify({steps:[{title:'核验页面',acceptance:'页面能访问',verification:input}]}))
 assert.equal(items[0].status,'pending');assert.equal(items[0].title,'核验页面')
 assert.match(items[0].verificationProblem.message,/第 1 条/)
})

test('rule repair cannot weaken known checks or silently drop unsupported requirements',()=>{
 const known={kind:'file',path:'a',contains:'required'},unknown={kind:'diagnostics',checker:'auto|typescript|python'}
 for(const candidate of [[],[known],[{kind:'file',path:'a'},{kind:'diagnostics',checker:'auto'}]])assert.throws(()=>validateRuleRepair([known,unknown],candidate))
 assert.deepEqual(validateRuleRepair([known,unknown],[known,{kind:'diagnostics',checker:'auto'}]),[known,{kind:'diagnostics',checker:'auto'}])
})

async function withModel(t,answer,work){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-rule-repair-')),requests=[]
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const server=createServer(async(req,res)=>{
  try{
   let text='';for await(const chunk of req)text+=chunk
   const request=JSON.parse(text);requests.push(request)
   const value=answer(request,requests.length)
   res.setHeader('content-type','application/json')
   res.end(JSON.stringify({choices:[value?.rawChoice||{finish_reason:'stop',message:{role:'assistant',content:typeof value==='string'?value:JSON.stringify(value)}}]}))
  }catch(error){res.statusCode=500;res.end(String(error))}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const saved=[],contents=[],outcomes=[],activities=[]
 const options={workspace:root,connection:{endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',maxTokens:2048,contextLength:8192},model:'test',messages:[],signal:new AbortController().signal,onContent:text=>contents.push(text),onOutcome:value=>outcomes.push(value),onActivity:a=>activities.push(a),onRequest(){},onUsage(){}}
 try{await work({root,options,requests,saved,contents,outcomes,activities,execution:{taskId:'task',save:p=>saved.push(p)}})}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
}
const pass=async rules=>rules.map(rule=>({rule,passed:true,summary:'verified',fingerprint:'pass'}))
const invalid={kind:'diagnostics',checker:'auto|typescript|python'}

test('generated plan is saved before repairing only its invalid item; execution follows repaired rules',async t=>{
 await withModel(t,(_,n)=>n===1?{steps:[{title:'检查文件',acceptance:'检查通过',verification:[invalid]}]}:{verification:[{kind:'diagnostics',checker:'auto'}]},async f=>{
  let calls=0
  await runTaskPlan(f.options,f.execution,async step=>{calls++;assert.equal(f.saved.at(-1).items[0].verificationProblem,undefined);step.onOutcome('complete')},pass)
  assert.equal(f.requests.length,2);assert.equal(calls,1)
  assert.ok(f.requests.every(request=>request.tools===undefined))
  assert.ok(f.saved.some(plan=>plan.items[0].verificationProblem?.attempts===0))
  const final=f.saved.at(-1).items[0]
  assert.equal(final.status,'complete');assert.equal(final.verificationRepairs.length,1)
  assert.deepEqual(final.verificationRepairs[0].input,[invalid])
  assert.match(f.requests[0].messages[0].content,/"checker":"auto"/)
  assert.doesNotMatch(f.requests[0].messages[0].content,/"checker":"auto\|typescript\|python"/)
 })
})

test('two failed schema repairs save progress, never execute partial rules, and do not repeat on resume',async t=>{
 await withModel(t,()=>({verification:[]}),async f=>{
  const rows=parseTaskItems(JSON.stringify({steps:[{title:'已完成项',acceptance:'有证据'},{title:'当前项',acceptance:'类型检查通过',verification:[invalid]},{title:'后续项',acceptance:'稍后'}]}))
  rows[0].status='complete';rows[0].evidenceIds=['old-evidence']
  const plan={taskId:'task',workspace:f.root,items:rows,editProgress:{files:{previous:['a','b']},ineffective:0},updatedAt:''}
  await runTaskPlan(f.options,{...f.execution,plan},async()=>assert.fail('invalid item must not execute'),()=>assert.fail('partial verification must not execute'))
  assert.equal(f.requests.length,2);assert.equal(f.outcomes.at(-1),'needs_input')
  assert.equal(plan.items[1].status,'blocked');assert.equal(plan.items[2].status,'pending')
  assert.deepEqual(plan.items[0].evidenceIds,['old-evidence'])
  const restored=JSON.parse(JSON.stringify(f.saved.at(-1)))
  await runTaskPlan(f.options,{...f.execution,plan:restored},async()=>assert.fail(),()=>assert.fail())
  assert.equal(f.requests.length,2);assert.deepEqual(restored.editProgress,plan.editProgress)
  assert.match(f.contents.at(-1),/已完成步骤不会重做/)
 })
})

test('repair rejects altered valid conditions, then accepts a corrected rule set',async t=>{
 const known={kind:'file',path:'app.ts',contains:'required'}
 await withModel(t,(_,n)=>({verification:[n===1?{kind:'file',path:'app.ts'}:known,{kind:'diagnostics',checker:'auto'}]}),async f=>{
  const plan={taskId:'task',workspace:f.root,items:parseTaskItems(JSON.stringify({steps:[{title:'检查代码',acceptance:'断言满足',verification:[known,invalid]}]})),updatedAt:''}
  await runTaskPlan(f.options,{...f.execution,plan},async step=>step.onOutcome('complete'),pass)
  assert.equal(f.requests.length,2);assert.equal(plan.items[0].status,'complete')
  assert.match(plan.items[0].verificationRepairs[0].error,/改变了原有/)
  assert.deepEqual(plan.items[0].verification[0],known)
 })
})

test('legacy saved aliases normalize in place without replanning completed work',async t=>{
 await withModel(t,()=>assert.fail('no model request for equivalent syntax'),async f=>{
  const plan={taskId:'task',workspace:f.root,updatedAt:'',items:[{id:'stable-id',title:'检查',acceptance:'文件存在',verification:{type:'file_exists',path:'index.html'},status:'pending',attempts:0,summary:'',evidenceIds:[]}]}
  await runTaskPlan(f.options,{...f.execution,plan},async step=>step.onOutcome('complete'),pass)
  assert.equal(f.requests.length,0);assert.equal(plan.items[0].id,'stable-id')
  assert.deepEqual(plan.items[0].verification,[{kind:'file',path:'index.html'}])
 })
})

test('invalid rule inferred after tool failure is repaired without replaying the model work',async t=>{
 await withModel(t,()=>({verification:[{kind:'diagnostics',checker:'auto'}]}),async f=>{
  const plan={taskId:'task',workspace:f.root,updatedAt:'',items:parseTaskItems(JSON.stringify({steps:[{title:'检查现有文件',acceptance:'诊断通过'}]}))}
  let calls=0
  await runTaskPlan(f.options,{...f.execution,plan},async step=>{
   calls++;step.onVerificationFailure({id:'failed-check',capability:'agent.get_diagnostics',args:{checker:'auto|typescript|python'},status:'error'})
   step.onOutcome('blocked')
  },pass)
  assert.equal(calls,1);assert.equal(plan.items[0].status,'complete');assert.equal(f.requests.length,1)
 })
})

test('invented test scripts are not accepted by schema recovery',async t=>{
 await withModel(t,()=>({verification:[{kind:'test',script:'test:invented'}]}),async f=>{
  const plan={taskId:'task',workspace:f.root,updatedAt:'',items:parseTaskItems(JSON.stringify({steps:[{title:'检查',acceptance:'通过',verification:[invalid]}]}))}
  await runTaskPlan(f.options,{...f.execution,plan},async()=>assert.fail(),()=>assert.fail())
  assert.equal(f.requests.length,2);assert.equal(plan.items[0].status,'blocked')
  assert.match(plan.items[0].verificationProblem.message,/未定义/)
 })
})

test('truncated correction is discarded even when its JSON looks complete',async t=>{
 const corrected={verification:[{kind:'diagnostics',checker:'auto'}]}
 await withModel(t,(_,n)=>n===1?{rawChoice:{finish_reason:'length',message:{role:'assistant',content:JSON.stringify(corrected)}}}:corrected,async f=>{
  const plan={taskId:'task',workspace:f.root,updatedAt:'',items:parseTaskItems(JSON.stringify({steps:[{title:'检查',acceptance:'通过',verification:[invalid]}]}))}
  let calls=0
  await runTaskPlan(f.options,{...f.execution,plan},async step=>{assert.equal(f.requests.length,2);calls++;step.onOutcome('complete')},pass)
  assert.equal(calls,1);assert.match(plan.items[0].verificationRepairs[0].error,/截断|输出/)
  assert.equal(plan.items[0].verificationRepairs[0].output,undefined)
 })
})

test('interrupted correction preserves its retry budget and resumes before any work',async t=>{
 await withModel(t,()=>({verification:[{kind:'diagnostics',checker:'auto'}]}),async f=>{
  const plan={taskId:'task',workspace:f.root,updatedAt:'',items:parseTaskItems(JSON.stringify({steps:[{title:'检查',acceptance:'通过',verification:[invalid]}]}))}
  const controller=new AbortController()
  await assert.rejects(runTaskPlan({...f.options,signal:controller.signal,onRequest:()=>controller.abort(new Error('cancelled'))},{...f.execution,plan},async()=>assert.fail(),pass),/cancelled/)
  assert.equal(f.saved.at(-1).items[0].verificationProblem.attempts,1)
  const restored=JSON.parse(JSON.stringify(f.saved.at(-1)))
  restored.items[0].status='blocked'
  await runTaskPlan(f.options,{...f.execution,plan:restored},async step=>{assert.equal(f.saved.at(-1).items[0].baseline.passed,true);step.onOutcome('complete')},pass)
  assert.equal(restored.items[0].status,'complete');assert.equal(restored.items[0].verificationRepairs.length,2)
 })
})
