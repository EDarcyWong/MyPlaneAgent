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
async function harness(t,reply){const root=sandbox(t),workspace=path.join(root,'project'),requests=[];fs.mkdirSync(workspace);let calls=0;const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;let request;try{request=JSON.parse(body)}catch{request={}}requests.push(request);const value=reply(calls++,request,body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close()});const agent=new LocalAgentService(path.join(root,'agent'),()=>({endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',maxTokens:1024,contextLength:8192}));t.after(()=>agent.dispose());return {root,agent,project:agent.createProject(workspace,'测试项目'),requests}}
const response=content=>({choices:[{finish_reason:'stop',message:{role:'assistant',content}}]})
const agentNode=(id,onSuccess)=>({id,name:id,type:'agent',...(onSuccess?{onSuccess}:{}),config:{instruction:'检查项目',model:'fixture',mode:'coding',maxSteps:10,fastMode:true,approvalMode:'ask',branchMode:'rules'}})

test('workflow model scheduler can override the agent connection per node',async t=>{
 const root=sandbox(t),workspace=path.join(root,'project'),defaultRequests=[],remoteRequests=[];fs.mkdirSync(workspace)
 const defaultServer=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;defaultRequests.push(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response('默认连接不应使用')))})
 const remoteServer=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;remoteRequests.push(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response('远程调度完成')))})
 await Promise.all([new Promise(resolve=>defaultServer.listen(0,'127.0.0.1',resolve)),new Promise(resolve=>remoteServer.listen(0,'127.0.0.1',resolve))])
 t.after(()=>{defaultServer.closeAllConnections();defaultServer.close();remoteServer.closeAllConnections();remoteServer.close()})
 const agent=new LocalAgentService(path.join(root,'agent'),()=>({endpoint:`http://127.0.0.1:${defaultServer.address().port}/v1`,key:'',maxTokens:1024,contextLength:8192}));t.after(()=>agent.dispose())
 const project=agent.createProject(workspace,'测试项目'),ref={source:'remote',id:'remote-model',name:'远程模型',apiFormat:'openai',endpoint:`http://127.0.0.1:${remoteServer.address().port}/v1`,contextLength:16384}
 const workflow=new WorkflowService(path.join(root,'workflow'),agent,undefined,undefined,undefined,undefined,async modelRef=>({model:modelRef.id,source:modelRef.source,label:modelRef.name,connection:{endpoint:modelRef.endpoint,key:'',maxTokens:1024,contextLength:modelRef.contextLength,apiFormat:modelRef.apiFormat}}));t.after(()=>workflow.dispose())
 const definition=workflow.save({name:'模型调度',description:'',projectId:project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[{...agentNode('agent'),config:{...agentNode('agent').config,model:'remote-model',modelSource:'specified',modelRef:ref}}]})
 assert.equal(definition.nodes[0].config.modelRef.source,'remote')
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 assert.equal(defaultRequests.length,0)
 assert.equal(remoteRequests.length,1)
 assert.equal(remoteRequests[0].model,'remote-model')
 assert.equal(workflow.runs(definition.id)[0].logs.some(item=>/使用远程模型/.test(item.message)),true)
})

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
 const base={name:'自定义分支',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent'},agent={id:'agent',name:'检查',type:'agent',config:{instruction:'检查项目',model:'fixture',mode:'coding',maxSteps:10,fastMode:true,approvalMode:'ask',branchMode:'rules',inputs:[{name:'module',description:'待检查的项目名称'}]}},done={id:'done',name:'完成通知',type:'notify',branches:[],config:{title:'完成',body:'命中摘要分支'}},fallback={id:'fallback',name:'兜底通知',type:'notify',branches:[],config:{title:'兜底',body:'命中兜底分支'}}
 assert.throws(()=>workflow.save({...base,nodes:[{...agent,branches:[{id:'bad',name:'缺少条件',condition:'',color:'#347fc5',targetNodeId:'done'}]},done]}),/判断条件/)
 const terminal=workflow.save({...base,name:'无连线输出',nodes:[{...agent,branches:[{id:'terminal',name:'结束',condition:'执行成功',color:'#347fc5',outputValue:'完成值'}]}]});assert.equal(terminal.nodes[0].branches[0].targetNodeId,undefined);assert.equal(terminal.nodes[0].branches[0].outputValue,'完成值')
 const definition=workflow.save({...base,nodes:[{...agent,branches:[{id:'summary',name:'摘要命中',condition:'摘要包含：检查完成',color:'#347fc5',targetNodeId:'done',outputValue:'摘要分支输出'},{id:'always',name:'默认分支',condition:'始终',color:'#8058b4',targetNodeId:'fallback'}]},done,fallback]})
 assert.equal(definition.nodes[0].branches.length,2);assert.equal(definition.nodes[0].branches[1].color,'#8058b4');assert.deepEqual(definition.nodes[0].config.inputs,[{name:'module',description:'待检查的项目名称'}])
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

test('workflow start node can fan out to multiple entry nodes',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>notifications.push({title,body}));t.after(()=>workflow.dispose())
 const entries=['left','right'],definition=workflow.save({name:'多入口流程',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:entries[0],entryNodeIds:entries,nodes:[{id:'left',name:'左入口',type:'notify',branches:[],config:{title:'左入口',body:'完成'}},{id:'right',name:'右入口',type:'notify',branches:[],config:{title:'右入口',body:'完成'}}]})
 assert.equal(definition.entryNodeId,'left');assert.deepEqual(definition.entryNodeIds,entries)
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');const run=workflow.runs(definition.id)[0]
 assert.deepEqual(run.nodeRuns.map(item=>item.nodeId),entries);assert.deepEqual(notifications.map(item=>item.title),['左入口','右入口'])
})

