import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {parseVerificationRules,verifyTaskRules,discoverVerificationRules,processResultFailed} from '../dist-electron/main/agent/core/task-verification.js'
import {runTaskPlan,parseTaskItems} from '../dist-electron/main/agent/core/task-plan-runner.js'

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-verification-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node check.cjs'}}))
 fs.writeFileSync(path.join(root,'check.cjs'),`const fs=require('fs');if(fs.readFileSync('value.txt','utf8')!=='correct'){console.error('value must equal correct');process.exitCode=1}`)
 fs.writeFileSync(path.join(root,'value.txt'),'wrong')
 const activities=[],saved=[],outputs=[],state={calls:0,approvals:0}
 const options={workspace:root,filesEnabled:true,webEnabled:true,approvalMode:'ask',messages:[],signal:new AbortController().signal,onActivity:a=>activities.push(a),onContent:t=>outputs.push(t),onOutcome:()=>{},approve:async()=>{state.approvals++;return true}}
 const cap={name:'agent.run_test',source:{type:'skill',skillId:'agent-tools'},runtime:'python-native',tags:['requires-approval'],parameters:{type:'object',properties:{script:{type:'string'},timeoutSeconds:{type:'integer'}},required:['script']}}
 const registry={list:()=>[cap],execute:async()=>{state.calls++;const result=spawnSync(process.execPath,['check.cjs'],{cwd:root,encoding:'utf8',windowsHide:true});return {success:true,output:{exitCode:result.status,output:result.stdout+result.stderr,diagnostics:result.status?[{path:'value.txt',message:'value must equal correct'}]:[],truncated:false}}}}
 const plan={taskId:'one',workspace:root,items:parseTaskItems(JSON.stringify({steps:[{title:'修复数据',acceptance:'指定测试通过',verification:[{kind:'test',script:'test'}]}]})),updatedAt:''}
 const execution={taskId:'one',plan,save:p=>saved.push(p)}
 return {root,options,registry,plan,execution,state,activities,saved,outputs}
}
async function edit(step,root,content,file='value.txt'){
 const args={path:file,content}
 assert.equal(await step.beforeMutation({name:'agent.write_file'},args),undefined)
 const before=fs.existsSync(path.join(root,file))?fs.readFileSync(path.join(root,file),'utf8'):undefined
 fs.writeFileSync(path.join(root,file),content)
 step.onActivity({id:'edit-'+content,capability:'agent.write_file',args,status:'complete',fileChanges:[{path:file,before,after:content}]})
}
test('only bounded file/script/diagnostic rules are accepted',()=>{
 assert.throws(()=>parseVerificationRules([{kind:'command',command:'anything'}]))
 assert.throws(()=>parseVerificationRules([{kind:'test',script:'test && echo injected'}]))
 assert.throws(()=>parseVerificationRules(Array(5).fill({kind:'file',path:'file'})))
 assert.equal(processResultFailed('agent.run_test',{exitCode:1}),true)
 assert.equal(processResultFailed('agent.run_test',{exitCode:0}),false)
})
test('file validation uses actual contents and respects path and file permissions',async t=>{
 const f=fixture(t)
 assert.deepEqual(discoverVerificationRules(f.root),[{kind:'test',script:'test'}])
 const rules=[{kind:'file',path:'value.txt',contains:'correct'}]
 assert.equal((await verifyTaskRules(f.registry,f.options,rules))[0].passed,false)
 fs.writeFileSync(path.join(f.root,'value.txt'),'correct')
 assert.equal((await verifyTaskRules(f.registry,f.options,rules))[0].passed,true)
 assert.equal((await verifyTaskRules(f.registry,{...f.options,filesEnabled:false},rules))[0].blocked,true)
 assert.equal((await verifyTaskRules(f.registry,f.options,[{kind:'file',path:'../outside'}]))[0].blocked,true)
})
test('failed command exit code fails acceptance; rejection never executes a command',async t=>{
 const f=fixture(t),rules=[{kind:'test',script:'test'}]
 const failed=await verifyTaskRules(f.registry,f.options,rules)
 assert.equal(failed[0].passed,false);assert.match(failed[0].summary,/退出码 1/)
 assert.equal(f.state.approvals,1)
 const denied=await verifyTaskRules(f.registry,{...f.options,approve:async()=>false},rules)
 assert.equal(denied[0].blocked,true);assert.equal(f.state.calls,1)
 const missing=await verifyTaskRules(f.registry,f.options,[{kind:'test',script:'test:missing'}])
 assert.equal(missing[0].blocked,true);assert.equal(f.state.calls,1)
})
test('real failing test triggers a local repair and second verification before completion',async t=>{
 const f=fixture(t);let modelCalls=0
 await runTaskPlan(f.options,f.execution,async step=>{
  modelCalls++
  assert.equal(f.saved.at(-1).items[0].baseline.passed,false,'baseline is persisted before the first model edit')
  if(modelCalls===2)assert.match(step.stateContext,/value must equal correct/)
  await edit(step,f.root,modelCalls===2?'correct':'still wrong')
  step.onContent('模型声称完成');step.onOutcome('complete')
 },rules=>verifyTaskRules(f.registry,f.options,rules))
 assert.equal(modelCalls,2);assert.equal(f.state.calls,3)
 const item=f.saved.at(-1).items[0]
 assert.equal(item.status,'complete');assert.equal(item.repairAttempts,1)
 assert.deepEqual(item.verificationRuns.map(run=>run.passed),[false,true])
 assert.equal(item.verificationRuns[0].comparison.failures[0].origin,'existing')
 assert.equal(item.verificationRuns[1].comparison.resolved.length,1)
 assert.ok(f.outputs.at(-1).includes('程序验收通过'))
})
test('identical failure stops after one repair and resume rechecks without repeating modifications',async t=>{
 const f=fixture(t);let modelCalls=0
 await runTaskPlan(f.options,f.execution,async step=>{modelCalls++;await edit(step,f.root,'still wrong '+modelCalls);step.onOutcome('complete')},rules=>verifyTaskRules(f.registry,f.options,rules))
 assert.equal(modelCalls,2);assert.equal(f.plan.items[0].status,'blocked')
 assert.match(f.plan.items[0].summary,/相同失败/)
 const restored=JSON.parse(JSON.stringify(f.saved.at(-1)))
 fs.writeFileSync(path.join(f.root,'value.txt'),'correct')
 await runTaskPlan(f.options,{...f.execution,plan:restored},async()=>assert.fail('resume must verify before replaying modifications'),rules=>verifyTaskRules(f.registry,f.options,rules))
 assert.equal(restored.items[0].status,'complete')
})
test('different failures still stop after two repairs, including after restart',async t=>{
 const f=fixture(t);let modelCalls=0,checks=0
 const verify=async rules=>rules.map(rule=>{checks++;return {rule,passed:checks===1,summary:'failure '+checks,fingerprint:'f'+checks,issues:checks===1?[]:[{key:'f'+checks,category:'code',message:'failure '+checks}]}})
 await runTaskPlan(f.options,f.execution,async step=>{modelCalls++;step.onOutcome('complete')},verify)
 assert.equal(modelCalls,3);assert.equal(f.plan.items[0].repairAttempts,2)
 const restored=JSON.parse(JSON.stringify(f.saved.at(-1)))
 await runTaskPlan(f.options,{...f.execution,plan:restored},async()=>assert.fail('repair budget must survive restart'),verify)
 assert.equal(restored.items[0].repairAttempts,2);assert.equal(restored.items[0].status,'blocked')
})
test('edits without runnable acceptance stay unconfirmed instead of trusting model completion',async t=>{
 const f=fixture(t);f.plan.items[0].verification=[];fs.unlinkSync(path.join(f.root,'package.json'))
 let outcome
 await runTaskPlan({...f.options,onOutcome:value=>outcome=value},f.execution,async step=>{
  step.onActivity({id:'edit',capability:'agent.write_file',args:{path:'value.txt',content:'correct'},status:'complete',fileChanges:[{path:'value.txt',before:'wrong',after:'correct'}]})
  step.onOutcome('complete');step.onContent('模型声称完成')
 },()=>assert.fail('no rule should run'))
 assert.equal(outcome,'needs_input');assert.equal(f.plan.items[0].status,'blocked')
 assert.equal(f.plan.items[0].repairAttempts,undefined)
})

