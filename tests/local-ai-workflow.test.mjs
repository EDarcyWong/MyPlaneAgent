import {diagnosticText,writeConversationDiagnostic} from '../dist-electron/main/agent/diagnostics.js'
import {mapVariableReferences} from '../dist-electron/shared/workflow-variable-references.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {LocalAgentService} from '../dist-electron/main/agent/service.js'
import {WorkflowService} from '../dist-electron/main/agent/workflow.js'
import {WorkflowValidationError,workflowValidationMessage,readWorkflowValidationError} from '../dist-electron/shared/workflow-validation.js'
import {evaluateRule,validateDecision} from '../dist-electron/shared/workflow-decisions.js'
import {AutomationService} from '../dist-electron/main/agent/automation.js'
import {connectedOutputBranches,workflowInputPreview} from '../dist-electron/shared/workflow-inputs.js'
import {nextWorkflowNodeName,workflowNodeNameError} from '../dist-electron/shared/workflow-node-names.js'
import {parseWorkflowAiOutput,workflowAiGeneratedTemplate,assembleWorkflowAiOutput} from '../dist-electron/shared/workflow-ai-output.js'
import {parseWorkflowJsonTemplate,renderWorkflowJsonTemplate,workflowJsonError,formatWorkflowJson} from '../dist-electron/shared/workflow-json-template.js'

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check){const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw new Error('workflow timed out');await pause(15)}}
function sandbox(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-workflow-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
async function harness(t,reply){const root=sandbox(t),workspace=path.join(root,'project'),requests=[];fs.mkdirSync(workspace);let calls=0;const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;let request;try{request=JSON.parse(body)}catch{request={}}requests.push(request);const value=reply(calls++,request,body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close()});const agent=new LocalAgentService(path.join(root,'agent'),()=>({endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',maxTokens:1024,contextLength:8192}));t.after(()=>agent.dispose());return {root,agent,project:agent.createProject(workspace,'测试项目'),requests}}
const response=content=>({choices:[{finish_reason:'stop',message:{role:'assistant',content}}]})
const agentNode=(id,onSuccess)=>({id,name:id,type:'agent',...(onSuccess?{onSuccess}:{}),config:{instruction:'检查项目',model:'fixture',mode:'coding',maxSteps:10,fastMode:true,approvalMode:'ask',branchMode:'rules'}})

test('default node names advance beyond the highest existing suffix of the same type',()=>{
 const nodes=[{id:'a',type:'agent',name:'Agent 任务 1'},{id:'b',type:'agent',name:'自定义任务9'},{id:'c',type:'join',name:'汇合 30'}]
 assert.equal(nextWorkflowNodeName([], 'agent','Agent 任务'),'Agent 任务 1')
 assert.equal(nextWorkflowNodeName(nodes,'agent','Agent 任务'),'Agent 任务 10')
 assert.equal(nextWorkflowNodeName(nodes,'join','汇合'),'汇合 31')
 assert.equal(nextWorkflowNodeName(nodes.filter(node=>node.id!=='b'),'agent','Agent 任务'),'Agent 任务 2')
 assert.equal(nextWorkflowNodeName([{id:'legacy',type:'join',name:'汇合'}],'join','汇合'),'汇合 1')
 nodes.push({id:'other',type:'notify',name:' Agent 任务 10 '})
 assert.equal(nextWorkflowNodeName(nodes,'agent','Agent 任务'),'Agent 任务 11')
 assert.match(workflowNodeNameError({id:'new',type:'join',name:'自定义任务9 '},nodes),/必须唯一/)
 assert.equal(workflowNodeNameError(nodes[0],nodes),'')
})

test('saving rejects duplicate component names across types after trimming whitespace',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const definition={name:'组件名称唯一',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[{id:'source',name:'重复名称',type:'notify',config:{title:'通知',body:'完成'},branches:[{id:'next',name:'继续',condition:'始终',color:'#347fc5',targetNodeIds:['end']}]},{id:'end',name:' 重复名称 ',type:'end',config:{status:'succeeded',summary:'结束'},branches:[]}]}
 assert.throws(()=>workflow.save(definition),/重复名称.*必须唯一/)
 definition.nodes[1].name='结束 1'
 assert.doesNotThrow(()=>workflow.save(definition))
 assert.doesNotThrow(()=>workflow.save({...definition,name:'另一工作流'}))
})

test('unreachable data nodes are allowed without exempting other nodes or cycles',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const entry={id:'entry',name:'结束 1',type:'end',config:{status:'succeeded',summary:'完成'},branches:[]}
 const data={id:'data',name:'数据变量 1',type:'data',config:{assignments:[{name:'value',value:'ready'}]},branches:[]}
 const definition={name:'独立数据变量',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'entry',nodes:[entry,data]}
 assert.doesNotThrow(()=>workflow.save(definition))
 const branch=target=>({id:'next',name:'设置完成',condition:'',color:'#347fc5',targetNodeIds:[target],outputValue:'{"result":""}'})
 assert.doesNotThrow(()=>workflow.save({...definition,nodes:[entry,{...data,branches:[branch('entry')]}]}))
 const other={...entry,id:'other',name:'结束 2'}
 assert.throws(()=>workflow.save({...definition,nodes:[entry,data,other]}),/从入口无法到达/)
 assert.throws(()=>workflow.save({...definition,nodes:[entry,{...data,branches:[branch('other')]},other]}),/从入口无法到达/)
 const secondData={...data,id:'data2',name:'数据变量 2',branches:[branch('data')]}
 assert.throws(()=>workflow.save({...definition,nodes:[entry,{...data,branches:[branch('data2')]},secondData]}),/不允许循环/)
})

test('save validation identifies exact invalid nodes and survives Electron message serialization',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const entry={id:'entry',name:'结束 1',type:'end',config:{status:'succeeded',summary:'完成'},branches:[]}
 const definition={name:'错误定位',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'entry',nodes:[entry,{...entry,id:'other',name:'结束 2'}]}
 assert.throws(()=>workflow.save(definition),error=>{
  assert.ok(error instanceof WorkflowValidationError)
  assert.deepEqual(error.nodeIds,['other'])
  const decoded=readWorkflowValidationError(new Error(`Error invoking remote method: Error: ${workflowValidationMessage(error)}`))
  assert.deepEqual(decoded.nodeIds,['other'])
  assert.match(decoded.message,/从入口无法到达/)
  assert.equal(decoded.message.includes('workflow-nodes:'),false)
  return true
 })
 definition.nodes=[entry,{id:'bad',name:'通知 1',type:'notify',config:{title:'',body:'内容'},branches:[]}]
 assert.throws(()=>workflow.save(definition),error=>{assert.deepEqual(error.nodeIds,['bad']);return true})
 definition.nodes=[entry]
 assert.doesNotThrow(()=>workflow.save(definition))
 assert.deepEqual(readWorkflowValidationError(new Error('普通错误')),{message:'普通错误',nodeIds:[]})
})

test('single upstream preview uses only connected branch output without a node ID wrapper',()=>{
 const branch=(id,targets,outputValue)=>({id,name:id,condition:'始终',color:'#347fc5',targetNodeIds:targets,outputValue})
 const x=branch('x',['b','fanout'],'{"result":"","meta":{"reason":""}}'),source={id:'step_mucnyjd1_1',type:'agent',branches:[x,branch('y',['other'],'{"unrelated":""}'),branch('terminal',[],'{"terminal":""}')]}
 assert.deepEqual(connectedOutputBranches(source,'b'),[x])
 assert.deepEqual(workflowInputPreview([source],'b').map(input=>input.value),[{result:'',meta:{reason:''}}])
 assert.deepEqual(workflowInputPreview([source],'fanout').map(input=>input.value),[{result:'',meta:{reason:''}}])
 assert.deepEqual(workflowInputPreview([source],'other').map(input=>input.value),[{unrelated:''}])
 assert.deepEqual(workflowInputPreview([source],'unconnected'),[])
 x.outputValue='{"updated":""}'
 assert.deepEqual(workflowInputPreview([source],'b').map(input=>input.value),[{updated:''}])
})

test('input preview preserves multiple sources and handles connected alternatives and data nodes',()=>{
 const branch=(id,outputValue)=>({id,name:id,condition:'始终',color:'#347fc5',targetNodeIds:['b'],outputValue})
 const left={id:'left',type:'agent',branches:[branch('x','{"meta":{"result":""}}'),branch('y','{"meta":{"reason":""}}')]},right={id:'right',type:'data',assignments:[{name:'result',value:'value'}],branches:[branch('next')]}
 assert.deepEqual(workflowInputPreview([left],'b').map(input=>input.value),[{meta:{result:''}},{meta:{reason:''}}])
 assert.deepEqual(workflowInputPreview([left,right],'b').map(input=>input.value),[{meta:{result:''}},{meta:{reason:''}},{result:''}])
 right.branches=[branch('next','{"nested":{"items":[1,null,true]},"result":""}')]
 assert.deepEqual(workflowInputPreview([right],'b').map(input=>input.value),[{nested:{items:[1,null,true]},result:''}])
 assert.deepEqual(workflowInputPreview([{id:'legacy',type:'agent',branches:[{...branch('old','{"result":""}'),targetNodeIds:undefined,targetNodeId:'b'}]}],'b').map(input=>input.value),[{result:''}])
})

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

test('new workflows run without a project in their own workspace',async t=>{
 const h=await harness(t,()=>response('独立执行完成')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const definition=workflow.save({name:'独立工作流',description:'',enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[agentNode('agent')]})
 assert.equal('projectId' in definition,false)
 const run=workflow.start(definition.id)
 await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 const task=h.agent.get(workflow.runs(definition.id)[0].agentTaskIds[0])
 assert.equal('projectId' in run,false)
 assert.equal(task.projectless,true)
 assert.equal(task.projectId,undefined)
 assert.equal(task.workspace,fs.realpathSync(path.join(h.root,'workflow','workspaces',definition.id)))
})

test('legacy project bindings are removed from workflow storage and execution',async t=>{
 const h=await harness(t,()=>response('完成')),directory=path.join(h.root,'workflow'),workflow=new WorkflowService(directory,h.agent);t.after(()=>workflow.dispose())
 const definition=workflow.save({name:'旧工作流',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[agentNode('agent')]})
 assert.equal('projectId' in definition,false)
 const run=workflow.start(definition.id)
 await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 assert.equal('projectId' in run,false)
 assert.equal(h.agent.get(workflow.runs(definition.id)[0].agentTaskIds[0]).projectless,true)
 workflow.dispose()
 for(const name of ['definitions','versions','runs']){
  const file=path.join(directory,`${name}.json`),rows=JSON.parse(fs.readFileSync(file,'utf8'))
  fs.writeFileSync(file,JSON.stringify(rows.map(row=>({...row,projectId:h.project.id}))))
 }
 const reopened=new WorkflowService(directory,h.agent);t.after(()=>reopened.dispose())
 for(const name of ['definitions','versions','runs']){
  const rows=JSON.parse(fs.readFileSync(path.join(directory,`${name}.json`),'utf8'))
  assert.ok(rows.length)
  assert.ok(rows.every(row=>!('projectId' in row)),`${name} still contains a project binding`)
 }
 assert.equal('projectId' in reopened.definitions()[0],false)
 assert.equal('projectId' in reopened.runs()[0],false)
})

test('Agent direct output forwards its complete answer without branch selection',async t=>{
 const answer='回答：'+ '甲'.repeat(2100),h=await harness(t,()=>response(answer)),notifications=[]
 const workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(_title,body)=>notifications.push(body));t.after(()=>workflow.dispose())
 const definition=workflow.save({name:'直接输出回答',description:'',enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[
  {...agentNode('agent'),config:{...agentNode('agent').config,branchMode:'direct'},branches:[{id:'answer',name:'回答',condition:'旧条件不应执行',color:'#347fc5',outputValue:'{"old":""}',targetNodeIds:['notify']}]},
  {id:'notify',name:'接收回答',type:'notify',config:{title:'回答',body:'{{input.agent.result}}'},branches:[]}
 ]})
 assert.equal(definition.nodes[0].branches[0].condition,'')
 assert.equal(definition.nodes[0].branches[0].outputValue,undefined)
 workflow.start(definition.id)
 await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 const result=workflow.runs(definition.id)[0]
 assert.equal(result.nodeRuns[0].outputValue,JSON.stringify({result:answer}))
 assert.equal(result.nodeRuns[0].summary.length,2000)
 assert.deepEqual(notifications,[answer])
 assert.equal(JSON.stringify(h.requests[0]).includes('"branchId"'),false)
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
 const terminal=workflow.save({...base,name:'无连线输出',nodes:[{...agent,branches:[{id:'terminal',name:'结束',condition:'执行成功',color:'#347fc5',outputValue:'"完成值"'}]}]});assert.equal(terminal.nodes[0].branches[0].targetNodeId,undefined);assert.equal(terminal.nodes[0].branches[0].outputValue,'"完成值"')
 const definition=workflow.save({...base,nodes:[{...agent,branches:[{id:'summary',name:'摘要命中',condition:'摘要包含：检查完成',color:'#347fc5',targetNodeId:'done',outputValue:'"摘要分支输出"'},{id:'always',name:'默认分支',condition:'始终',color:'#8058b4',targetNodeId:'fallback'}]},done,fallback]})
 assert.equal(definition.nodes[0].branches.length,2);assert.equal(definition.nodes[0].branches[1].color,'#8058b4');assert.deepEqual(definition.nodes[0].config.inputs,[{name:'module',description:'待检查的项目名称'}])
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');assert.deepEqual(notifications,[{title:'完成',body:'命中摘要分支'}]);assert.equal(workflow.runs(definition.id)[0].nodeRuns[0].outputValue,'"摘要分支输出"')
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
 const edge=(id,name,condition,targetNodeIds)=>({id,name,condition,color:'#347fc5',targetNodeIds}),definition=workflow.save({name:'结构化路由',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'data',nodes:[{id:'data',name:'数据变量',type:'data',branches:[edge('next','继续','始终',['route'])],config:{assignments:[{name:'risk',value:'high'},{name:'title',value:'风险 {{variables.risk}}'}]}},{id:'route',name:'风险路由',type:'route',branches:[edge('high','高风险','变量：risk 等于：high',['notify']),edge('fallback','默认','始终',['end'])],config:{sourceNodeId:'data'}},{id:'notify',name:'风险通知',type:'notify',branches:[edge('done','结束','始终',['end'])],config:{title:'{{variables.title}}',body:'风险等级：{{variables.risk}}'}},{id:'end',name:'成功结束',type:'end',branches:[],config:{status:'succeeded',summary:'处理完成：{{variables.risk}}'}}]})
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
 assert.deepEqual(JSON.parse(prompt.split('输入 JSON：\n')[1].split('\n\n工作流上下文：')[0]),{file:'README.md',meta:{risk:'low'}})
 assert.doesNotMatch(prompt,/输入参数说明/)
})

test('data nodes output directly after setting variables without evaluating branch conditions',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>notifications.push({title,body}));t.after(()=>workflow.dispose())
 const definition=workflow.save({name:'数据变量组件直接输出',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'data',nodes:[
  {id:'data',name:'数据变量 1',type:'data',config:{assignments:[{name:'result',value:'ready'}]},branches:[{id:'done',name:'设置完成',condition:'执行失败',color:'#347fc5',targetNodeIds:['left','right'],outputValue:'{"result":"{{variables.result}}"}'}]},
  ...['left','right'].map(id=>({id,name:id,type:'notify',config:{title:id,body:'{{input.result}}'},branches:[]})),
 ]})
 assert.equal(definition.nodes[0].branches[0].condition,'')
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 assert.deepEqual(notifications,[{title:'left',body:'ready'},{title:'right',body:'ready'}])
 assert.equal(h.requests.length,0)
 const data=definition.nodes[0]
 assert.throws(()=>workflow.save({...definition,nodes:[{...data,branches:[data.branches[0],{...data.branches[0],id:'extra',color:'#8058b4'}]},...definition.nodes.slice(1)]}),/一个输出分支/)
 const invalid=workflow.save({...definition,id:undefined,nodes:[{...data,branches:[{...data.branches[0],outputValue:'{"result":"{{input.missing.result}}"}'}]},...definition.nodes.slice(1)]})
 workflow.start(invalid.id);await until(()=>workflow.runs(invalid.id)[0]?.status==='failed')
 assert.equal(workflow.runs(invalid.id)[0].nodeRuns.length,1)
 assert.match(workflow.runs(invalid.id)[0].error,/不存在或来源不唯一/)
})

