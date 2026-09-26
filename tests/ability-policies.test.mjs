import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { AbilityModuleManager } from '../dist-electron/main/ability-modules/manager.js'
import { AbilityPolicyRuntime } from '../dist-electron/main/ability-modules/policy-runtime.js'
import { policyContracts } from '../dist-electron/main/ability-modules/policies.js'
import { selectionContract } from '../dist-electron/main/ability-modules/selection.js'
import { routerContract } from '../dist-electron/main/ability-modules/routing.js'
import { AbilityCatalogService } from '../dist-electron/main/ability-modules/catalog.js'
import { kernelIds } from '../dist-electron/main/ability-modules/kernel-checks.js'
import { runCoreChat } from '../dist-electron/main/agent/core/chat-runner.js'
import { AgentPlanner } from '../dist-electron/main/agent/core/agent-planner.js'

function fixture(t, generate) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-policies-'))
  const managers=new Map(policyContracts.map(contract=>[contract.id,new AbilityModuleManager(path.join(root,contract.id),generate,contract)]))
  managers.set('conversation-state',new AbilityModuleManager(path.join(root,'conversation-state')))
  managers.set('state-context-selection',new AbilityModuleManager(path.join(root,'state-context-selection'),undefined,selectionContract))
  managers.set('task-message-router',new AbilityModuleManager(path.join(root,'task-message-router'),undefined,routerContract))
  for(const manager of managers.values())manager.setPolicy({...manager.snapshot().policy,autoOptimize:false})
  const runtime=new AbilityPolicyRuntime(managers),catalog=new AbilityCatalogService(managers,undefined,root)
  t.after(()=>{for(const manager of managers.values())manager.dispose();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true})})
  return {root,managers,runtime,catalog}
}

test('six-stage acceptance persists immutable reports, pins versions and rejects overlapping runs', async t => {
  const { root, managers } = fixture(t)
  const catalog = new AbilityCatalogService(managers, undefined, root)
  const pending = catalog.runAcceptance()
  await assert.rejects(catalog.runAcceptance(), /正在进行/)
  const first = await pending
  assert.equal(first.modules.length, 18)
  assert.equal(new Set(first.modules.map(m => m.stageId)).size, 6)
  assert.ok(first.modules.every(m => m.tests.length && m.tests.every(result => result.passed)))
  const stored = fs.readFileSync(path.join(root,'acceptance',`${first.id}.json`),'utf8')
  const second = await catalog.runAcceptance()
  assert.notEqual(first.id, second.id)
  assert.equal(fs.readFileSync(path.join(root,'acceptance',`${first.id}.json`),'utf8'),stored)
  assert.equal(new AbilityCatalogService(managers,undefined,root).acceptanceHistory().length,2)
  const manager = managers.get('model-adapter')
  const example = manager.snapshot().feedbackExample
  manager.reportFeedback('更低的工具预算', example.input, {result:{maxTokens:1024,temperature:0.2,toolLimit:8}})
  const third = await catalog.runAcceptance()
  const before = first.modules.find(m=>m.moduleId==='model-adapter'), after = third.modules.find(m=>m.moduleId==='model-adapter')
  assert.notEqual(before.suiteHash,after.suiteHash)
  assert.ok(after.tests.some(result=>!result.passed))
})
for(const contract of policyContracts)test(`${contract.id}: dedicated acceptance, rejected unsafe output and independent source`,async t=>{
  const {managers}=fixture(t),manager=managers.get(contract.id)
  const report=await manager.test('bundled-v1')
  assert.equal(report.passed,true,JSON.stringify(report.tests))
  assert.ok(report.tests.length>=2)
  assert.throws(()=>contract.validateOutput({result:{grantAll:true}},contract.cases[0].input))
  const version=manager.saveVersion('bundled-v1','function process(){return {result:{grantAll:true}}}','越界候选不能发布')
  await assert.rejects(manager.activate(version.id),/回归/)
  assert.equal(manager.snapshot().activeId,'bundled-v1')
  assert.equal(manager.snapshot().versions.length,2)
})

