import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {parseTaskItems,runTaskPlan} from '../dist-electron/main/agent/core/task-plan-runner.js'
const items=()=>parseTaskItems(JSON.stringify({steps:[{title:'检查文件',acceptance:'读取实际内容'},{title:'核验结果',acceptance:'测试成功'}]}))
test('an actual mutation still captures baseline and verifies even when original goal is vague',async()=>{
 const f=fixture();f.execution.goal='把它做好'
 f.plan.items=parseTaskItems(JSON.stringify({steps:[{title:'处理当前内容',acceptance:'目标文件包含结果',verification:[{kind:'file',path:'result.txt',contains:'done'},{kind:'diagnostics',checker:'auto'}]}]}))
 let checks=0
 await runTaskPlan(f.options,f.execution,async step=>{
  assert.equal(checks,0)
  assert.equal(await step.beforeMutation({name:'agent.write_file'},{path:'result.txt'}),undefined)
  assert.equal(checks,1)
  step.onActivity({id:'write',capability:'agent.write_file',args:{path:'result.txt'},status:'complete',output:JSON.stringify({changed:true})})
  step.onOutcome('complete')
 },async rules=>{checks++;return rules.map(rule=>({rule,passed:true,summary:'passed',fingerprint:'ok'}))})
 assert.equal(checks,2);assert.equal(f.plan.items[0].status,'complete');assert.equal(f.plan.items[0].mutationStarted,true)
})
test('information tasks restore blocked plans without depending on topic classification',async()=>{
 for(const goal of ['成都市明天限行尾号多少','成都博物馆开放时间','2026年中秋节放假安排','火星与地球的距离','梳理这篇文章的主要观点'])for(const resumed of [false,true]){
  const f=fixture()
  f.execution.goal=resumed?'继续':goal
  f.plan.scope={goal,kind:'general',required:[goal],optional:[]}
  f.plan.items=parseTaskItems(JSON.stringify({steps:[{title:'查询成都市明天限行尾号',acceptance:'从权威来源获取明天成都市限行尾号信息，明确数字、时段和区域，日期与明天一致',verification:[{kind:'diagnostics',checker:'auto'}]}]}))
  const item=f.plan.items[0],acceptance=item.acceptance
  if(resumed){item.status='blocked';item.attempts=1;item.baseline={createdAt:new Date().toISOString(),passed:false,results:[{rule:item.verification[0],passed:false,blocked:true,summary:'ValueError: 未找到可用的 TypeScript 检查脚本、tsc 或 Python 项目',fingerprint:'missing-project',issues:[{key:'env',category:'environment',message:'missing project'}]}]}}
  let calls=0
  await runTaskPlan(f.options,f.execution,async step=>{
   calls++;assert.equal(step.currentStep.acceptance,acceptance)
   step.onActivity({id:'traffic-source',capability:'agent.web_fetch',args:{},status:'complete'})
   step.onOutcome('blocked');step.onContent('尚未找到与目标日期一致的权威来源，不能确认限行尾号')
  },async()=>{throw new Error('traffic lookup must not invoke project checks')})
  assert.equal(calls,1);assert.equal(item.status,'blocked');assert.match(item.summary,/权威来源/)
  assert.doesNotMatch(item.summary,/TypeScript|修改前检查/)
  assert.equal(item.excludedProjectChecks.length,1)
  if(resumed)assert.equal(item.excludedProjectChecks[0].baseline.results[0].fingerprint,'missing-project')
 }
})
test('weather page retrieval resumes past unrelated project baseline without losing acceptance',async()=>{
 for(const resumed of [false,true]){
  const f=fixture();f.execution.goal='成都市明天下雨吗'
  f.plan.items=parseTaskItems(JSON.stringify({steps:[{title:'读取中国天气网成都市城区页面，获取明天白天天气现象',acceptance:'读取 https://www.weather.com.cn/weather1d/101270101.shtml 并记录 28日白天天气现象与页面发布时间',verification:[{kind:'diagnostics',checker:'auto'}]}]}))
  const item=f.plan.items[0],acceptance=item.acceptance
  const failed={createdAt:'2026-09-27',passed:false,results:[{rule:item.verification[0],passed:false,blocked:true,summary:'未找到可用的 TypeScript 检查脚本、tsc 或 Python 项目',fingerprint:'environment',issues:[{key:'env',category:'environment',message:'missing checker'}]}]}
  if(resumed){item.status='blocked';item.attempts=1;item.baseline=failed;item.verificationRuns=[failed]}
  let ran=0,checks=0
  await runTaskPlan(f.options,f.execution,async step=>{
   ran++;assert.equal(step.currentStep.acceptance,acceptance)
   assert.match(step.stateContext,/不能用抓取时间代替/)
   assert.ok(await step.beforeMutation({name:'agent.write_file'},{}))
   step.onActivity({id:'page-read',capability:'agent.web_fetch',args:{},status:'complete'})
   step.onContent('页面证据已读取并核对');step.onOutcome('complete')
  },async()=>{checks++;throw new Error('web lookup must not run compiler')})
  assert.equal(ran,1);assert.equal(checks,0);assert.equal(item.status,'complete');assert.equal(item.acceptance,acceptance)
  assert.equal(item.excludedProjectChecks[0].rules[0].kind,'diagnostics')
  if(resumed)assert.equal(item.excludedProjectChecks[0].baseline.results[0].fingerprint,'environment')
 }
})
test('weather lookup with missing page evidence stays blocked after unrelated checks are removed',async()=>{
 const f=fixture();f.execution.goal='查询成都明天天气预报'
 f.plan.items=parseTaskItems(JSON.stringify({steps:[{title:'读取天气页面',acceptance:'明确日期字段与发布时间',verification:[{kind:'diagnostics',checker:'auto'}]}]}))
 await runTaskPlan(f.options,f.execution,async step=>{step.onOutcome('blocked');step.onContent('页面没有提供发布时间')},async()=>{throw new Error('unexpected diagnostics')})
 assert.equal(f.plan.items[0].status,'blocked');assert.match(f.plan.items[0].summary,/发布时间/)
})
test('explicit weather code checks retain their baseline gate',async()=>{
 const f=fixture();f.execution.goal='修复天气查询代码并运行 TypeScript 检查'
 f.plan.items=parseTaskItems(JSON.stringify({steps:[{title:'修复天气查询代码',acceptance:'TypeScript 检查通过',verification:[{kind:'diagnostics',checker:'typescript'}]}]}))
 let ran=0,checks=0
 await runTaskPlan(f.options,f.execution,async()=>{ran++},async rules=>{checks++;return rules.map(rule=>({rule,passed:false,blocked:true,summary:'环境不可用',fingerprint:'env'}))})
 assert.equal(ran,0);assert.equal(checks,1);assert.equal(f.plan.items[0].status,'blocked');assert.equal(f.plan.items[0].excludedProjectChecks,undefined)
})
test('bounded recursive plans execute children before parent acceptance',()=>{
 const leaf={title:'子项',acceptance:'核验'}
 const rows=parseTaskItems(JSON.stringify({steps:[{title:'父项',acceptance:'整体通过',children:[leaf]}]}))
 assert.equal(rows[0].parentId,rows[1].id)
 assert.deepEqual(rows[1].childIds,[rows[0].id])
 assert.equal(rows[0].depth,1)
 const nested={...leaf,children:[{...leaf,children:[{...leaf,children:[leaf]}]}]}
 assert.throws(()=>parseTaskItems(JSON.stringify({steps:[nested]})),/深度/)
})
function fixture(){
 const saved=[],events=[],controller=new AbortController()
 const plan={taskId:'task',workspace:'workspace',items:items(),updatedAt:''}
 const options={workspace:'workspace',messages:[],signal:controller.signal,onContent:text=>events.push(text),onActivity:()=>{},onOutcome:value=>events.push(value)}
 return {saved,events,controller,plan,options,execution:{taskId:'task',plan,save:value=>saved.push(value)}}
}