test('single upstream AI branch passes its exact JSON to the consumer and supports existing references',async t=>{
 const h=await harness(t,n=>response(n===0?'{"branchId":"x","output":{"result":"actual"}}':'{"branchId":"done","output":{"consumed":"yes"}}')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const edge=(id,targetNodeIds,outputValue)=>({id,name:id,condition:'始终',color:'#347fc5',targetNodeIds,outputValue}),sourceId='step_mucnyjd1_1',definition=workflow.save({name:'分支输入原始格式',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:sourceId,nodes:[{...agentNode(sourceId),config:{...agentNode(sourceId).config,branchMode:'ai'},branches:[edge('x',['b'],'{"result":""}'),edge('y',[],'{"unrelated":""}')]},{...agentNode('b'),config:{...agentNode('b').config,branchMode:'ai',instruction:`直接：{{input.result}}；旧引用：{{input.${sourceId}.result}}`},branches:[edge('done',[],'{"consumed":""}')]}]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 const prompt=h.requests.at(-1).messages.find(message=>message.role==='user').content
 assert.deepEqual(JSON.parse(prompt.split('输入 JSON：\n')[1].split('\n\n工作流上下文：')[0]),{result:'actual'})
 assert.match(prompt,/直接：actual；旧引用：actual/)
 assert.deepEqual(workflow.runs(definition.id)[0].nodeRuns.map(node=>node.nodeId),[sourceId,'b'])
})

test('workflow keeps multiple upstream JSON payloads separate without source wrappers',async t=>{
 const h=await harness(t,()=>response('完成')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const edge=(id,name,targetNodeIds,outputValue)=>({id,name,condition:'始终',color:'#347fc5',targetNodeIds,outputValue}),definition=workflow.save({name:'多上游输入隔离',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'start',nodes:[{id:'start',name:'开始通知',type:'notify',branches:[edge('split','分流',['left','right'])],config:{title:'开始',body:'开始'}},{...agentNode('left'),branches:[edge('left-out','左侧完成',['consumer'],'{"result":"left"}')]},{...agentNode('right'),branches:[edge('right-out','右侧完成',['consumer'],'{"result":"right"}')]},{...agentNode('consumer'),config:{...agentNode('consumer').config,inputSignalMode:'all'}}]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded');const consumer=h.requests.find(request=>request.messages?.some(message=>message.role==='user'&&message.content?.includes('"left"')&&message.content?.includes('"right"'))),prompt=consumer.messages.find(message=>message.role==='user').content
 const inputSection=prompt.split('\n\n工作流上下文：')[0],payloads=[...inputSection.matchAll(/输入 JSON：\n([\s\S]*?)(?=\n\n上游来源：|$)/g)].map(match=>JSON.parse(match[1]))
 assert.deepEqual(payloads,[{result:'left'},{result:'right'}])
 assert.doesNotMatch(inputSection,/"(?:left|right)":\s*\{/)
})

test('all non-agent node types receive and forward exactly the connected output JSON',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>notifications.push({title,body}));t.after(()=>workflow.dispose())
 const next=(target,outputValue='{"result":"{{input.result}}"}')=>[{id:'next',name:'继续',condition:'始终',color:'#347fc5',targetNodeIds:[target],outputValue}]
 const definition=workflow.save({name:'全部节点保持分支结构',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[
  {id:'source',name:'源数据',type:'data',config:{assignments:[{name:'internal',value:'must not leak'}]},branches:next('join','{"result":"exact"}')},
  {id:'join',name:'汇合',type:'join',config:{mode:'all'},branches:next('condition')},
  {id:'condition',name:'条件',type:'condition',config:{sourceNodeId:'join',operator:'succeeded'},branches:next('route')},
  {id:'route',name:'路由',type:'route',config:{sourceNodeId:'condition'},branches:next('data')},
  {id:'data',name:'变量',type:'data',config:{assignments:[{name:'received',value:'{{input.result}}'}]},branches:next('notify')},
  {id:'notify',name:'通知',type:'notify',config:{title:'{{input.result}}',body:'{{input.data.result}}'},branches:next('approval')},
  {id:'approval',name:'确认',type:'approval',config:{prompt:'{{input.result}}',approveLabel:'批准',rejectLabel:'拒绝'},branches:[...next('end'),{id:'reject',name:'拒绝',condition:'',color:'#c65a52',targetNodeIds:[],outputValue:'{"result":""}'}]},
  {id:'end',name:'结束',type:'end',config:{status:'succeeded',summary:'{{input.result}}'},branches:[]},
 ]})
 const started=workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='waiting')
 const waiting=workflow.runs(definition.id)[0];assert.equal(waiting.nodeRuns.at(-1).summary,'exact');assert.equal(waiting.variables.received,'exact');assert.deepEqual(notifications,[{title:'exact',body:'exact'}])
 for(const run of waiting.nodeRuns.slice(0,-1))assert.deepEqual(JSON.parse(run.outputValue),{result:'exact'})
 workflow.resolveApproval(started.id,'approved');await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 assert.equal(workflow.runs(definition.id)[0].summary,'exact')
})

test('downstream nodes receive the defined failure branch output too',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,()=>false);t.after(()=>workflow.dispose())
 const definition=workflow.save({name:'失败分支输出',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[
  {id:'source',name:'失败通知',type:'notify',config:{title:'通知',body:'失败'},branches:[{id:'failure',name:'失败',condition:'执行失败',color:'#347fc5',targetNodeIds:['end'],outputValue:'{"result":"handled"}'}]},
  {id:'end',name:'处理失败',type:'end',config:{status:'succeeded',summary:'{{input.result}}'},branches:[]},
 ]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 assert.equal(workflow.runs(definition.id)[0].nodeRuns[0].status,'failed')
 assert.equal(workflow.runs(definition.id)[0].summary,'handled')
})

test('agent selects one AI branch and returns the branch JSON output',async t=>{
 const h=await harness(t,()=>response('{"branchId":"approve","output":{"decision":"approve","reason":"符合要求"}}')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose());const edge=(id,name,condition,targetNodeIds,outputValue)=>({id,name,condition,color:'#347fc5',targetNodeIds,outputValue}),definition=workflow.save({name:'Agent 结构化输出',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[{...agentNode('agent'),branches:[edge('approve','批准','当检查结果满足发布标准时',['end'],'{"decision":"","reason":""}'),edge('reject','拒绝','当检查结果不满足发布标准时',['failure'],'{"decision":"","reason":""}')],config:{...agentNode('agent').config,branchMode:'ai',inputs:[{name:'module',description:'待检查的项目名称'}]}},{id:'end',name:'成功',type:'end',branches:[],config:{status:'succeeded',summary:'已批准'}},{id:'failure',name:'失败',type:'end',branches:[],config:{status:'failed',summary:'未批准'}}]})
 assert.doesNotThrow(()=>workflow.save({...definition,id:undefined,nodes:[{...definition.nodes[0],branches:[edge('bad','固定值','任意',[],'{"decision":"preset"}')]}]}))
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

test('AI output templates distinguish generated fields from references without reinterpreting model text',()=>{
 const template=parseWorkflowAiOutput('{"answer":"","nested":{"reason":"","data":"{{input.source}}"},"message":"输入：{{input.value}}"}')
 assert.deepEqual(workflowAiGeneratedTemplate(template),{answer:'',nested:{reason:''}})
 const data={result:'引号"\n换行',list:[1,true,null]},output=assembleWorkflowAiOutput(template,{answer:'{{input.secret}}',nested:{reason:'generated'}},key=>key==='input.source'?data:'原值')
 assert.deepEqual(output,{answer:'{{input.secret}}',nested:{reason:'generated',data},message:'输入：原值'})
 const referencesOnly=parseWorkflowAiOutput('{"nested":{"data":"{{input.source}}"}}')
 assert.deepEqual(workflowAiGeneratedTemplate(referencesOnly),{})
 assert.deepEqual(assembleWorkflowAiOutput(referencesOnly,{},()=>data),{nested:{data}})
 assert.throws(()=>assembleWorkflowAiOutput(referencesOnly,{},()=>undefined),/不存在或来源不唯一/)
 assert.deepEqual(parseWorkflowAiOutput('{"result":"{{input.source}"}'),{result:'{{input.source}'})
})

test('AI branches insert entire upstream objects and same-name fields alongside generated output',async t=>{
 const h=await harness(t,()=>response('{"branchId":"done","output":{"reason":"生成说明","nested":{"summary":"生成摘要"}}}')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const left={result:'通过"\n下一行',details:{owner:'张三'}},right={result:90,items:[1,false,null]},edge=(id,targets,outputValue)=>({id,name:id,condition:'始终',color:'#347fc5',targetNodeIds:targets,outputValue})
 const template={reason:'',left:'{{input.left}}',rightScore:'{{input.right.result}}',nested:{summary:'',items:'{{input.right.items}}'}}
 const definition=workflow.save({name:'AI 引用上游数据',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'left',entryNodeIds:['left','right'],nodes:[
  ...Object.entries({left,right}).map(([id,value])=>({id,name:id,type:'notify',config:{title:id,body:'完成'},branches:[edge('next',['consumer'],JSON.stringify(value))]})),
  {...agentNode('consumer'),config:{...agentNode('consumer').config,branchMode:'ai',inputSignalMode:'all'},branches:[edge('done',['end'],JSON.stringify(template))]},
  {id:'end',name:'结束',type:'end',config:{status:'succeeded',summary:'{{input.rightScore}}'},branches:[]},
 ]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 const run=workflow.runs(definition.id)[0]
 assert.deepEqual(JSON.parse(run.nodeRuns.find(node=>node.nodeId==='consumer').outputValue),{reason:'生成说明',left,rightScore:90,nested:{summary:'生成摘要',items:right.items}})
 assert.equal(run.summary,'90')
 const prompt=h.requests.at(-1).messages.find(message=>message.role==='user').content
 const branches=JSON.parse(prompt.split('输出分支：\n')[1].split('\n\n任务要求：')[0])
 assert.deepEqual(branches[0].outputFormat,{reason:'',nested:{summary:''}})
 assert.match(prompt,/固定值和引用字段由程序自动填入/)
})

test('AI can select a branch containing only references and fails if the selected reference is missing',async t=>{
 const h=await harness(t,()=>response('{"branchId":"done","output":{}}')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 for(const missing of [false,true]) {
  const definition=workflow.save({name:`引用分支 ${missing}`,description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[
   {id:'source',name:'来源',type:'notify',config:{title:'开始',body:'完成'},branches:[{id:'next',name:'继续',condition:'始终',color:'#347fc5',targetNodeIds:['consumer'],outputValue:'{"result":{"items":[1,2]}}'}]},
   {...agentNode('consumer'),config:{...agentNode('consumer').config,branchMode:'ai'},branches:[{id:'done',name:'输出',condition:'始终',color:'#347fc5',targetNodeIds:[],outputValue:JSON.stringify({data:missing?'{{input.source.missing}}':'{{input.source.result}}'})}]},
  ]})
  workflow.start(definition.id);await until(()=>['failed','succeeded'].includes(workflow.runs(definition.id)[0]?.status))
  const run=workflow.runs(definition.id)[0]
  assert.equal(run.status,missing?'failed':'succeeded')
  if(missing) assert.match(run.error,/不存在或来源不唯一/)
  else assert.deepEqual(JSON.parse(run.nodeRuns.at(-1).outputValue),{data:{items:[1,2]}})
 }
})

test('join JSON templates preserve types and escape values without interpreting upstream text again',()=>{
 const values={text:'引号"与换行\n{{input.secret}}',object:{n:1,items:[true,null]},number:0,flag:false,empty:null}
 const output=JSON.parse(renderWorkflowJsonTemplate(JSON.stringify({text:'{{text}}',object:'{{object}}',number:'{{number}}',flag:'{{flag}}',empty:'{{empty}}',message:'值：{{text}}',list:['{{number}}']}),key=>values[key]))
 assert.deepEqual(output,{...values,message:`值：${values.text}`,list:[0]})
 assert.throws(()=>parseWorkflowJsonTemplate('{"result":"a","result":"b"}'),/重复字段/)
 assert.throws(()=>parseWorkflowJsonTemplate('{"nested":{"result":1,"\\u0072esult":2}}'),/重复字段/)
 assert.deepEqual(parseWorkflowJsonTemplate('{"a":{"result":1},"b":{"result":2}}'),{a:{result:1},b:{result:2}})
 assert.throws(()=>parseWorkflowJsonTemplate('{"result":{{input.result}}}'),/有效 JSON/)
 assert.throws(()=>parseWorkflowJsonTemplate('[]'),/JSON 对象/)
 assert.throws(()=>renderWorkflowJsonTemplate('{"result":"{{input.missing}}"}',()=>undefined),/不存在或来源不唯一/)
})

test('output JSON validation and formatting preserve values and template references',()=>{
 for(const value of ['', '   ', '{"result":""}', '[1,true,null]', '"文本"', '0', 'false', 'null'])
  assert.equal(workflowJsonError(value),'')
 for(const value of ['普通文本','{"result":}', '{"result":1,}', '{"result":{{input.source.result}}}', '{"result":1,"result":2}']) {
  assert.notEqual(workflowJsonError(value),'')
  assert.throws(()=>formatWorkflowJson(value),/有效 JSON|重复字段/)
 }
 const source='{"result":"{{input.source.result}}","nested":{"text":"引号\\\"和换行\\n","items":[1,false,null]}}'
 const formatted=formatWorkflowJson(source)
 assert.match(formatted,/\n  "result":/)
 assert.deepEqual(JSON.parse(formatted),JSON.parse(source))
 assert.equal(formatWorkflowJson(formatted),formatted)
})

test('every node type rejects non-JSON branch output when saved',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose())
 const configs={agent:agentNode('target').config,condition:{sourceNodeId:'source',operator:'succeeded'},route:{sourceNodeId:'source'},data:{assignments:[{name:'value',value:'test'}]},join:{mode:'all'},approval:{prompt:'确认',approveLabel:'是',rejectLabel:'否'},notify:{title:'通知',body:'完成'},end:{status:'succeeded',summary:'结束'}}
 const branch={id:'output',name:'输出',condition:'始终',color:'#347fc5',targetNodeIds:[]}
 for(const [type,config] of Object.entries(configs)) {
  const definition={name:`校验 ${type}`,description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[{id:'source',name:'来源',type:'notify',config:configs.notify,branches:[{...branch,targetNodeIds:['target']}]},{id:'target',name:'目标',type,config,branches:[{...branch,outputValue:'普通文本'}]}]}
  assert.throws(()=>workflow.save(definition),/目标.*输出.*有效 JSON/)
  definition.nodes[1].branches[0].outputValue='{"result":""}'
  if(type==='approval') definition.nodes[1].branches.push({...branch,id:'rejected',name:'拒绝',outputValue:'{"result":""}'})
  if(type==='end') {
   assert.throws(()=>workflow.save(definition),/不能包含分支/)
   continue
  }
  assert.doesNotThrow(()=>workflow.save(definition))
  if(type!=='join') {
   definition.nodes[1].branches[0].outputValue=''
   assert.doesNotThrow(()=>workflow.save(definition))
  }
 }
})

test('non-join output templates remain valid JSON after resolving upstream quotes and objects',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>notifications.push({title,body}));t.after(()=>workflow.dispose())
 const value='引号"、反斜杠\\与换行\n下一行',meta={count:2,items:[true,null]},edge=(target,outputValue)=>({id:'next',name:'下一步',condition:'始终',color:'#347fc5',targetNodeIds:[target],outputValue})
 const definition=workflow.save({name:'通用 JSON 输出模板',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[
  {id:'source',name:'来源',type:'notify',config:{title:'来源',body:'完成'},branches:[edge('data',JSON.stringify({result:value,meta}))]},
  {id:'data',name:'转换',type:'data',config:{assignments:[{name:'tag',value:'fixed'}]},branches:[edge('consumer','{"copied":"{{input.result}}","object":"{{source.output.meta}}","tag":"{{variables.tag}}"}')]},
  {id:'consumer',name:'接收',type:'notify',config:{title:'{{input.tag}}',body:'{{input.copied}}'},branches:[]},
 ]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 assert.deepEqual(JSON.parse(workflow.runs(definition.id)[0].nodeRuns.find(node=>node.nodeId==='data').outputValue),{copied:value,object:meta,tag:'fixed'})
 assert.deepEqual(notifications.at(-1),{title:'fixed',body:value})
})

test('join assembles selected upstream fields without conditions or AI and fans out its output',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>notifications.push({title,body}));t.after(()=>workflow.dispose())
 const leftId='step_mucopz0b_1',rightId='step_mucor379_3',edge=(id,targets,outputValue,condition='始终')=>({id,name:id,condition,color:'#347fc5',targetNodeIds:targets,outputValue})
 const left={result:'通过"\n下一行',ignored:'不输出'},right={result:90,details:{items:['one',2],valid:true}},template=JSON.stringify({reviewResult:`{{input.${leftId}.result}}`,scoreResult:`{{input.${rightId}.result}}`,details:`{{input.${rightId}.details}}`})
 const definition=workflow.save({name:'汇合 JSON 模板',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:leftId,entryNodeIds:[leftId,rightId],nodes:[
  {id:leftId,name:'左侧',type:'notify',config:{title:'左侧',body:'完成'},branches:[edge('left',['join'],JSON.stringify(left))]},
  {id:rightId,name:'右侧',type:'notify',config:{title:'右侧',body:'完成'},branches:[edge('right',['join'],JSON.stringify(right))]},
  {id:'join',name:'汇合',type:'join',config:{mode:'all'},branches:[edge('output',['consumer','copy'],template,'不应校验或执行的旧条件')]},
  {id:'consumer',name:'下游',type:'notify',config:{title:'{{input.scoreResult}}',body:'{{input.reviewResult}}'},branches:[]},
  {id:'copy',name:'另一下游',type:'notify',config:{title:'{{input.join.details.valid}}',body:'{{input.details.items.1}}'},branches:[]},
 ]})
 assert.equal(definition.nodes.find(node=>node.id==='join').branches[0].condition,'')
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 const run=workflow.runs(definition.id)[0]
 assert.deepEqual(JSON.parse(run.nodeRuns.find(node=>node.nodeId==='join').outputValue),{reviewResult:left.result,scoreResult:90,details:right.details})
 assert.deepEqual(notifications.slice(-2),[{title:'90',body:left.result},{title:'true',body:'2'}])
 assert.equal(h.requests.length,0)
 const nodes=definition.nodes.map(node=>node.id==='join'?{...node,branches:[node.branches[0],{...node.branches[0],id:'second',color:'#8058b4'}]}:node)
 assert.throws(()=>workflow.save({...definition,nodes}),/一个输出分支/)
 assert.throws(()=>workflow.save({...definition,nodes:definition.nodes.map(node=>node.id==='join'?{...node,branches:[]}:node)}),/有且只有一个输出分支/)
 for(const outputValue of ['{"result":"a","result":"b"}','{bad}'])
  assert.throws(()=>workflow.save({...definition,nodes:definition.nodes.map(node=>node.id==='join'?{...node,branches:[{...node.branches[0],outputValue}]}:node)}),/重复字段|有效 JSON/)
})

test('join stops on unavailable or ambiguous template inputs instead of sending partial data',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent,undefined,(title,body)=>notifications.push({title,body}));t.after(()=>workflow.dispose())
 const edge=(target,outputValue)=>({id:'next',name:'下一步',condition:'始终',color:'#347fc5',targetNodeIds:[target],outputValue})
 for(const [mode,expression] of [['all','input.result'],['any','input.missing.result']]) {
  const definition=workflow.save({name:`缺失数据 ${mode}`,description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'left',entryNodeIds:['left','right'],nodes:[
   ...['left','right'].map(id=>({id,name:id,type:'notify',config:{title:id,body:'source'},branches:[edge('join',JSON.stringify({result:id}))]})),
   {id:'join',name:'汇合',type:'join',config:{mode},branches:[{...edge('consumer',JSON.stringify({result:`{{${expression}}}`})),condition:''}]},
   {id:'consumer',name:'下游',type:'notify',config:{title:'不应执行',body:'不应执行'},branches:[]},
  ]})
  workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='failed')
  const run=workflow.runs(definition.id)[0]
  assert.match(run.error,/不存在或来源不唯一/)
  assert.equal(run.nodeRuns.find(node=>node.nodeId==='join').status,'failed')
  assert.equal(run.nodeRuns.some(node=>node.nodeId==='consumer'),false)
 }
})

test('scheduled automation can launch a workflow and mirror its result',async t=>{
 const h=await harness(t,()=>response('自动工作流完成')),workflow=new WorkflowService(path.join(h.root,'workflow'),h.agent);t.after(()=>workflow.dispose());const definition=workflow.save({name:'自动流程',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'agent',nodes:[agentNode('agent')]})
 const adapter={exists:id=>workflow.definitions().some(item=>item.id===id&&item.enabled),start:(id,update)=>workflow.start(id,update),cancel:id=>workflow.cancel(id)},automation=new AutomationService(path.join(h.root,'automation'),h.agent,undefined,undefined,adapter);t.after(()=>automation.dispose())
 const task=automation.save({name:'调度工作流',enabled:true,instruction:'工作流触发',workflowId:definition.id,trigger:{type:'daily',time:'09:00'},timezone:'UTC',agent:{model:'workflow',mode:'general',maxSteps:1,fastMode:true,approvalMode:'ask'},execution:{timeoutMinutes:10,retryMax:0,retryDelayMinutes:1,concurrency:'forbid'},output:{notifyOn:'never'}});assert.equal('projectId' in task,false);automation.action(task.id,'run');await until(()=>automation.runs(task.id)[0]?.status==='succeeded');const run=automation.runs(task.id)[0];assert.ok(run.workflowRunId);assert.equal(run.agentTaskIds.length,1);assert.equal(run.summary,'自动工作流完成')
})


test('typed decision rules handle data types, empty values and missing references',()=>{
 const resolve=key=>({score:81,approved:false,tags:['high',{a:1,b:2}],record:{risk:'high'}})[key]
 const rule=(kind,left,operator,right='')=>evaluateRule({kind,left,operator,right},resolve)
 assert.equal(rule('number','{{score}}','gte','80'),true)
 assert.equal(rule('number','9','gt','80'),false)
 assert.equal(rule('boolean','{{approved}}','eq','false'),true)
 assert.equal(rule('text','high','starts','hi'),true)
 assert.equal(rule('text','','empty'),true)
 assert.equal(rule('text',' ','empty'),false)
 assert.equal(rule('collection','{{tags}}','contains','"high"'),true)
 assert.equal(rule('collection','{{tags}}','contains','{"b":2,"a":1}'),true)
 assert.equal(rule('collection','{{record}}','hasKey','risk'),true)
 assert.equal(rule('collection','[]','empty'),true)
 assert.throws(()=>rule('number','','eq','0'),/有效数字/)
 assert.throws(()=>rule('boolean','1','eq','true'),/true 或 false/)
 assert.throws(()=>rule('text','{{missing}}','empty'),/字段不存在/)
 assert.throws(()=>rule('text','{{score}}','eq','81'),/字符串/)
})

test('decision nodes execute only the selected branch and preserve configured output JSON',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'decisions'),h.agent);t.after(()=>workflow.dispose())
 for(const [type,mode,expected] of [['judge','all','yes'],['predicate','all','no'],['predicate','any','yes'],['switch','high','yes'],['switch','low','no']]){
  const branch=(id,target,outputValue)=>({id,name:id,condition:'ignored',color:'#347fc5',targetNodeIds:[target],outputValue})
  const config=type==='switch'?{value:mode,kind:'text',cases:[{branchId:'yes',value:'high'}],defaultBranchId:'no'}:{mode,rules:[{kind:'number',left:'{{input.source.score}}',operator:'gte',right:'80'},...(type==='predicate'?[{kind:'boolean',left:'false',operator:'eq',right:'true'}]:[])]}
  const definition=workflow.save({name:type+mode,description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'source',nodes:[
   {id:'source',name:'数据变量',type:'data',config:{assignments:[{name:'ready',value:'yes'}]},branches:[branch('out','decision','{"score":85,"reason":"checked"}')]},
   {id:'decision',name:'判断',type,config,branches:[branch('yes','pass','{"reason":"{{input.source.reason}}"}'),branch('no','fail','{"result":"no"}')]},
   {id:'pass',name:'通过',type:'end',config:{status:'succeeded',summary:'pass'},branches:[]},
   {id:'fail',name:'未通过',type:'end',config:{status:'succeeded',summary:'fail'},branches:[]}
  ]})
  assert.equal(definition.nodes[1].branches[0].condition,'')
  workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
  const run=workflow.runs(definition.id)[0],decision=run.nodeRuns.find(node=>node.nodeId==='decision')
  assert.equal(decision.branchId,expected)
  assert.deepEqual(JSON.parse(decision.outputValue),expected==='yes'?{reason:'checked'}:{result:'no'})
  assert.equal(run.nodeRuns.some(node=>node.nodeId===(expected==='yes'?'fail':'pass')),false)
 }
 assert.equal(h.requests.length,0)
})