test('permission, budget, provenance and completion invariants reject structurally valid bypasses',()=>{
  const contracts=new Map(policyContracts.map(contract=>[contract.id,contract]))
  const reject=(id,data,result)=>assert.throws(()=>contracts.get(id).validateOutput({result},{messages:[],data}))
  reject('tool-selection',{tools:[{id:'read',text:'read'}],limit:1},{ids:['delete']})
  reject('tool-selection',{tools:[{id:'read',text:'read'}],limit:2},{ids:['read','read']})
  reject('history-memory',{candidates:[],limit:1},{ids:['fake']})
  reject('model-adapter',{capacity:4096,maxTokens:1024,temperature:.2,toolCount:1},{maxTokens:2048,temperature:.2,toolLimit:8})
  reject('context-compaction',{capacity:4096,usageRatio:.9},{triggerRatio:.99,retainRecent:1})
  reject('error-recovery',{stagnant:6,continuations:0,invalidCalls:0,denied:false},{action:'continue',reason:'无限重试'})
  reject('completion-review',{status:'blocked',reason:'失败',nextStep:'',candidate:'完成',unresolvedFailures:1,denied:false},{status:'complete',reason:'假成功',nextStep:''})
  reject('clarification-policy',{missing:['文件路径']},{ask:false,question:''})
  reject('task-planner',{maxSteps:2},{steps:[{title:'写入',dependsOn:[0]}]})
})

test('policy optimization uses module-specific feedback, pins a turn version and restores across restart',async t=>{
  const definition=policyContracts.find(contract=>contract.id==='context-compaction')
  const improved=definition.baseline.replace('retainRecent:input.data.capacity<8192?2:4','retainRecent:input.data.capacity<8192?2:input.data.usageRatio>.9?6:4')
  const {root,managers,runtime}=fixture(t,async()=>JSON.stringify({cause:'module',diagnosis:'高占用时保留更多近期记录',code:improved}))
  const manager=managers.get('context-compaction'),data={capacity:32768,usageRatio:.95}
  assert.equal((await runtime.invoke('context-compaction',data)).retainRecent,4)
  manager.reportFeedback('保留近期记录',{messages:[],data},{result:{triggerRatio:.8,retainRecent:6}})
  manager.optimize()
  let job;const deadline=Date.now()+20000
  do{await new Promise(resolve=>setTimeout(resolve,25));job=manager.snapshot().jobs[0]}while(['queued','analyzing','testing'].includes(job.phase)&&Date.now()<deadline)
  assert.equal(job.phase,'complete',job.message)
  assert.equal(manager.snapshot().activeId,job.candidateId,job.message)
  assert.equal((await runtime.invoke('context-compaction',data)).retainRecent,4,'running turn remains pinned')
  assert.equal((await runtime.fork().invoke('context-compaction',data)).retainRecent,6,'next turn uses published candidate')
  const before=manager.snapshot();manager.dispose()
  const restored=new AbilityModuleManager(path.join(root,'context-compaction'),undefined,definition)
  t.after(()=>restored.dispose())
  assert.deepEqual(restored.snapshot(),before)
  assert.equal(managers.get('model-adapter').snapshot().versions.length,1)
})

test('all six protected kernels have executable checks and immutable source archives',async t=>{
  const {catalog}=fixture(t)
  assert.equal(catalog.list().modules.filter(module=>module.mode==='managed').length,12)
  assert.equal(catalog.list().modules.filter(module=>module.mode==='builtin'&&module.protected).length,6)
  for(const id of kernelIds){
    const report=await catalog.check(id)
    assert.equal(report.passed,true,JSON.stringify(report))
    const detail=catalog.details(id)
    assert.equal(detail.kernelReports[0].id,report.id)
    const archived=catalog.archive(id,detail.archives[0].snapshotId)
    assert.ok(archived.sources.length)
    assert.deepEqual(archived.missingSources,[])
    assert.throws(()=>catalog.managed(id),/尚未接入/)
  }
  await assert.rejects(catalog.check('tool-selection'),/不是受保护/)
  assert.throws(()=>catalog.archive('sandbox-runtime','../../escape'),/无效/)
})