test('task items inherit automatic continuation and preserve explicit execution limits',async()=>{
 for(const limit of [undefined,2,23]){
  const f=fixture();f.options.maxRounds=limit;const limits=[]
  await runTaskPlan(f.options,f.execution,async step=>{limits.push(step.maxRounds);step.onOutcome('complete')})
  assert.deepEqual(limits,[limit,limit])
 }
})

test('card acceptance stays with its item and cannot bypass program verification',async()=>{
 const f=fixture();f.plan.items=f.plan.items.slice(0,1)
 const item=f.plan.items[0];item.verification=[{kind:'file',path:'index.html',contains:'glass'}]
 f.options.visualDecision={itemId:item.id,activityId:'shot',imageHash:'a'.repeat(64),decision:'accept'}
 let checks=0
 await runTaskPlan(f.options,f.execution,async step=>{
  assert.equal(step.currentStep.visualConfirmed,true)
  step.onOutcome('complete');step.onContent('用户确认视觉效果')
 },async rules=>rules.map(rule=>({rule,passed:++checks===1,blocked:checks>1,summary:checks===1?'基线通过':'环境不可用',fingerprint:String(checks),issues:checks===1?[]:[{key:'env',category:'environment',message:'环境不可用'}]})))
 assert.notEqual(item.status,'complete');assert.equal(item.verificationRuns.at(-1).passed,false)
 const g=fixture(),confirmed=[]
 g.options.visualDecision={...f.options.visualDecision,itemId:g.plan.items[0].id}
 await runTaskPlan(g.options,g.execution,async step=>{confirmed.push(step.currentStep.visualConfirmed);step.onOutcome('complete')})
 assert.deepEqual(confirmed,[true,false])
})
test('reject malformed plans before any execution',()=>{
 for(const value of ['{}','{"steps":[]}','{"steps":[{"title":"write"}]}',JSON.stringify({steps:Array(9).fill({title:'a',acceptance:'b'})})])assert.throws(()=>parseTaskItems(value))
})
test('persist running state before execution, verification before completion, then next item',async()=>{
 const f=fixture(),calls=[]
 await runTaskPlan(f.options,f.execution,async step=>{
   calls.push(f.saved.at(-1).items.find(i=>i.status==='running').title)
   assert.equal(step.currentStep.title,calls.at(-1))
   assert.equal(step.editProgress,f.plan.editProgress,'all task items share persistent edit evidence')
   step.onActivity({id:`e${calls.length}`,status:'complete'})
   step.onProgress('检查','reviewing')
   assert.equal(f.saved.at(-1).items[calls.length-1].status,'verifying')
   step.onContent('已核验');step.onOutcome('complete')
 })
 assert.deepEqual(calls,['检查文件','核验结果'])
 assert.ok(f.saved.at(-1).items.every(i=>i.status==='complete'&&i.evidenceIds.length===1))
 assert.ok(f.events.includes('complete'))
})
test('resume skips completed steps and rechecks interrupted step without automatic tool replay',async()=>{
 const f=fixture();f.plan.items[0].status='complete';f.plan.items[0].summary='已有结果';f.plan.items[1].status='running'
 let calls=0
 await runTaskPlan(f.options,f.execution,async step=>{calls++;assert.match(step.stateContext,/不要直接重放/);assert.match(step.stateContext,/已有结果/);step.onOutcome('complete')})
 assert.equal(calls,1)
})
test('blocked or denied item never advances even if model claims completion',async()=>{
 for(const denied of [false,true]){
  const f=fixture();let calls=0
  await runTaskPlan(f.options,f.execution,async step=>{calls++;if(denied)step.onActivity({id:'denied',status:'denied'});step.onOutcome(denied?'complete':'blocked')})
  assert.equal(calls,1);assert.equal(f.saved.at(-1).items[0].status,'blocked');assert.equal(f.saved.at(-1).items[1].status,'pending');assert.ok(!f.events.includes('complete'))
 }
})
test('exception checkpoints current item and never starts the next',async()=>{
 const f=fixture()
 await assert.rejects(runTaskPlan(f.options,f.execution,async()=>{throw new Error('interrupted')}),/interrupted/)
 assert.equal(f.saved.at(-1).items[0].status,'blocked');assert.equal(f.saved.at(-1).items[1].attempts,0)
})