test('decision configuration rejects duplicate switch values and highlights invalid nodes',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'decisions'),h.agent);t.after(()=>workflow.dispose())
 const branch=id=>({id,name:id,condition:'',color:'#347fc5',targetNodeIds:[],outputValue:'{"result":""}'})
 const node={id:'decision',name:'Switch',type:'switch',config:{value:'1',kind:'number',cases:[{branchId:'a',value:'1'},{branchId:'b',value:'1.0'}],defaultBranchId:'default'},branches:['a','b','default'].map(branch)}
 const input={name:'重复匹配值',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'decision',nodes:[node]}
 assert.throws(()=>workflow.save(input),error=>{assert.match(error.message,/不能重复/);assert.deepEqual(error.nodeIds,['decision']);return true})
 node.config.cases[1].value='2'
 assert.doesNotThrow(()=>workflow.save(input))
 node.config.defaultBranchId='missing'
 assert.throws(()=>validateDecision(node),/分支配置无效/)
 const bad={...node,type:'judge',config:{mode:'all',rules:[{kind:'number',left:'1',operator:'contains',right:'2'}]},branches:[branch('a'),branch('b')]}
 assert.throws(()=>validateDecision(bad),/运算符无效/)
 bad.config.rules[0]={kind:'text',left:'{{input.missing.result}}',operator:'empty',right:''}
 const definition=workflow.save({...input,nodes:[bad]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='failed')
 assert.match(workflow.runs(definition.id)[0].error,/字段不存在/)
})