async function modelServer(t, responder) {
  const requests=[]
  const server=createServer(async(request,response)=>{
    let body='';for await(const part of request)body+=part
    const value=JSON.parse(body);requests.push(value)
    const answer=await responder(value,requests.length)
    response.setHeader('content-type','application/json')
    response.end(JSON.stringify({choices:[{finish_reason:answer.tool_calls?'tool_calls':'stop',message:answer}]}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>server.close(resolve)))
  return {requests,connection:{endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',contextLength:8192,maxTokens:1024}}
}
const options=(connection,runtime,query='读取数据；生成图表')=>({connection,model:'test',messages:[{role:'user',content:query}],workspace:os.tmpdir(),filesEnabled:false,webEnabled:false,approvalMode:'ask',signal:new AbortController().signal,abilityPolicies:runtime,approve:async()=>false,onContent(){},onReasoning(){},onRequest(){},onUsage(){},onActivity(){}})

test('small-context chat keeps search and page reading through ranking while respecting the network toggle',async t=>{
  const {runtime}=fixture(t)
  const manifest=JSON.parse(fs.readFileSync(new URL('../skills/agent-tools/skill.json',import.meta.url),'utf8'))
  const capabilities=manifest.capabilities.tools.map(tool=>({name:`agent.${tool.name}`,description:tool.description,category:'agent',parameters:{type:'object',properties:{query:{type:'string'}}},source:{type:'skill',skillId:'agent-tools'},tags:[],runtime:'python-native'}))
  for(const name of ['browser.open','browser.read_page'])capabilities.push({name,description:name,category:'browser',parameters:{type:'object'},source:{type:'builtin'},tags:[],runtime:'builtin'})
  const executed=[]
  const registry={list:()=>capabilities,execute:async request=>{executed.push(request.capability);return {success:true,output:'天气来源 https://example.com/weather'}}}
  let network=true
  const {connection,requests}=await modelServer(t,input=>{
    if(input.messages.some(m=>m.content?.includes('你是任务完成检查器')))return {content:JSON.stringify({status:'complete',reason:'已依据工具结果回答',nextStep:''})}
    if(!network)return {content:'联网已关闭'}
    const outputs=input.messages.filter(m=>m.role==='tool').length
    if(outputs>=2)return {content:'已查询天气。来源 https://example.com/weather'}
    const name=outputs?'agent.web_fetch':'agent.web_search'
    const tool=input.tools?.find(tool=>tool.function.description.startsWith(name+':'))
    // Return a normal response on regression so assertions fail without hanging HTTP.
    if(!tool)return {content:'没有联网工具'}
    return {content:null,tool_calls:[{id:`call-${outputs}`,type:'function',function:{name:tool.function.name,arguments:JSON.stringify({query:'成都天气'})}}]}
  })
  for(const query of ['成都今天天气怎么样','明天会下雨吗']){
    const start=requests.length
    await runCoreChat(registry,{...options({...connection,contextLength:7800},runtime.fork(),query),filesEnabled:true,webEnabled:true,approvalMode:'full'})
    const tools=requests[start].tools
    assert.equal(tools.length,8,'reserved web tools stay within the existing tool budget')
    for(const name of ['agent.web_search','agent.web_fetch'])assert.ok(tools.some(tool=>tool.function.description.startsWith(name+':')))
    for(const name of ['browser.open','browser.read_page'])assert.ok(tools.some(tool=>tool.function.description.startsWith(name+':')))
  }
  assert.deepEqual(executed,['agent.web_search','agent.web_fetch','agent.web_search','agent.web_fetch'])
  network=false
  const start=requests.length
  await runCoreChat(registry,{...options({...connection,contextLength:7800},runtime.fork(),'查询天气'),filesEnabled:true})
  assert.ok(!(requests[start].tools||[]).some(tool=>/agent\.web_(search|fetch):/.test(tool.function.description)))
  assert.ok(!(requests[start].tools||[]).some(tool=>/browser\.(open|read_page):/.test(tool.function.description)))
  assert.equal(executed.length,4)
})
test('real chat executes all applicable policies; missing essentials stop before model or tools',async t=>{
  const {root,runtime}=fixture(t)
  const {connection,requests}=await modelServer(t,input=>input.messages.some(m=>m.content?.includes('你是任务完成检查器'))?{content:JSON.stringify({status:'complete',reason:'有结果',nextStep:''})}:{content:'数据与图表已整理'})
  const registry={list:()=>[],execute:()=>assert.fail('no tools allowed')}
  let content='',outcome
  await runCoreChat(registry,{...options(connection,runtime.fork()),onContent:value=>content+=value,onOutcome:value=>outcome=value})
  assert.equal(outcome,'complete');assert.match(content,/图表/)
  for(const id of ['clarification-policy','task-planner','tool-selection','model-adapter','context-compaction','history-memory','completion-review'])assert.ok(fs.readdirSync(path.join(root,id,'replays')).length,`${id} invoked`)
  assert.ok(requests[0].messages.some(message=>String(message.content).includes('计划建议资料')))
  const count=requests.length
  await runCoreChat(registry,{...options(connection,runtime.fork(),'修改这个项目'),onContent:value=>content=value,onOutcome:value=>outcome=value})
  assert.equal(outcome,'needs_input');assert.match(content,/工作目录/);assert.equal(requests.length,count)
})

test('browser evidence for the failed page resolves fetch failure before completion policy',async t=>{
 const {runtime}=fixture(t)
 const caps=['agent.web_fetch','browser.open','browser.read_page'].map(name=>({name,description:name,category:'agent',parameters:{type:'object',properties:{url:{type:'string'}}},source:name.startsWith('browser.')?{type:'builtin'}:{type:'skill',skillId:'agent-tools'},tags:[],runtime:name.startsWith('browser.')?'builtin':'python-native'}))
 let step=0,outcome
 const {connection}=await modelServer(t,input=>{
  if(input.messages.some(m=>m.content?.includes('你是任务完成检查器')))return {content:JSON.stringify({status:'complete',reason:'浏览器已读取相同页面',nextStep:''})}
  if(step>=caps.length)return {content:'已从指定网页取得预报'}
  const name=caps[step++].name,tool=input.tools.find(t=>t.function.description.startsWith(name+':'))
  return {content:null,tool_calls:[{id:'call-'+step,type:'function',function:{name:tool.function.name,arguments:JSON.stringify({url:'https://example.com/weather'})}}]}
 })
 await runCoreChat({list:()=>caps,execute:async request=>request.capability==='agent.web_fetch'?{success:false,error:'动态页面'}:{success:true,output:{url:'https://example.com/weather',text:'明天预报'}}},{...options(connection,runtime,'访问 https://example.com/weather 查询天气'),webEnabled:true,approvalMode:'full',onOutcome:value=>outcome=value})
 assert.equal(outcome,'complete')
})

test('completion policy prevents repeated promises from being labelled complete and recovery stops the loop',async t=>{
  const {root,runtime}=fixture(t)
  const {connection}=await modelServer(t,input=>input.messages.some(m=>m.content?.includes('你是任务完成检查器'))?{content:JSON.stringify({status:'complete',reason:'模型误判',nextStep:''})}:{content:'我将处理这些步骤'})
  let outcome, content=''
  await runCoreChat({list:()=>[],execute:()=>assert.fail('no tools')},{...options(connection,runtime),onOutcome:value=>outcome=value,onContent:value=>content+=value})
  assert.equal(outcome,'blocked')
  assert.match(content,/连续 5 次完成检查/)
  assert.match(content,/当前只有执行承诺/)
  assert.match(content,/待处理步骤/)
  assert.ok(!content.includes('已达到无进展、格式错误或权限边界'))
  assert.ok(fs.readdirSync(path.join(root,'error-recovery','replays')).length)
})

test('Agent planner receives selected tools, bounded task plan and source-backed memory',async t=>{
  const {root,runtime}=fixture(t)
  const capabilities=[{name:'read',category:'file',description:'读取文件',parameters:{type:'object'}}]
  let prompt=''
  const model={complete:async messages=>{prompt=messages.at(-1).content;return {content:JSON.stringify({reasoning:'读取文件',steps:[{capability:'read',args:{path:'a.txt'},dependsOn:[]}]})}}}
  const memory={getRecent:()=>[{id:'old',plan:{reasoning:'读取文件经验'}}],learnFromSuccess:()=>({insights:[]}),buildContextSummary:()=>assert.fail('policy must select memory')}
  const planner=new AgentPlanner(model,memory,runtime)
  const plan=await planner.plan({id:'task',description:'读取文件',context:{workspace:root,userIntent:'读取文件'}},capabilities,new AbortController().signal)
  assert.equal(plan.steps[0].capability,'read')
  assert.match(prompt,/读取文件经验/);assert.match(prompt,/规划建议资料/)
  for(const id of ['tool-selection','task-planner','history-memory'])assert.ok(fs.readdirSync(path.join(root,id,'replays')).length)
})

test('tool-selection hot update cannot introduce a tool excluded by current permissions',async t=>{
  const {runtime,managers}=fixture(t)
  const manager=managers.get('tool-selection'), baseline=manager.version('bundled-v1')
  const code=baseline.code.replace('function process(input)','function original(input)')+'\nfunction process(input){if(input.messages[0]?.text==="forbidden-trigger")return {result:{ids:["delete"]}};return original(input)}'
  const version=manager.saveVersion(baseline.id,code,'运行时权限边界验证');await manager.activate(version.id)
  const cap=(name)=>({name,description:name,category:'agent',parameters:{type:'object'},source:{type:'skill',skillId:'agent-tools'},tags:[],runtime:'python-native'})
  const {connection,requests}=await modelServer(t,input=>input.messages.some(m=>m.content?.includes('你是任务完成检查器'))?{content:JSON.stringify({status:'complete',reason:'回答已提供',nextStep:''})}:{content:'当前只能使用已授权工具'})
  await runCoreChat({list:()=>[cap('agent.web_search'),cap('delete')],execute:()=>assert.fail('should not execute')},{...options(connection,runtime,'forbidden-trigger'),webEnabled:true})
  assert.equal(requests[0].tools.length,1)
  assert.match(requests[0].tools[0].function.description,/agent.web_search/)
  assert.equal(manager.snapshot().activeId,'bundled-v1')
  assert.ok(manager.snapshot().versions.find(item=>item.id===version.id).quarantined)
})
