import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {parseTaskItems,runTaskPlan} from '../dist-electron/main/agent/core/task-plan-runner.js'
import {requiresImplementation} from '../dist-electron/main/agent/core/implementation-stage.js'
import {taskWriteScopes} from '../dist-electron/main/agent/core/task-worker-context.js'
import {LocalAgentService} from '../dist-electron/main/agent/service.js'

test('explicit task kinds override ambiguous titles and cannot grant a write role to verification',()=>{
 const items=parseTaskItems(JSON.stringify({steps:[{kind:'verify',mode:'write',title:'修复后运行测试',acceptance:'test 退出码 0'},{kind:'inspect',title:'优化建议',acceptance:'列出建议'}]}))
 assert.equal(items[0].mode,'verify');assert.equal(items[1].mode,'read')
 assert.equal(requiresImplementation(items[0].title,items[0].acceptance,items[0].kind),false)
 assert.throws(()=>parseTaskItems(JSON.stringify({steps:[{kind:'unknown',title:'查看',acceptance:'完成'}]})),/任务类型无效/)
 const parent={id:'parent',fileScope:['src']},child={id:'child',parentId:'parent',fileScope:[]}
 assert.deepEqual(taskWriteScopes({items:[parent,child]},child),[[],['src']])
})
test('verification contract completes from independent checks without demanding a code edit',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-contract-'));t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}))
 const plan={taskId:'task',workspace,graphVersion:1,items:parseTaskItems(JSON.stringify({steps:[{kind:'verify',title:'确认修改落地并运行测试',acceptance:'npm test 全部通过',verification:[{kind:'test',script:'test'}]}]})),updatedAt:''}
 const controller=new AbortController();let saved,calls=0,outcome
 await runTaskPlan({workspace,filesEnabled:true,webEnabled:true,approvalMode:'full',messages:[],signal:controller.signal,onActivity(){},onContent(){},onRequest(){},onUsage(){},onOutcome:value=>outcome=value},
  {taskId:'task',goal:'运行 npm test',plan,save:value=>saved=value},async()=>assert.fail('typed verification must not invoke an edit worker'),async(rules,item,options)=>{
   calls++;assert.equal(options.executionContext.taskId,'task');assert.equal(options.executionContext.workerId,item.worker.id);assert.equal(options.executionContext.mode,'verify');assert.notEqual(options.signal,controller.signal)
   options.onActivity({id:'test-result',capability:'agent.run_test',args:{script:'test'},status:'complete',output:'{"exitCode":0}'})
   return rules.map(rule=>({rule,passed:true,summary:'exitCode 0',fingerprint:'pass',activityId:'test-result'}))
  })
 assert.equal(calls,1);assert.equal(outcome,'complete');assert.equal(saved.items[0].worker.toolCalls,1);assert.equal(saved.items[0].runtime.status,'succeeded')
})
test('host verification resumes an exhausted legacy worker while retaining cumulative evidence',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-verify-budget-'));t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}))
 const plan={taskId:'task',workspace,graphVersion:1,items:parseTaskItems(JSON.stringify({steps:[{kind:'verify',title:'运行测试',acceptance:'npm test 全部通过',verification:[{kind:'test',script:'test'}]}]})),updatedAt:''}
 const item=plan.items[0];item.status='blocked';item.attempts=1;item.evidenceIds=['previous-read']
 item.worker={id:'saved-worker',mode:'verify',assignedAt:'before',maxToolCalls:40,toolCalls:40}
 let modelCalls=0,outcome;const seen=[]
 await runTaskPlan({workspace,filesEnabled:true,approvalMode:'full',messages:[],signal:new AbortController().signal,onActivity(){},onContent(){},onRequest(){},onUsage(){},onOutcome:value=>outcome=value},
  {taskId:plan.taskId,plan,save(){}},async()=>{modelCalls++},async(rules,step,options)=>{
   const budget=options.executionContext.budget;seen.push({...budget})
   // The runtime charges the shared budget before emitting a terminal activity.
   budget.used++
   options.onActivity({id:'test-result',capability:'agent.run_test',args:{script:'test'},status:'complete',output:'{"exitCode":0}'})
   return rules.map(rule=>({rule,passed:true,summary:'exitCode 0',fingerprint:'pass',activityId:'test-result'}))
  })
 assert.equal(modelCalls,0);assert.equal(outcome,'complete')
 assert.deepEqual(seen,[{used:40,limit:undefined}])
 assert.equal(item.worker.toolCalls,41);assert.equal(item.worker.toolLimitSource,'automatic')
 assert.deepEqual(item.evidenceIds,['previous-read','test-result'])
})
test('legacy task UI delegates to the shared conversation runner and preserves project read-only policy',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-legacy-adapter-')),workspace=path.join(root,'project');fs.mkdirSync(workspace)
 const service=new LocalAgentService(path.join(root,'tasks'),()=>({endpoint:'http://127.0.0.1:9',key:'',maxTokens:1024,contextLength:32768}))
 t.after(()=>{service.dispose();fs.rmSync(root,{recursive:true,force:true})})
 const project=service.ensureWorkspaceProject(fs.realpathSync(workspace))
 service.updateProject({...project,policy:'read-only',webAccess:'disabled',autoWritePaths:[]})
 let calls=0
 service.setConversationRunner(async options=>{
  calls++;assert.equal(options.webEnabled,false)
  assert.match(options.beforeExecution({name:'agent.write_file',tags:['requires-approval']},{path:'x'}),/只读/)
  options.onRequest('worker');options.onUsage({inputTokens:10,outputTokens:2,totalTokens:12},'worker');options.onUsage({inputTokens:10,outputTokens:5,totalTokens:15},'worker')
  options.onActivity({id:'read-evidence',capability:'agent.read_file',args:{path:'README.md'},status:'complete',output:'project overview'})
  options.onContent('已核对项目结构');options.onOutcome('complete')
 })
 const completed=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('adapter did not complete')),5000)
  service.start({projectId:project.id,mode:'coding',model:'test',prompt:'查看项目',maxSteps:10},1,task=>{if(task.status==='completed'||task.status==='failed'){clearTimeout(timer);resolve(task)}})
 })
 assert.equal(calls,1);assert.equal(completed.status,'completed');assert.equal(completed.usage.totalTokens,15)
 assert.equal(completed.events.find(event=>event.id==='read-evidence').status,'completed')
})
test('preview script startup does not trigger an unrelated source-code baseline',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-preview-contract-'));t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}))
 fs.writeFileSync(path.join(workspace,'package.json'),JSON.stringify({scripts:{dev:'vite',test:'node check.cjs'}}))
 const plan={taskId:'preview',workspace,graphVersion:1,items:parseTaskItems(JSON.stringify({steps:[{kind:'preview',title:'启动开发服务并核验对局可用',acceptance:'浏览器中确认可以落子',verification:[{kind:'diagnostics',checker:'auto'}]}]})),updatedAt:''}
 let result
 await runTaskPlan({workspace,filesEnabled:true,webEnabled:true,approvalMode:'full',messages:[],signal:new AbortController().signal,onActivity(){},onContent(){},onRequest(){},onUsage(){},onOutcome:value=>result=value},
  {taskId:'preview',goal:'启动开发服务并核验对局可用',plan,save(){}},async options=>{
   const args={command:'npm run dev'}
   assert.equal(await options.beforeMutation({name:'agent.run_command'},args),undefined)
   assert.equal(options.executionContext.kind,'preview')
   options.onActivity({id:'start',capability:'agent.run_command',args,status:'complete',output:'{"exitCode":0}'})
   options.onContent('已实际核验落子');options.onOutcome('complete')
  },async()=>assert.fail('preview must not demand TypeScript diagnostics'))
 assert.equal(result,'complete');assert.equal(plan.items[0].requiresVerification,undefined)
})