test('named component variables stay isolated and persist stable references across renaming',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'named-variables'),h.agent);t.after(()=>workflow.dispose())
 const branch=(id,target,outputValue)=>({id,name:id,condition:'',color:'#347fc5',targetNodeIds:target?[target]:[],outputValue})
 const input={name:'同名变量',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:5,entryNodeId:'left',nodes:[
  {id:'left',name:'数据变量 1',type:'data',config:{assignments:[{name:'result',value:'left'}]},branches:[branch('next','right','{"result":"{{数据变量 1.result}}"}')]},
  {id:'right',name:'数据变量 2',type:'data',config:{assignments:[{name:'result',value:'right'},{name:'copy',value:'{{数据变量 1.result}} / {{数据变量 2.result}}'}]},branches:[branch('done',null,'{"left":"{{数据变量 1.result}}","right":"{{数据变量 2.result}}","copy":"{{数据变量 2.copy}}"}')]}
 ]}
 const saved=workflow.save(input)
 assert.match(saved.nodes[1].branches[0].outputValue,/nodeVariables.left.result/)
 workflow.start(saved.id);await until(()=>workflow.runs(saved.id)[0]?.status==='succeeded')
 let run=workflow.runs(saved.id)[0]
 assert.deepEqual(JSON.parse(run.nodeRuns.at(-1).outputValue),{left:'left',right:'right',copy:'left / right'})
 assert.equal(run.nodeVariables.left.result,'left');assert.equal(run.nodeVariables.right.result,'right')
 saved.nodes[0].name='改名后的变量'
 const renamed=workflow.save(saved)
 const displayed=mapVariableReferences(renamed,renamed.nodes,'display')
 assert.match(displayed.nodes[1].branches[0].outputValue,/改名后的变量.result/)
 workflow.start(saved.id);await until(()=>workflow.runs(saved.id)[0]?.status==='succeeded')
 run=workflow.runs(saved.id)[0]
 assert.equal(JSON.parse(run.nodeRuns.at(-1).outputValue).left,'left')
 const missing=structuredClone(input);missing.name='未执行的变量';missing.entryNodeId='right';missing.nodes[0].branches=[]
 const bad=workflow.save(missing);workflow.start(bad.id);await until(()=>workflow.runs(bad.id)[0]?.status==='failed')
 assert.match(workflow.runs(bad.id)[0].error,/尚未赋值或不存在/)
})

