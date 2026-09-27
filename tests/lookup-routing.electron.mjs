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
 assert.ok(service.routerModule.snapshot().problems.some(problem=>problem.automatic&&problem.expected.action==='new_task'))
 assert.ok(service.policyManagers.get('error-recovery').snapshot().observations.some(item=>item.cause==='unknown'))
 console.log('Lookup routing: new destination, city alias, stale plan removal and history isolation passed')
}catch(error){console.error(error);process.exitCode=1}finally{
 await service?.dispose()
 try{fs.rmSync(root,{recursive:true,force:true})}catch{}
 app.exit(process.exitCode||0)
}}
setTimeout(main,0)