test('agent execution inputs wait for every unique upstream by default and can use any-input mode',async t=>{
 const h=await harness(t,()=>response('Agent 完成')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const edge=(id,name,condition,targetNodeIds)=>({id,name,condition,color:'#347fc5',targetNodeIds}),source={...agentNode('source'),branches:[edge('fanout','并行','始终',['left','right'])]},left={id:'left',name:'左侧输入',type:'notify',branches:[edge('left-done','左侧完成','始终',['joined'])],config:{title:'左侧',body:'完成'}},right={id:'right',name:'右侧输入',type:'notify',branches:[edge('right-failed','失败时输入','执行失败',['joined']),edge('right-done','成功结束','执行成功',['terminal'])],config:{title:'右侧',body:'完成'}},terminal={id:'terminal',name:'路径结束',type:'notify',branches:[],config:{title:'结束',body:'完成'}},joined=mode=>({...agentNode('joined'),name:'汇合 Agent',branches:[],config:{...agentNode('joined').config,inputSignalMode:mode}}),base={description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source'}
 const waits=workflow.save({...base,name:'等待全部输入',nodes:[source,left,right,terminal,joined('all')]});assert.equal(waits.nodes.find(node=>node.id==='joined').config.inputSignalMode,'all');workflow.start(waits.id);await until(()=>workflow.runs(waits.id)[0]?.status==='failed');const waitingRun=workflow.runs(waits.id)[0];assert.match(waitingRun.error,/汇合 Agent.*缺少：右侧输入/);assert.equal(waitingRun.nodeRuns.some(item=>item.nodeId==='joined'),false);assert.deepEqual(waitingRun.nodeInputSignals.joined,['left'])
 const any=workflow.save({...base,name:'任一输入执行',nodes:[source,left,right,terminal,joined('any')]});workflow.start(any.id);await until(()=>workflow.runs(any.id)[0]?.status==='succeeded');const anyRun=workflow.runs(any.id)[0];assert.equal(anyRun.nodeRuns.filter(item=>item.nodeId==='joined').length,1);assert.deepEqual(anyRun.nodeInputSignals.joined,['left'])
})

test('workflow data, route, notification templates and explicit end use deterministic variables',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>{notifications.push({title,body});return true});t.after(()=>workflow.dispose())
 const edge=(id,name,condition,targetNodeIds)=>({id,name,condition,color:'#347fc5',targetNodeIds}),definition=workflow.save({name:'结构化路由',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'data',nodes:[{id:'data',name:'设置数据',type:'data',branches:[edge('next','继续','始终',['route'])],config:{assignments:[{name:'risk',value:'high'},{name:'title',value:'风险 {{variables.risk}}'}]}},{id:'route',name:'风险路由',type:'route',branches:[edge('high','高风险','变量：risk 等于：high',['notify']),edge('fallback','默认','始终',['end'])],config:{sourceNodeId:'data'}},{id:'notify',name:'风险通知',type:'notify',branches:[edge('done','结束','始终',['end'])],config:{title:'{{variables.title}}',body:'风险等级：{{variables.risk}}'}},{id:'end',name:'成功结束',type:'end',branches:[],config:{status:'succeeded',summary:'处理完成：{{variables.risk}}'}}]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');const run=workflow.runs(definition.id)[0]
 assert.deepEqual(run.variables,{risk:'high',title:'风险 high'});assert.deepEqual(run.nodeRuns.map(item=>item.nodeId),['data','route','notify','end']);assert.deepEqual(notifications,[{title:'风险 high',body:'风险等级：high'}]);assert.equal(run.summary,'处理完成：high')
})

test('workflow can bind upstream JSON output fields into later node properties',async t=>{
 const h=await harness(t,()=>response('完成')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const edge=(id,name,condition,targetNodeIds,outputValue)=>({id,name,condition,color:'#347fc5',targetNodeIds,outputValue}),definition=workflow.save({name:'上游结构绑定',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[{...agentNode('source'),branches:[edge('next','继续','始终',['consumer','data'],'{"file":"README.md","meta":{"risk":"low"}}')]},{...agentNode('consumer')},{id:'data',name:'绑定变量',type:'data',branches:[],config:{assignments:[{name:'file',value:'{{input.source.file}}'},{name:'risk',value:'{{input.source.meta.risk}}'}]}}]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');const run=workflow.runs(definition.id)[0],consumer=h.requests.find(request=>request.model==='fixture'&&request.messages?.some(message=>message.role==='user'&&message.content?.includes('README.md'))),prompt=consumer.messages.find(message=>message.role==='user').content
 assert.deepEqual(run.variables,{file:'README.md',risk:'low'})
 assert.match(prompt,/"file": "README.md"/)
 assert.match(prompt,/"risk": "low"/)
 assert.match(prompt,/"source": \{/)
 assert.doesNotMatch(prompt,/输入参数说明/)
})

test('workflow keeps upstream inputs separated by source node',async t=>{
 const h=await harness(t,()=>response('完成')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const edge=(id,name,targetNodeIds,outputValue)=>({id,name,condition:'始终',color:'#347fc5',targetNodeIds,outputValue}),definition=workflow.save({name:'多上游输入隔离',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'start',nodes:[{id:'start',name:'开始通知',type:'notify',branches:[edge('split','分流',['left','right'])],config:{title:'开始',body:'开始'}},{...agentNode('left'),branches:[edge('left-out','左侧完成',['consumer'],'{"result":"left"}')]},{...agentNode('right'),branches:[edge('right-out','右侧完成',['consumer'],'{"result":"right"}')]},{...agentNode('consumer'),config:{...agentNode('consumer').config,inputSignalMode:'all'}}]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');const consumer=h.requests.find(request=>request.messages?.some(message=>message.role==='user'&&message.content?.includes('"left"')&&message.content?.includes('"right"'))),prompt=consumer.messages.find(message=>message.role==='user').content
 assert.match(prompt,/"left": \{\s+"result": "left"\s+\}/)
 assert.match(prompt,/"right": \{\s+"result": "right"\s+\}/)
})

test('agent selects one AI branch and returns the branch JSON output',async t=>{
 const h=await harness(t,()=>response('{"branchId":"approve","output":{"decision":"approve","reason":"符合要求"}}')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose());const edge=(id,name,condition,targetNodeIds,outputValue)=>({id,name,condition,color:'#347fc5',targetNodeIds,outputValue}),definition=workflow.save({name:'Agent 结构化输出',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[{...agentNode('agent'),branches:[edge('approve','批准','当检查结果满足发布标准时',['end'],'{"decision":"","reason":""}'),edge('reject','拒绝','当检查结果不满足发布标准时',['failure'],'{"decision":"","reason":""}')],config:{...agentNode('agent').config,branchMode:'ai',inputs:[{name:'module',description:'待检查的项目名称'}]}},{id:'end',name:'成功',type:'end',branches:[],config:{status:'succeeded',summary:'已批准'}},{id:'failure',name:'失败',type:'end',branches:[],config:{status:'failed',summary:'未批准'}}]})
 assert.throws(()=>workflow.save({...definition,id:undefined,nodes:[{...definition.nodes[0],branches:[edge('bad','无效','任意',[],'{"decision":"preset"}')]}]}),/留空字符串/)
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');const run=workflow.runs(definition.id)[0];assert.equal(run.nodeRuns[0].branchId,'approve');assert.deepEqual(JSON.parse(run.nodeRuns[0].outputValue),{decision:'approve',reason:'符合要求'});assert.equal(run.summary,'已批准')
 const prompt=h.requests.at(-1).messages.find(message=>message.role==='user').content;assert.match(prompt,/必须严格遵守/);assert.match(prompt,/judgement/);assert.match(prompt,/__NO_MATCH__/)
})

test('agent AI branch rejects output outside configured format',async t=>{
 const h=await harness(t,()=>response('{"branchId":"approve","output":{"decision":"approve","reason":"符合要求","extra":"不允许"}}')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose());const edge=(id,name,condition,targetNodeIds,outputValue)=>({id,name,condition,color:'#347fc5',targetNodeIds,outputValue}),definition=workflow.save({name:'Agent 严格输出',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[{...agentNode('agent'),branches:[edge('approve','批准','当检查结果满足发布标准时',[],'{"decision":"","reason":""}')],config:{...agentNode('agent').config,branchMode:'ai'}}]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='failed');const run=workflow.runs(definition.id)[0];assert.match(run.error,/JSON 格式/);assert.match(run.nodeRuns[0].error,/JSON 格式/)
})

test('workflow approval pauses and resumes through an explicit decision',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose());const edge=(id,name,condition,targetNodeIds)=>({id,name,condition,color:'#347fc5',targetNodeIds}),definition=workflow.save({name:'人工确认',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'approval',nodes:[{id:'approval',name:'发布确认',type:'approval',branches:[edge('approved','批准','执行成功',['success']),edge('rejected','拒绝','执行失败',['failure'])],config:{prompt:'是否发布？',approveLabel:'批准发布',rejectLabel:'拒绝'}},{id:'success',name:'成功结束',type:'end',branches:[],config:{status:'succeeded',summary:'已批准'}},{id:'failure',name:'失败结束',type:'end',branches:[],config:{status:'failed',summary:'已拒绝'}}]})
 const started=workflow.start(definition.id);await until(()=>workflow.runs(definition.id).find(run=>run.id===started.id)?.status==='waiting');let waiting=workflow.runs(definition.id).find(run=>run.id===started.id);assert.equal(waiting.nodeRuns[0].status,'waiting');assert.equal(waiting.nodeRuns[0].summary,'是否发布？')
 workflow.resolveApproval(started.id,'approved');await until(()=>workflow.runs(definition.id).find(run=>run.id===started.id)?.status==='succeeded');const completed=workflow.runs(definition.id).find(run=>run.id===started.id);assert.deepEqual(completed.nodeRuns.map(item=>item.nodeId),['approval','success']);assert.equal(completed.nodeRuns[0].outputValue,'approved')
})

test('explicit join waits for every connected upstream',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose());const edge=(id,name,targets)=>({id,name,condition:'始终',color:'#347fc5',targetNodeIds:targets}),definition=workflow.save({name:'显式汇合',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[{id:'source',name:'开始动作',type:'notify',branches:[edge('split','分流',['left','right'])],config:{title:'开始',body:'开始'}},{id:'left',name:'左侧',type:'data',branches:[edge('left-next','完成',['join'])],config:{assignments:[{name:'left',value:'done'}]}},{id:'right',name:'右侧',type:'data',branches:[edge('right-next','完成',['join'])],config:{assignments:[{name:'right',value:'done'}]}},{id:'join',name:'等待全部',type:'join',branches:[edge('finish','结束',['end'])],config:{mode:'all'}},{id:'end',name:'结束',type:'end',branches:[],config:{status:'succeeded',summary:'汇合完成'}}]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');const run=workflow.runs(definition.id)[0];assert.deepEqual(run.nodeRuns.map(item=>item.nodeId),['source','left','right','join','end']);assert.deepEqual(run.nodeInputSignals.join,['left','right'])
})

test('scheduled automation can launch a workflow and mirror its result',async t=>{
 const h=await harness(t,()=>response('自动工作流完成')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose());const definition=workflow.save({name:'自动流程',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[agentNode('agent')]})
 const adapter={exists:(id,projectId)=>workflow.definitions().some(item=>item.id===id&&item.projectId===projectId&&item.enabled),start:(id,update)=>workflow.start(id,update),cancel:id=>workflow.cancel(id)},automation=new AutomationService(path.join(h.root,'automation'),h.agent,undefined,undefined,adapter);t.after(()=>automation.dispose())
 const task=automation.save({name:'调度工作流',enabled:true,projectId:h.project.id,instruction:'工作流触发',workflowId:definition.id,trigger:{type:'daily',time:'09:00'},timezone:'UTC',agent:{model:'workflow',mode:'general',maxSteps:1,fastMode:true,approvalMode:'ask'},execution:{timeoutMinutes:10,retryMax:0,retryDelayMinutes:1,concurrency:'forbid'},output:{notifyOn:'never'}});automation.action(task.id,'run');await until(()=>automation.runs(task.id)[0]?.status==='succeeded');const run=automation.runs(task.id)[0];assert.ok(run.workflowRunId);assert.equal(run.agentTaskIds.length,1);assert.equal(run.summary,'自动工作流完成')
})