test('variable reference mapping preserves JSON formatting, quotes and component identity',()=>{
 const nodes=[{id:'a',name:'数据变量 1',type:'data'},{id:'b',name:'数据变量 1.子项',type:'data'}]
 const value={outputValue:'{ "value": "{{数据变量 1.子项.result}}" }',body:'值：{{数据变量 1.result}}'}
 const stored=mapVariableReferences(value,nodes,'store')
 assert.equal(stored.outputValue,'{ "value": "{{nodeVariables.b.result}}" }')
 nodes[1].name='带"引号的变量'
 const visible=mapVariableReferences(stored,nodes,'display')
 assert.equal(JSON.parse(visible.outputValue).value,'{{带"引号的变量.result}}')
 assert.deepEqual(mapVariableReferences(visible,nodes,'store'),stored)
})


const approvalBranch=(id,targets=[],outputValue='{"result":""}')=>({id,name:id,condition:'',color:'#347fc5',targetNodeIds:targets,outputValue})
const approvalNode=(id,wait)=>({id,name:id,type:'approval',config:{title:'确认 '+id,prompt:'是否继续 '+id+'？',approveLabel:'批准',rejectLabel:'拒绝',...(wait?{wait}:{})},branches:[approvalBranch('yes'),approvalBranch('no')]})

