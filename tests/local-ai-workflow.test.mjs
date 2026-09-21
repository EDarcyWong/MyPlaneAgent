import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {LocalAgentService} from '../dist-electron/main/agent/service.js'
import {WorkflowService} from '../dist-electron/main/agent/workflow.js'
import {AutomationService} from '../dist-electron/main/agent/automation.js'

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check){const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw new Error('workflow timed out');await pause(15)}}
function sandbox(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-workflow-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
async function harness(t,reply){const root=sandbox(t),workspace=path.join(root,'project');fs.mkdirSync(workspace);let calls=0;const server=createServer(async(req,res)=>{for await(const _ of req){}const value=reply(calls++);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close()});const agent=new LocalAgentService(path.join(root,'agent'),()=>({endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',maxTokens:1024,contextLength:8192}));t.after(()=>agent.dispose());return {root,agent,project:agent.createProject(workspace,'测试项目')}}
const response=content=>({choices:[{finish_reason:'stop',message:{role:'assistant',content}}]})
const agentNode=(id,onSuccess)=>({id,name:id,type:'agent',...(onSuccess?{onSuccess}:{}),config:{instruction:'检查项目',model:'fixture',mode:'coding',maxSteps:10,fastMode:true,approvalMode:'ask'}})

test('workflow executes agent, condition and notification nodes with versioned history',async t=>{
 const h=await harness(t,()=>response('项目检查完成')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>notifications.push({title,body}));t.after(()=>workflow.dispose())
 const first=workflow.save({name:'项目检查流程',description:'测试流程',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'inspect',nodes:[agentNode('inspect','condition'),{id:'condition',name:'判断结果',type:'condition',onSuccess:'notify',config:{sourceNodeId:'inspect',operator:'succeeded'}},{id:'notify',name:'完成通知',type:'notify',config:{title:'完成',body:'检查已完成'}}],layout:{start:{x:80,y:160},nodes:{inspect:{x:320,y:120},condition:{x:620,y:120},notify:{x:920,y:120}}}})
 assert.equal(first.version,1);assert.deepEqual(first.layout.nodes.condition,{x:620,y:120});assert.deepEqual(first.layout.start,{x:80,y:160});const second=workflow.save({...first,description:'更新说明'});assert.equal(second.version,2);assert.deepEqual(second.layout,first.layout)
 const run=workflow.start(second.id);await until(()=>workflow.runs(second.id)[0]?.status==='succeeded');const result=workflow.runs(second.id)[0]
 assert.equal(result.id,run.id);assert.deepEqual(result.nodeRuns.map(node=>node.status),['succeeded','succeeded','succeeded']);assert.equal(result.workflowVersion,2);assert.deepEqual(notifications,[{title:'完成',body:'检查已完成'}])
})

test('workflow rejects cycles and can retry from a failed node',async t=>{
 const h=await harness(t,n=>n===0?{}:response('重试成功')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 assert.throws(()=>workflow.save({name:'循环',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'a',nodes:[{...agentNode('a','b')},{...agentNode('b','a')}]}),/不允许循环/)
 const definition=workflow.save({name:'可重试流程',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[agentNode('agent')]})
 const failed=workflow.start(definition.id);await until(()=>workflow.runs(definition.id).find(run=>run.id===failed.id)?.status==='failed');const retried=workflow.retry(failed.id,'agent');await until(()=>workflow.runs(definition.id).find(run=>run.id===retried.id)?.status==='succeeded');assert.equal(workflow.runs(definition.id).find(run=>run.id===retried.id).resumedFromRunId,failed.id)
})

test('workflow supports ordered custom branches with required conditions, outputs and colors',async t=>{
 const h=await harness(t,()=>response('项目检查完成')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>notifications.push({title,body}));t.after(()=>workflow.dispose())
 const base={name:'自定义分支',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent'},agent={id:'agent',name:'检查',type:'agent',config:{instruction:'检查 {{module}}',model:'fixture',mode:'coding',maxSteps:10,fastMode:true,approvalMode:'ask',inputs:[{name:'module',value:'项目'}]}},done={id:'done',name:'完成通知',type:'notify',branches:[],config:{title:'完成',body:'命中摘要分支'}},fallback={id:'fallback',name:'兜底通知',type:'notify',branches:[],config:{title:'兜底',body:'命中兜底分支'}}
 assert.throws(()=>workflow.save({...base,nodes:[{...agent,branches:[{id:'bad',name:'缺少条件',condition:'',color:'#347fc5',targetNodeId:'done'}]},done]}),/判断条件/)
 const downstream={...agent,id:'downstream',name:'需要输入的 Agent',branches:[],config:{...agent.config,inputs:[{name:'sourceValue',value:'占位'}]}};assert.throws(()=>workflow.save({...base,nodes:[{...agent,config:{...agent.config,inputs:[]},branches:[{id:'missing-output',name:'缺少输出值',condition:'执行成功',color:'#347fc5',targetNodeId:'downstream'}]},downstream]}),/必须填写输出值/)
 const terminal=workflow.save({...base,name:'无连线输出',nodes:[{...agent,branches:[{id:'terminal',name:'结束',condition:'执行成功',color:'#347fc5',outputValue:'完成值'}]}]});assert.equal(terminal.nodes[0].branches[0].targetNodeId,undefined);assert.equal(terminal.nodes[0].branches[0].outputValue,'完成值')
 const definition=workflow.save({...base,nodes:[{...agent,branches:[{id:'summary',name:'摘要命中',condition:'摘要包含：检查完成',color:'#347fc5',targetNodeId:'done',outputValue:'摘要分支输出'},{id:'always',name:'默认分支',condition:'始终',color:'#8058b4',targetNodeId:'fallback'}]},done,fallback]})
 assert.equal(definition.nodes[0].branches.length,2);assert.equal(definition.nodes[0].branches[1].color,'#8058b4');assert.deepEqual(definition.nodes[0].config.inputs,[{name:'module',value:'项目'}])
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');assert.deepEqual(notifications,[{title:'完成',body:'命中摘要分支'}]);assert.equal(workflow.runs(definition.id)[0].nodeRuns[0].outputValue,'摘要分支输出')
})

test('workflow supports fan-out and fan-in connections without repeating merged nodes',async t=>{
 const h=await harness(t,()=>response('扇出完成')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>notifications.push({title,body}));t.after(()=>workflow.dispose())
 const branch=(id,targetNodeIds)=>[{id:'next',name:'继续',condition:'始终',color:'#347fc5',targetNodeIds}]
 const definition=workflow.save({name:'多对多流程',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[{...agentNode('source'),branches:branch('source',['left','right'])},{id:'left',name:'左侧',type:'notify',branches:branch('left',['merged']),config:{title:'左侧',body:'左侧完成'}},{id:'right',name:'右侧',type:'notify',branches:branch('right',['merged']),config:{title:'右侧',body:'右侧完成'}},{id:'merged',name:'汇合',type:'notify',branches:[],config:{title:'汇合',body:'只执行一次'}}]})
 assert.deepEqual(definition.nodes[0].branches[0].targetNodeIds,['left','right'])
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');const run=workflow.runs(definition.id)[0]
 assert.deepEqual(run.nodeRuns.map(item=>item.nodeId),['source','left','right','merged']);assert.deepEqual(notifications.map(item=>item.title),['左侧','右侧','汇合'])
})

test('agent execution inputs wait for every unique upstream by default and can use any-input mode',async t=>{
 const h=await harness(t,()=>response('Agent 完成')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const edge=(id,name,condition,targetNodeIds)=>({id,name,condition,color:'#347fc5',targetNodeIds}),source={...agentNode('source'),branches:[edge('fanout','并行','始终',['left','right'])]},left={id:'left',name:'左侧输入',type:'notify',branches:[edge('left-done','左侧完成','始终',['joined'])],config:{title:'左侧',body:'完成'}},right={id:'right',name:'右侧输入',type:'notify',branches:[edge('right-failed','失败时输入','执行失败',['joined']),edge('right-done','成功结束','执行成功',['terminal'])],config:{title:'右侧',body:'完成'}},terminal={id:'terminal',name:'路径结束',type:'notify',branches:[],config:{title:'结束',body:'完成'}},joined=mode=>({...agentNode('joined'),name:'汇合 Agent',branches:[],config:{...agentNode('joined').config,inputSignalMode:mode}}),base={description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source'}
 const waits=workflow.save({...base,name:'等待全部输入',nodes:[source,left,right,terminal,joined('all')]});assert.equal(waits.nodes.find(node=>node.id==='joined').config.inputSignalMode,'all');workflow.start(waits.id);await until(()=>workflow.runs(waits.id)[0]?.status==='failed');const waitingRun=workflow.runs(waits.id)[0];assert.match(waitingRun.error,/汇合 Agent.*缺少：右侧输入/);assert.equal(waitingRun.nodeRuns.some(item=>item.nodeId==='joined'),false);assert.deepEqual(waitingRun.nodeInputSignals.joined,['left'])
 const any=workflow.save({...base,name:'任一输入执行',nodes:[source,left,right,terminal,joined('any')]});workflow.start(any.id);await until(()=>workflow.runs(any.id)[0]?.status==='succeeded');const anyRun=workflow.runs(any.id)[0];assert.equal(anyRun.nodeRuns.filter(item=>item.nodeId==='joined').length,1);assert.deepEqual(anyRun.nodeInputSignals.joined,['left'])
})

test('scheduled automation can launch a workflow and mirror its result',async t=>{
 const h=await harness(t,()=>response('自动工作流完成')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose());const definition=workflow.save({name:'自动流程',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[agentNode('agent')]})
 const adapter={exists:(id,projectId)=>workflow.definitions().some(item=>item.id===id&&item.projectId===projectId&&item.enabled),start:(id,update)=>workflow.start(id,update),cancel:id=>workflow.cancel(id)},automation=new AutomationService(path.join(h.root,'automation'),h.agent,undefined,undefined,adapter);t.after(()=>automation.dispose())
 const task=automation.save({name:'调度工作流',enabled:true,projectId:h.project.id,instruction:'工作流触发',workflowId:definition.id,trigger:{type:'daily',time:'09:00'},timezone:'UTC',agent:{model:'workflow',mode:'general',maxSteps:1,fastMode:true,approvalMode:'ask'},execution:{timeoutMinutes:10,retryMax:0,retryDelayMinutes:1,concurrency:'forbid'},output:{notifyOn:'never'}});automation.action(task.id,'run');await until(()=>automation.runs(task.id)[0]?.status==='succeeded');const run=automation.runs(task.id)[0];assert.ok(run.workflowRunId);assert.equal(run.agentTaskIds.length,1);assert.equal(run.summary,'自动工作流完成')
})