test('discover a script immediately before the first write, after preliminary reads',async t=>{
 const f=fixture(t);f.plan.items[0].verification=[]
 await runTaskPlan(f.options,f.execution,async step=>{
  assert.equal(f.state.calls,0)
  await edit(step,f.root,'correct')
  assert.equal(f.state.calls,1)
  assert.equal(f.saved.at(-1).items[0].baseline.results[0].passed,false)
  step.onOutcome('complete')
 },rules=>verifyTaskRules(f.registry,f.options,rules))
 assert.equal(f.state.calls,2);assert.equal(f.plan.items[0].status,'complete')
})

test('unrelated pre-existing failures are recorded without starting a repair loop',async t=>{
 const f=fixture(t);let calls=0
 await runTaskPlan(f.options,f.execution,async step=>{calls++;await edit(step,f.root,'feature','other.txt');step.onOutcome('complete')},rules=>verifyTaskRules(f.registry,f.options,rules))
 assert.equal(calls,1);assert.equal(f.plan.items[0].repairAttempts,undefined)
 assert.match(f.plan.items[0].summary,/原有 1/)
 assert.equal(fs.readFileSync(path.join(f.root,'value.txt'),'utf8'),'wrong')
})

test('baseline denial prevents writes; explicit resume rechecks environment and preserves evidence',async t=>{
 const f=fixture(t)
 await runTaskPlan(f.options,f.execution,async()=>assert.fail('denied baseline must not start edits'),rules=>verifyTaskRules(f.registry,{...f.options,approve:async()=>false},rules))
 assert.equal(f.state.calls,0);assert.equal(f.plan.items[0].status,'blocked')
 const restored=JSON.parse(JSON.stringify(f.saved.at(-1)))
 await runTaskPlan(f.options,{...f.execution,plan:restored},async step=>{await edit(step,f.root,'correct');step.onOutcome('complete')},rules=>verifyTaskRules(f.registry,f.options,rules))
 assert.equal(restored.items[0].status,'complete');assert.equal(restored.items[0].baselineHistory.length,1)
 assert.equal(restored.items[0].baselineHistory[0].results[0].blocked,true)
})