test('multiple approvals only block their own paths and decisions are recorded once',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'approval-parallel'),h.agent,undefined,(title)=>notifications.push(title));t.after(()=>workflow.dispose())
 const a=approvalNode('a'),b=approvalNode('b');a.branches[0]=approvalBranch('yes',['join'],'{"from":"a"}');b.branches[0]=approvalBranch('yes',['join'],'{"from":"b"}')
 const definition=workflow.save({name:'独立确认',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'start',nodes:[
  {id:'start',name:'开始通知',type:'notify',config:{title:'start',body:'start'},branches:[{...approvalBranch('next',['a','b','free']),condition:'始终'}]},a,b,
  {id:'free',name:'独立通知',type:'notify',config:{title:'free',body:'free'},branches:[]},
  {id:'join',name:'汇合',type:'join',config:{mode:'all'},branches:[approvalBranch('done',[],'{"a":"{{input.a.from}}","b":"{{input.b.from}}"}')]}
 ]})
 const started=workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='waiting')
 let run=workflow.runs(definition.id)[0]
 assert.deepEqual(notifications,['start','free']);assert.equal(run.nodeRuns.filter(item=>item.status==='waiting').length,2)
 assert.equal(run.executionStartedAt,undefined);assert.ok(run.executionRemainingMs>0)
 assert.throws(()=>workflow.resolveApproval(started.id,'approved'),/请选择/)
 workflow.resolveApproval(started.id,'approved','b','检查通过')
 await until(()=>workflow.runs(definition.id)[0]?.status==='waiting')
 assert.throws(()=>workflow.resolveApproval(started.id,'approved','b'),/请选择/)
 run=workflow.runs(definition.id)[0]
 assert.equal(run.nodeRuns.find(item=>item.nodeId==='b').approval.note,'检查通过')
 assert.equal(run.nodeRuns.find(item=>item.nodeId==='a').status,'waiting')
 workflow.resolveApproval(started.id,'approved','a')
 await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 run=workflow.runs(definition.id)[0]
 assert.deepEqual(JSON.parse(run.nodeRuns.find(item=>item.nodeId==='join').outputValue),{a:'a',b:'b'})
 assert.equal(run.nodeRuns.find(item=>item.nodeId==='b').approval.decision,'approved')
 assert.ok(run.nodeRuns.find(item=>item.nodeId==='b').approval.decidedAt)
})

test('approval duration, deadline and failure timeouts use their own clock',async t=>{
 const h=await harness(t,()=>response('unused')),workflow=new WorkflowService(path.join(h.root,'approval-timeouts'),h.agent);t.after(()=>workflow.dispose())
 for(const wait of [{mode:'duration',durationMinutes:0.002,onTimeout:'reject'},{mode:'until',deadline:new Date(Date.now()-1000).toISOString(),onTimeout:'reject'},{mode:'duration',durationMinutes:0.002,onTimeout:'fail'}]){
  const node=approvalNode('approval',wait);node.branches[1].outputValue='{"result":"timeout rejected"}'
  const definition=workflow.save({name:'确认超时',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'approval',nodes:[node]})
  const started=workflow.start(definition.id);await until(()=>['succeeded','failed'].includes(workflow.runs(definition.id)[0]?.status))
  const run=workflow.runs(definition.id)[0]
  assert.equal(run.nodeRuns[0].approval.decision,'timeout')
  assert.equal(run.status,wait.onTimeout==='fail'?'failed':'succeeded')
  if(wait.onTimeout==='reject'){assert.equal(run.nodeRuns[0].branchId,'no');assert.deepEqual(JSON.parse(run.nodeRuns[0].outputValue),{result:'timeout rejected'})}
  assert.throws(()=>workflow.resolveApproval(started.id,'approved','approval'),/未等待/)
 }
 const node=approvalNode('bad',{mode:'until',deadline:'invalid',onTimeout:'reject'})
 assert.throws(()=>workflow.save({name:'无效时间',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'bad',nodes:[node]}),/截止时间/)
})

test('idle approval survives restart and uses the original workflow version',async t=>{
 const h=await harness(t,()=>response('unused')),directory=path.join(h.root,'approval-restart');let workflow=new WorkflowService(directory,h.agent);t.after(()=>workflow.dispose())
 const node=approvalNode('approval');node.branches[0].outputValue='{"version":"original"}'
 const definition=workflow.save({name:'持久等待',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'approval',nodes:[node]})
 const started=workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='waiting')
 assert.equal(workflow.runs(definition.id)[0].nodeRuns[0].approval.deadline,undefined)
 workflow.dispose();workflow=new WorkflowService(directory,h.agent)
 assert.equal(workflow.runs(definition.id)[0].status,'waiting')
 definition.nodes[0].branches[0].outputValue='{"version":"edited"}';workflow.save(definition)
 workflow.resolveApproval(started.id,'approved','approval','重启后确认')
 await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 assert.deepEqual(JSON.parse(workflow.runs(definition.id)[0].nodeRuns[0].outputValue),{version:'original'})
})


test('notification fixed branches follow delivery outcome and preserve errors',async t=>{
 const h=await harness(t,()=>response('unused'))
 for(const outcome of ['success','unsupported','throw','missing']) {
  const notify=outcome==='missing'?undefined:()=>{if(outcome==='throw')throw new Error('发送异常');return outcome==='success'}
  const workflow=new WorkflowService(path.join(h.root,outcome),h.agent,undefined,notify);t.after(()=>workflow.dispose())
  const node={id:'notify',name:'系统通知',type:'notify',config:{title:'标题',body:'正文',fixedBranches:true},branches:[{...approvalBranch('success',[],'{"sent":true}'),condition:'错误的旧条件'},{...approvalBranch('failure',[],'{"sent":false}'),condition:'错误的旧条件'}]}
  const definition=workflow.save({name:outcome,description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'notify',nodes:[node]})
  assert.equal(definition.nodes[0].branches[0].condition,'')
  workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
  const result=workflow.runs(definition.id)[0].nodeRuns[0]
  assert.equal(result.branchId,outcome==='success'?'success':'failure')
  assert.deepEqual(JSON.parse(result.outputValue),{sent:outcome==='success'})
  if(outcome==='success')assert.equal(result.summary,'系统通知已提交');else assert.ok(result.error)
  node.branches.pop();assert.throws(()=>workflow.save({...definition,nodes:[node]}),/两个分支/)
 }
})

test('path end keeps other paths running and separates final JSON from summary',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'path-end'),h.agent,undefined,title=>notifications.push(title));t.after(()=>workflow.dispose())
 const input={name:'路径结束',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'end',entryNodeIds:['end','other'],nodes:[
  {id:'end',name:'失败路径',type:'end',config:{status:'failed',scope:'path',summary:'业务未通过',resultJson:'{"code":42}'},branches:[]},
  {id:'other',name:'另一条路径',type:'notify',config:{title:'继续执行',body:'完成'},branches:[]}
 ]}
 const definition=workflow.save(input);workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='failed')
 const run=workflow.runs(definition.id)[0]
 assert.deepEqual(notifications,['继续执行']);assert.equal(run.nodeRuns[0].status,'failed')
 assert.equal(run.summary,'业务未通过');assert.equal(run.nodeRuns[0].summary,'业务未通过');assert.deepEqual(JSON.parse(run.nodeRuns[0].outputValue),{code:42})
 assert.match(run.error,/失败路径/)
 input.nodes[0].config.resultJson='not JSON';assert.throws(()=>workflow.save(input),error=>{assert.deepEqual(error.nodeIds,['end']);return /最终结果 JSON/.test(error.message)})
})