test('passing file baseline remains separate from missing visual evidence and survives saving',async()=>{
 const f=fixture();f.plan.items[0].verification=[{kind:'file',path:'index.html'}]
 await runTaskPlan(f.options,f.execution,async step=>{
  step.onCompletionReview({status:'needs_input',reason:'模型无法识别画面',nextStep:'核对正面视角截图',missingEvidence:['门头玻璃实际视觉效果']})
  step.onOutcome('needs_input');step.onContent('等待视觉核验')
 },async rules=>rules.map(rule=>({rule,passed:true,summary:'文件检查通过',fingerprint:'passed'})))
 const item=JSON.parse(JSON.stringify(f.saved.at(-1))).items[0]
 assert.equal(item.baseline.passed,true);assert.equal(item.status,'blocked');assert.equal(item.outcome,'needs_input')
 assert.deepEqual(item.completionReview.missingEvidence,['门头玻璃实际视觉效果'])
 assert.equal(f.plan.items[1].status,'pending')
})
test('fresh task generates a plan through model API, persists it and runs final acceptance',async()=>{
 const server=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk
  const request=JSON.parse(text)
  assert.equal(request.tools,undefined)
  res.setHeader('content-type','application/json')
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({steps:[{title:'读取',acceptance:'取得文件'},{title:'修改',acceptance:'验证修改'}]})}}]}))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const f=fixture();delete f.execution.plan
  Object.assign(f.options,{connection:{endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',maxTokens:2048,contextLength:8192},model:'test',onRequest:()=>{},onUsage:()=>{}})
  let calls=0
  await runTaskPlan(f.options,f.execution,async step=>{calls++;assert.ok(f.saved.length);step.onOutcome('complete');step.onContent('核验通过')})
  assert.equal(calls,3)
  assert.equal(f.saved.at(-1).items.at(-1).title,'核对整体任务结果')
  f.execution.plan=f.saved.at(-1)
  f.execution.plan.needsReplan=true
  f.execution.plan.editProgress={files:{'known-path':['a','b','a']},ineffective:2}
  await runTaskPlan(f.options,f.execution,async step=>{
   assert.deepEqual(step.editProgress.files,{'known-path':['a','b','a']})
   assert.equal(step.editProgress.ineffective,2)
   step.onOutcome('blocked')
  })
  assert.equal(f.saved.at(-1).needsReplan,undefined)
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