test('environmental failure after a passing baseline preserves code without repair attempts',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'value.txt'),'correct');let calls=0
 await runTaskPlan(f.options,f.execution,async step=>{
  calls++;await edit(step,f.root,'feature','other.txt')
  f.registry.execute=async()=>({success:true,output:{exitCode:1,output:'Error: ECONNREFUSED 127.0.0.1:9000'}})
  step.onOutcome('complete')
 },rules=>verifyTaskRules(f.registry,f.options,rules))
 assert.equal(calls,1);assert.equal(f.plan.items[0].repairAttempts,undefined)
 assert.match(f.plan.items[0].summary,/环境检查未通过/)
 assert.equal(fs.readFileSync(path.join(f.root,'other.txt'),'utf8'),'feature')
})

test('old interrupted items cannot label post-edit state as a pre-change baseline',async t=>{
 const f=fixture(t);f.plan.items[0].status='blocked';let calls=0
 await runTaskPlan(f.options,f.execution,async step=>{calls++;assert.match(step.stateContext,/不能作为修改前基线/);step.onOutcome('complete')},rules=>verifyTaskRules(f.registry,f.options,rules))
 assert.equal(calls,1);assert.equal(f.state.calls,1)
 assert.equal(f.plan.items[0].baseline,undefined);assert.equal(f.plan.items[0].repairAttempts,undefined)
 assert.equal(f.plan.items[0].verificationRuns[0].comparison.failures[0].origin,'unknown')
})