test('whole workflow end skips waiting approvals and does not execute queued paths',async t=>{
 const h=await harness(t,()=>response('unused')),notifications=[],workflow=new WorkflowService(path.join(h.root,'whole-end'),h.agent,undefined,title=>notifications.push(title));t.after(()=>workflow.dispose())
 const definition=workflow.save({name:'全局结束',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'approval',entryNodeIds:['approval','end','other'],nodes:[
  approvalNode('approval',{mode:'duration',durationMinutes:0.002,onTimeout:'fail'}),
  {id:'end',name:'终止全部',type:'end',config:{status:'succeeded',scope:'workflow',summary:'提前完成',resultJson:'{"done":true}'},branches:[]},
  {id:'other',name:'不应执行',type:'notify',config:{title:'other',body:'other'},branches:[]}
 ]})
 const started=workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 await pause(150)
 const run=workflow.runs(definition.id)[0]
 assert.equal(run.status,'succeeded');assert.deepEqual(notifications,[]);assert.deepEqual(run.pendingNodeIds,[])
 assert.equal(run.nodeRuns.find(item=>item.nodeId==='approval').status,'skipped')
 assert.throws(()=>workflow.resolveApproval(started.id,'approved','approval'),/未等待/)
})

test('whole workflow end stops an active Agent when an approval path reaches it',async t=>{
 const h=await harness(t,()=>response('unused')),stopped=[];let completion
 h.agent.start=(_input,_owner,callback)=>{completion=callback;return {id:'active-agent'}}
 h.agent.stop=id=>stopped.push(id)
 const workflow=new WorkflowService(path.join(h.root,'active-end'),h.agent,undefined,()=>true);t.after(()=>workflow.dispose())
 const approval=approvalNode('approval');approval.branches[0].targetNodeIds=['end']
 const definition=workflow.save({name:'中止运行任务',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'approval',entryNodeIds:['approval','agent'],nodes:[approval,agentNode('agent'),{id:'end',name:'全局结束',type:'end',config:{status:'succeeded',scope:'workflow',summary:'停止其他任务'},branches:[]}]})
 const started=workflow.start(definition.id);await until(()=>!!completion)
 workflow.resolveApproval(started.id,'approved','approval');await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 assert.deepEqual(stopped,['active-agent'])
 const run=workflow.runs(definition.id)[0];assert.equal(run.nodeRuns.find(item=>item.nodeId==='agent').status,'skipped')
 completion({id:'active-agent',status:'completed',events:[]})
 assert.equal(workflow.runs(definition.id)[0].status,'succeeded')
})


test('AI output accepts fixed JSON values and generates only blank values including arrays',()=>{
 const template=parseWorkflowAiOutput('{"result":"通过","score":90,"ok":true,"nothing":null,"empty":{},"items":["fixed","",{"answer":"","n":3}],"ref":"{{input.source}}"}')
 assert.deepEqual(workflowAiGeneratedTemplate(template),{items:{1:'',2:{answer:''}}})
 assert.deepEqual(assembleWorkflowAiOutput(template,{items:{1:'生成文本',2:{answer:'回答'}}},()=>({data:1})),{result:'通过',score:90,ok:true,nothing:null,empty:{},items:['fixed','生成文本',{answer:'回答',n:3}],ref:{data:1}})
 for(const value of [42,true,null,'fixed',[],{},[1,false]]){
  const parsed=parseWorkflowAiOutput(JSON.stringify(value));assert.deepEqual(workflowAiGeneratedTemplate(parsed),{});assert.deepEqual(assembleWorkflowAiOutput(parsed,{},()=>undefined),value)
 }
 assert.deepEqual(workflowAiGeneratedTemplate(''),{$value:''})
 assert.equal(assembleWorkflowAiOutput('',{$value:'generated'},()=>undefined),'generated')
 assert.throws(()=>parseWorkflowAiOutput('{"broken":}'),/JSON/)
 assert.throws(()=>parseWorkflowAiOutput('{"x":1,"x":2}'),/重复/)
})

