import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {AutomationService,nextAutomationRun} from '../dist-electron/main/agent/automation.js'
import {LocalAgentService} from '../dist-electron/main/agent/service.js'

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check){const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw new Error('automation timed out');await wait(15)}}
function sandbox(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-automation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}

test('automation schedules support interval, wall-clock and cron triggers',()=>{
 const after=new Date('2026-09-21T00:00:00.000Z')
 assert.equal(nextAutomationRun({type:'interval',minutes:30},'UTC',after),'2026-09-21T00:30:00.000Z')
 assert.equal(nextAutomationRun({type:'daily',time:'09:15'},'Asia/Shanghai',after),'2026-09-21T01:15:00.000Z')
 assert.equal(nextAutomationRun({type:'weekly',time:'10:00',weekdays:[1]},'Asia/Shanghai',after),'2026-09-21T02:00:00.000Z')
 assert.equal(nextAutomationRun({type:'cron',expression:'30 8 * * 1-5'},'Asia/Shanghai',after),'2026-09-21T00:30:00.000Z')
 assert.throws(()=>nextAutomationRun({type:'cron',expression:'bad'},'UTC',after),/5 个字段/)
})

test('automation persists tasks and creates an independent successful agent run',async t=>{
 const root=sandbox(t),workspace=path.join(root,'project');fs.mkdirSync(workspace)
 const server=createServer(async(req,res)=>{for await(const _ of req){}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'定时检查完成'}}]}))})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close()})
 const agent=new LocalAgentService(path.join(root,'agent'),()=>({endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',maxTokens:1024,contextLength:8192}));t.after(()=>agent.dispose())
 const project=agent.createProject(workspace,'测试项目'),automation=new AutomationService(path.join(root,'automation'),agent);t.after(()=>automation.dispose())
 const task=automation.save({name:'每日检查',enabled:true,projectId:project.id,instruction:'检查项目并报告',trigger:{type:'daily',time:'09:00'},timezone:'Asia/Shanghai',agent:{model:'fixture',mode:'coding',maxSteps:10,fastMode:true,approvalMode:'ask'},execution:{timeoutMinutes:2,retryMax:0,retryDelayMinutes:1,concurrency:'forbid'},output:{notifyOn:'never'}})
 assert.ok(task.state.nextRunAt);automation.action(task.id,'run')
 await until(()=>automation.runs(task.id)[0]?.status==='succeeded')
 const run=automation.runs(task.id)[0];assert.equal(run.summary,'定时检查完成');assert.ok(run.agentTaskId);assert.equal(run.agentTaskIds.length,1)
 const reopened=new AutomationService(path.join(root,'automation'),agent);t.after(()=>reopened.dispose());assert.equal(reopened.tasks()[0].id,task.id);assert.equal(reopened.runs(task.id)[0].status,'succeeded')
})

test('expired one-time automations are rejected',t=>{
 const root=sandbox(t),workspace=path.join(root,'project');fs.mkdirSync(workspace);const agent=new LocalAgentService(path.join(root,'agent'),()=>{throw new Error('unused')}),project=agent.createProject(workspace,'项目'),automation=new AutomationService(path.join(root,'automation'),agent);t.after(()=>{automation.dispose();agent.dispose()})
 assert.throws(()=>automation.save({name:'过期任务',enabled:true,projectId:project.id,instruction:'检查',trigger:{type:'once',at:'2020-01-01T00:00:00Z'},timezone:'UTC',agent:{model:'fixture',mode:'general',maxSteps:5,fastMode:true,approvalMode:'ask'},execution:{timeoutMinutes:1,retryMax:0,retryDelayMinutes:1,concurrency:'forbid'},output:{notifyOn:'never'}}),/晚于当前时间/)
})
