import {app} from 'electron'
import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {LocalAiStudioService} from '../dist-electron/main/local-ai-studio.js'
import {createTaskScope} from '../dist-electron/shared/task-scope.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lookup-routing-'))
app.setPath('userData',path.join(root,'profile'))
let service
async function main(){try{
 await app.whenReady()
 service=new LocalAiStudioService(path.join(root,'data'))
 service.routerModule.setPolicy({...service.routerModule.snapshot().policy,autoOptimize:false})
 service.saveStudioSettings({endpoint:'http://127.0.0.1:9/v1',model:'routing-test',contextLength:32768})
 const session=service.newSession(),calls=[]
 const sender=new EventEmitter();sender.id=901;sender.isDestroyed=()=>false;sender.send=()=>{}
 service.ensureAgentCore=async()=>({runConversation:async options=>{
  calls.push({goal:options.planExecution.goal,taskId:options.planExecution.taskId,plan:options.planExecution.plan,messages:options.messages})
  options.planExecution.save({taskId:options.planExecution.taskId,workspace:options.workspace,scope:createTaskScope(options.planExecution.goal),items:[],updatedAt:new Date().toISOString()})
  options.onContent('本次查询测试结果');options.onOutcome('blocked')
 }})
 const send=async(text)=>{
  await service.startChat({sessionId:session.id,requestId:String(Date.now()),model:'routing-test',text,approvalMode:'auto'},sender)
  const end=Date.now()+15000
  while(service.chats.size){if(Date.now()>end)throw new Error('routing timed out');await new Promise(resolve=>setTimeout(resolve,20))}
  const current=service.session(session.id);assert.equal(current.messages.at(-1).error,undefined,JSON.stringify(current.messages.at(-1)))
  return current
 }
 await send('北京市明天下雨吗')
 await send('明天成都下雨吗')
 const current=await send('成都市明天下雨吗')
 assert.equal(calls.length,3)
 assert.deepEqual(calls.map(call=>call.goal),['北京市明天下雨吗','明天成都下雨吗','成都市明天下雨吗'])
 assert.notEqual(calls[0].taskId,calls[1].taskId)
 assert.equal(calls[1].taskId,calls[2].taskId)
 assert.ok(calls.every(call=>call.plan===undefined))
 assert.doesNotMatch(JSON.stringify(calls[1].messages),/北京/)
 assert.doesNotMatch(JSON.stringify(calls[2].messages),/北京|用户补充/)
 assert.equal(current.messages.filter(message=>message.role==='user').length,3,'history is retained')
 assert.equal(current.taskPlan.scope.goal,'成都市明天下雨吗')
 await send('分析当前项目')
 await send('打开项目')
 const project=await send('项目还可以怎么优化')
 assert.deepEqual(calls.slice(3).map(call=>call.goal),['分析当前项目','打开项目','项目还可以怎么优化'])
 assert.equal(new Set(calls.slice(3).map(call=>call.taskId)).size,3)
 assert.notEqual(calls[2].taskId,calls[3].taskId)
 assert.doesNotMatch(JSON.stringify(calls[3].messages),/下雨|天气|用户补充/)
 assert.equal(project.taskPlan.scope.goal,'项目还可以怎么优化')
 const legacy=service.newSession()
 legacy.messages=[
  {id:'weather',role:'user',content:'成都今天下雨吗',createdAt:new Date().toISOString()},
  {id:'analysis',role:'user',content:'分析当前项目',createdAt:new Date().toISOString()},
  {id:'open',role:'user',content:'打开项目',createdAt:new Date().toISOString()},
  {id:'optimize',role:'user',content:'项目还可以怎么优化',createdAt:new Date().toISOString()},
 ]
 legacy.abilityTask={id:'old-weather-task',startMessageId:'weather',goalMessageId:'weather',status:'blocked',updatedAt:new Date().toISOString()}
 legacy.taskPlan={taskId:'old-weather-task',workspace:'/tmp',scope:createTaskScope('成都今天下雨吗\n用户补充：分析当前项目\n用户补充：打开项目\n用户补充：项目还可以怎么优化'),items:[],updatedAt:new Date().toISOString()}
 service.saveSession(legacy)
 const repaired=service.session(legacy.id)
 assert.equal(repaired.taskPlan,undefined)
 assert.equal(repaired.abilityTask.startMessageId,'analysis')
 assert.equal(repaired.abilityTask.goalMessageId,'optimize')
 assert.notEqual(repaired.abilityTask.id,'old-weather-task')
 assert.equal(repaired.messages.length,4)
 const advice=service.newSession()
 advice.messages=[{id:'advice-goal',role:'user',content:'项目还可以怎么优化',createdAt:new Date().toISOString()}]
 advice.abilityTask={id:'advice-task',startMessageId:'advice-goal',goalMessageId:'advice-goal',status:'blocked',updatedAt:new Date().toISOString()}
 advice.taskPlan={taskId:'advice-task',workspace:'/tmp',scope:createTaskScope('项目还可以怎么优化'),items:[
  {id:'list',title:'梳理并确认可优化项清单',acceptance:'列出建议，不修改文件',status:'complete',attempts:1,summary:'已列出候选优化项',evidenceIds:[]},
  {id:'edit',title:'实现 AI 搜索优化',acceptance:'修改 useAI.js',status:'blocked',attempts:1,summary:'未实现',evidenceIds:[]},
 ],updatedAt:new Date().toISOString()}
 service.saveSession(advice)
 const restoredAdvice=service.session(advice.id)
 assert.deepEqual(restoredAdvice.taskPlan.items.map(item=>item.title),['梳理并确认可优化项清单'])
 assert.equal(restoredAdvice.abilityTask.status,'ready')
 await service.startChat({sessionId:advice.id,requestId:'implement-advice',model:'routing-test',text:'按建议优化',approvalMode:'auto'},sender)
 const implementationDeadline=Date.now()+15000
 while(service.chats.size){if(Date.now()>implementationDeadline)throw new Error('advice implementation routing timed out');await new Promise(resolve=>setTimeout(resolve,20))}
 const implementation=service.session(advice.id)
 assert.equal(implementation.messages.at(-1).abilityRoute.action,'amend')
 assert.equal(implementation.messages.at(-1).abilityRoute.versionId,'host-advice-implementation')
 assert.equal(calls.at(-1).taskId,'advice-task','implementation stays in the current project task')
 assert.equal(calls.at(-1).plan.needsReplan,true,'read-only advice is replanned')
 assert.equal(calls.at(-1).goal,'项目还可以怎么优化\n用户补充：按建议优化')
 const stuck=service.newSession()
 stuck.messages=[
  {id:'stuck-advice',role:'user',content:'项目还可以怎么优化',createdAt:new Date().toISOString()},
  {id:'stuck-implement',role:'user',content:'按建议优化',createdAt:new Date().toISOString()},
 ]
 stuck.abilityTask={id:'stuck-task',startMessageId:'stuck-advice',goalMessageId:'stuck-advice',status:'blocked',updatedAt:new Date().toISOString()}
 stuck.taskPlan={taskId:'stuck-task',workspace:'/tmp',scope:createTaskScope('项目还可以怎么优化\n用户补充：按建议优化'),items:[{id:'stuck-list',title:'梳理项目可优化项',acceptance:'仅列建议，不修改文件',status:'blocked',attempts:1,summary:'完成状态未确认',evidenceIds:[]}],updatedAt:new Date().toISOString()}
 service.saveSession(stuck)
 const repairedImplementation=service.session(stuck.id)
 assert.equal(repairedImplementation.taskPlan.needsReplan,true)
 assert.equal(repairedImplementation.abilityTask.status,'ready')
 await service.startChat({sessionId:stuck.id,requestId:'resume-stuck-implementation',model:'routing-test',text:'继续',approvalMode:'auto'},sender)
 const resumeDeadline=Date.now()+15000
 while(service.chats.size){if(Date.now()>resumeDeadline)throw new Error('stuck implementation resume timed out');await new Promise(resolve=>setTimeout(resolve,20))}
 assert.equal(service.session(stuck.id).messages.at(-1).abilityRoute.action,'continue')
 assert.equal(calls.at(-1).plan.needsReplan,true)
 assert.match(calls.at(-1).goal,/按建议优化/)
 assert.ok(service.routerModule.snapshot().problems.some(problem=>problem.automatic&&problem.expected.action==='new_task'))
 assert.ok(service.policyManagers.get('error-recovery').snapshot().observations.some(item=>item.cause==='unknown'))
 console.log('Lookup routing: new destination, city alias, stale plan removal and history isolation passed')
}catch(error){console.error(error);process.exitCode=1}finally{
 await service?.dispose()
 try{fs.rmSync(root,{recursive:true,force:true})}catch{}
 app.exit(process.exitCode||0)
}}
setTimeout(main,0)