test('AI executes fixed output content and nested array generation without changing preset values',async t=>{
 const h=await harness(t,()=>response('{"branchId":"out","output":{"items":{"1":"AI 填写"}}}')),workflow=new WorkflowService(path.join(h.root,'fixed-output'),h.agent);t.after(()=>workflow.dispose())
 const definition=workflow.save({name:'固定输出',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'agent',nodes:[{...agentNode('agent'),config:{...agentNode('agent').config,branchMode:'ai'},branches:[{id:'out',name:'输出',condition:'始终选择',color:'#347fc5',targetNodeIds:[],outputValue:'{"result":"通过","score":90,"ok":true,"items":[null,""]}'}]}]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='succeeded')
 assert.deepEqual(JSON.parse(workflow.runs(definition.id)[0].nodeRuns[0].outputValue),{result:'通过',score:90,ok:true,items:[null,'AI 填写']})
})


test('workflow AI validation errors print request conversation and complete model reply',async t=>{
 const marker='末尾诊断内容',answer='{"branchId":"out","output":{"result":"'+ 'x'.repeat(5000)+marker+'","extra":"wrong"}}'
 const h=await harness(t,()=>response(answer)),logs=[],workflow=new WorkflowService(path.join(h.root,'diagnostic-workflow'),h.agent,(_level,message)=>logs.push(message));t.after(()=>workflow.dispose())
 const definition=workflow.save({name:'诊断流程',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'agent',nodes:[{...agentNode('agent'),config:{...agentNode('agent').config,branchMode:'ai'},branches:[{id:'out',name:'输出',condition:'始终选择',color:'#347fc5',outputValue:'{"result":""}',targetNodeIds:[]}]}]})
 workflow.start(definition.id);await until(()=>workflow.runs(definition.id)[0]?.status==='failed')
 const printed=logs.join('\n')
 assert.match(printed,/AI 对话诊断/);assert.match(printed,/请求对话/);assert.match(printed,/模型返回/);assert.match(printed,/检查项目/);assert.ok(printed.includes(marker));assert.match(printed,/诊断流程.*节点 agent/)
})

test('request failures print diagnostics and redaction protects credentials before chunking',async t=>{
 const h=await harness(t,()=>({error:{message:'模型服务故障'}})),logs=[]
 const agent=new LocalAgentService(path.join(h.root,'diagnostic-agent'),()=>({endpoint:h.agent.connection().endpoint,key:'private-diagnostic-key',maxTokens:1024,contextLength:8192}),undefined,undefined,message=>logs.push(message));t.after(()=>agent.dispose())
 const project=agent.createProject(h.project.workspace,'诊断项目')
 const task=agent.start({projectId:project.id,mode:'coding',model:'fixture',prompt:'检查项目',maxSteps:2,fastMode:true,approvalMode:'ask'},0,()=>{})
 await until(()=>['failed','stopped'].includes(agent.get(task.id).status))
 assert.match(logs.join('\n'),/请求对话/);assert.match(logs.join('\n'),/模型服务故障/);assert.equal(logs.join('\n').includes('private-diagnostic-key'),false)
 const redacted=diagnosticText('api_key: secret-value bearer ABCDE data:image/png;base64,AAAA private-diagnostic-key','private-diagnostic-key')
 assert.equal(redacted.includes('secret-value'),false);assert.equal(redacted.includes('ABCDE'),false);assert.equal(redacted.includes('AAAA'),false)
 const chunks=[];writeConversationDiagnostic(message=>chunks.push(message),{taskId:'id',model:'model',request:'x'.repeat(6000),response:'reply',error:'failed'})
 assert.equal(chunks.filter(line=>line.includes('请求对话')).length,4);assert.ok(chunks.every(line=>line.length<2000))
})


test('AI judgement calls the model with upstream data and executes only the chosen branch',async t=>{
 for (const choice of ['yes','no']) {
  const h=await harness(t,()=>response(JSON.stringify({branchId:choice,output:{reason:'语义判断结果'}})))
  const workflow=new WorkflowService(path.join(h.root,'ai-judge'),h.agent);t.after(()=>workflow.dispose())
  const branch=(id,target,condition,outputValue)=>({id,name:id,condition,color:'#347fc5',targetNodeIds:[target],outputValue})
  const judge={...agentNode('judge'),type:'ai-judge',config:{...agentNode('judge').config,instruction:'判断输入客户反馈是否表达满意',mode:'general'},branches:[branch('yes','accepted','客户表达满意','{"reason":"","accepted":true}'),branch('no','rejected','始终：其他情况','{"reason":"","accepted":false}')]}
  const input={name:'AI 客户反馈判断',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'source',nodes:[
   {id:'source',name:'反馈',type:'data',config:{assignments:[{name:'feedback',value:'服务很贴心'}]},branches:[branch('out','judge','','{"feedback":"服务很贴心"}')]},judge,
   {id:'accepted',name:'满意',type:'end',config:{status:'succeeded',summary:'满意路径'},branches:[]},
   {id:'rejected',name:'其他',type:'end',config:{status:'succeeded',summary:'其他路径'},branches:[]}
  ]}
  const saved=workflow.save(input)
  assert.equal(saved.nodes[1].type,'ai-judge');assert.equal(saved.nodes[1].config.branchMode,'ai')
  assert.throws(()=>workflow.save({...input,nodes:input.nodes.map(node=>node===judge?{...judge,branches:judge.branches.slice(0,1)}:node)}),/至少需要两个输出分支/)
  workflow.start(saved.id);await until(()=>['succeeded','failed'].includes(workflow.runs(saved.id)[0]?.status))
  const run=workflow.runs(saved.id)[0]
  assert.equal(run.status,'succeeded',run.error)
  const result=run.nodeRuns.find(node=>node.nodeId==='judge')
  assert.equal(result.type,'ai-judge');assert.equal(result.branchId,choice)
  assert.deepEqual(JSON.parse(result.outputValue),{reason:'语义判断结果',accepted:choice==='yes'})
  assert.ok(run.nodeRuns.some(node=>node.nodeId===(choice==='yes'?'accepted':'rejected')))
  assert.ok(!run.nodeRuns.some(node=>node.nodeId===(choice==='yes'?'rejected':'accepted')))
  assert.match(JSON.stringify(h.requests),/服务很贴心/)
 }
})

test('AI classification routes weather answers and preserves the original input',async t=>{
 for (const [choice,forecast] of [
  ['rain','上海今天有阵雨，最高气温 25℃。'],
  ['dry','上海今天晴，无降雨。'],
  ['unknown','暂未取得上海今天的天气预报。']
 ]) {
  const h=await harness(t,n=>response(n===0?forecast:JSON.stringify({branchId:choice,reason:choice==='unknown'?'没有今天的预报':'根据预报判断'})))
  const workflow=new WorkflowService(path.join(h.root,'classify-weather'),h.agent);t.after(()=>workflow.dispose())
  const branch=(id,target,condition)=>({id,name:id,condition,color:'#347fc5',targetNodeIds:[target],outputValue:'{"ignored":""}'})
  const saved=workflow.save({name:'天气判断',description:'',enabled:true,timeoutMinutes:1,entryNodeId:'weather',nodes:[
   {...agentNode('weather'),config:{...agentNode('weather').config,instruction:'查询上海市今天的天气预报',branchMode:'direct'},branches:[branch('result','judge','')]},
   {...agentNode('judge'),type:'ai-judge',config:{...agentNode('judge').config,instruction:'判断上海市今天是否会下雨',mode:'general',judgeMode:'classify',judgeInput:'{{input.weather.result}}',unknownBranchId:'unknown'},branches:[branch('rain','rain-end','今天明确有雨'),branch('dry','dry-end','今天明确无雨'),branch('unknown','unknown-end','预报缺失或无法确定')]},
   ...['rain','dry','unknown'].map(id=>({id:`${id}-end`,name:`${id}结束`,type:'end',config:{status:'succeeded',summary:id},branches:[]}))
  ]})
  assert.equal(saved.nodes[1].branches[0].outputValue,undefined)
  workflow.start(saved.id)
  await until(()=>workflow.runs(saved.id)[0]?.status==='succeeded')
  const run=workflow.runs(saved.id)[0],judgement=run.nodeRuns.find(node=>node.nodeId==='judge')
  assert.equal(judgement.branchId,choice)
  assert.deepEqual(JSON.parse(judgement.outputValue),{result:forecast,reason:choice==='unknown'?'没有今天的预报':'根据预报判断'})
  assert.ok(run.nodeRuns.some(node=>node.nodeId===`${choice}-end`))
  assert.equal(h.requests.length,2)
  assert.match(JSON.stringify(h.requests[1]),/上海市今天是否会下雨/)
  assert.match(JSON.stringify(h.requests[1]),/上海今天/)
  assert.equal(JSON.stringify(h.requests[1]).includes('outputFormat'),false)
 }
})

test('AI classification accepts a direct JSON decision when the Agent found no forecast',async t=>{
 const summary='未能获取到上海今天的实际天气预报信息，无法确定是否下雨。'
 const h=await harness(t,()=>response(summary)),calls=[]
 const workflow=new WorkflowService(path.join(h.root,'direct-classifier'),h.agent,undefined,undefined,undefined,undefined,undefined,async(model,connection,prompt,signal)=>{
  calls.push({model,connection,prompt,signal})
  return '```json\n{"branchId":"unknown","reason":"没有今天的天气预报数据"}\n```'
 });t.after(()=>workflow.dispose())
 const branch=(id,target,condition)=>({id,name:id,condition,color:'#347fc5',targetNodeIds:[target]})
 const saved=workflow.save({name:'天气未知分类',description:'',enabled:true,timeoutMinutes:1,entryNodeId:'weather',nodes:[
  {...agentNode('weather'),config:{...agentNode('weather').config,instruction:'查询上海市今天的天气预报',branchMode:'direct'},branches:[branch('result','judge','')]},
  {...agentNode('judge'),type:'ai-judge',config:{...agentNode('judge').config,instruction:'上海市今天是否会下雨？',judgeMode:'classify',judgeInput:'{{input.weather.result}}',unknownBranchId:'unknown'},branches:[branch('rain','rain-end','有雨'),branch('dry','dry-end','无雨'),branch('unknown','unknown-end','无法判断')]},
  ...['rain','dry','unknown'].map(id=>({id:`${id}-end`,name:`${id}结束`,type:'end',config:{status:'succeeded',summary:id},branches:[]}))
 ]})
 workflow.start(saved.id)
 await until(()=>workflow.runs(saved.id)[0]?.status==='succeeded')
 const run=workflow.runs(saved.id)[0],judgement=run.nodeRuns.find(node=>node.nodeId==='judge')
 assert.equal(judgement.branchId,'unknown')
 assert.deepEqual(JSON.parse(judgement.outputValue),{result:summary,reason:'没有今天的天气预报数据'})
 assert.equal(calls.length,1)
 assert.match(calls[0].prompt,/无法确定是否下雨/)
 assert.equal(h.requests.length,1,'分类器不应进入 Agent 任务规划')
})

test('AI classification sends a missing field to the uncertain branch without calling a model',async t=>{
 const h=await harness(t,()=>response('模型不应被调用')),workflow=new WorkflowService(path.join(h.root,'missing-weather'),h.agent);t.after(()=>workflow.dispose())
 const branch=(id,target,condition,outputValue)=>({id,name:id,condition,color:'#347fc5',targetNodeIds:target?[target]:[],...(outputValue?{outputValue}:{})})
 const saved=workflow.save({name:'缺失天气',description:'',enabled:true,timeoutMinutes:1,entryNodeId:'source',nodes:[
  {id:'source',name:'输入',type:'data',config:{assignments:[{name:'other',value:'无天气'}]},branches:[branch('next','judge','','{"other":"无天气"}')]},
  {...agentNode('judge'),type:'ai-judge',config:{...agentNode('judge').config,instruction:'今天是否下雨',judgeMode:'classify',judgeInput:'{{input.source.result}}',unknownBranchId:'unknown'},branches:[branch('rain','rain-end','有雨'),branch('dry','dry-end','无雨'),branch('unknown','unknown-end','信息不足')]},
  ...['rain','dry','unknown'].map(id=>({id:`${id}-end`,name:`${id}结束`,type:'end',config:{status:'succeeded',summary:id},branches:[]}))
 ]})
 workflow.start(saved.id)
 await until(()=>workflow.runs(saved.id)[0]?.status==='succeeded')
 const judgement=workflow.runs(saved.id)[0].nodeRuns.find(node=>node.nodeId==='judge')
 assert.equal(judgement.branchId,'unknown')
 assert.deepEqual(JSON.parse(judgement.outputValue),{result:null,reason:'判断输入缺失'})
 assert.equal(h.requests.length,0)
})

test('AI judgement rejects an unknown model branch instead of following a fallback',async t=>{
 const h=await harness(t,()=>response('{"branchId":"unknown","output":{}}'))
 const workflow=new WorkflowService(path.join(h.root,'ai-judge-invalid'),h.agent);t.after(()=>workflow.dispose())
 const node={...agentNode('judge'),type:'ai-judge',config:{...agentNode('judge').config,branchMode:'ai'},branches:['yes','no'].map(id=>({id,name:id,condition:'自然语言条件',color:'#347fc5',outputValue:'{}'}))}
 const saved=workflow.save({name:'无效 AI 判断',description:'',projectId:h.project.id,enabled:true,timeoutMinutes:1,entryNodeId:'judge',nodes:[node]})
 workflow.start(saved.id);await until(()=>workflow.runs(saved.id)[0]?.status==='failed')
 assert.match(workflow.runs(saved.id)[0].error,/不存在的输出分支/)
})
