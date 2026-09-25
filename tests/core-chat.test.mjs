import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runCoreChat, chatApprovalRequired, chatCapabilityAllowed } from '../dist-electron/main/agent/core/chat-runner.js'
import { estimateTokens } from '../dist-electron/main/local-ai-context.js'
import { AgentCoreService } from '../dist-electron/main/agent/agent-core-service.js'
import {execFileSync} from 'node:child_process'

const capability = (name, risk = 'high') => ({name,category:'agent',description:name,parameters:{type:'object',properties:{query:{type:'string'}},required:['query']},source:{type:'skill',skillId:'agent-tools'},runtime:'python-native',permissions:['network'],tags:risk==='read'?[]:['requires-approval',`risk:${risk}`]})
async function withModel(call, work, reviewCall) {
  const requests=[]
  const server=createServer(async(request,response)=>{
    let body='';for await(const part of request)body+=part
    const input=JSON.parse(body);requests.push(input)
    const isReview=input.messages.some(item=>item.role==='system'&&String(item.content).includes('你是任务完成检查器'))
    const message=isReview ? (reviewCall ? await reviewCall(input) : {content:JSON.stringify({status:'complete',reason:'已完成',nextStep:''})}) : await call(input,requests.length)
    response.setHeader('content-type','application/json')
    response.end(JSON.stringify({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}],usage:{prompt_tokens:30,completion_tokens:5}}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{await work({endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',maxTokens:1024,contextLength:8192},requests)}finally{await new Promise(resolve=>server.close(resolve))}
}
const toolCall=(input,name,args)=>({role:'assistant',content:null,tool_calls:[{id:'call1',type:'function',function:{name:input.tools.find(tool=>tool.function.description.startsWith(name+':')).function.name,arguments:JSON.stringify(args)}}]})
const options=(connection,overrides={})=>({connection,model:'test-model',messages:[{role:'user',content:'搜索今日天气'}],workspace:tmpdir(),filesEnabled:false,webEnabled:true,approvalMode:'ask',signal:new AbortController().signal,onRequest(){},onUsage(){},onContent(){},onReasoning(){},onActivity(){},approve:async()=>true,...overrides})

test('project chat initializes local Git before inference, while ordinary chat leaves its directory untouched',async()=>{
 const workspace=mkdtempSync(path.join(tmpdir(),'myplane-chat-git-'))
 try{
  let shouldExist=false
  await withModel(()=>{
   assert.equal(existsSync(path.join(workspace,'.git')),shouldExist)
   return {content:'已完成检查'}
  },async connection=>{
   const registry={list:()=>[],execute:async()=>assert.fail('no file tool should be needed')}
   await runCoreChat(registry,options(connection,{workspace,filesEnabled:true}))
   assert.equal(existsSync(path.join(workspace,'.git')),false)
   shouldExist=true
   await runCoreChat(registry,options(connection,{workspace,filesEnabled:true,initializeLocalGit:true}))
   const config=readFileSync(path.join(workspace,'.git','config'),'utf8')
   assert.match(config,/localHistory = true/)
   assert.doesNotMatch(config,/\[remote /)
  })
 }finally{rmSync(workspace,{recursive:true,force:true})}
})

test('chat file writes save complete snapshots and local Git versions without sending snapshots to the model',async()=>{
 const workspace=mkdtempSync(path.join(tmpdir(),'myplane-chat-write-')),activities=[]
 writeFileSync(path.join(workspace,'hello.txt'),'original\ncontext')
 try{
  const write={...capability('agent.write_file'),parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']}}
  const registry={list:()=>[write],execute:async request=>{writeFileSync(path.join(workspace,request.args.path),request.args.content);return {success:true,output:'saved'}}}
  await withModel((input,n)=>n===1?toolCall(input,'agent.write_file',{path:'hello.txt',content:'updated\ncontext'}):{content:'已更新'},async(connection,requests)=>{
   await runCoreChat(registry,options(connection,{workspace,filesEnabled:true,initializeLocalGit:true,onActivity:activity=>activities.push(activity)}))
   const completed=activities.find(activity=>activity.status==='complete')
   assert.deepEqual(completed.fileChanges,[{path:'hello.txt',before:'original\ncontext',after:'updated\ncontext'}])
   assert.equal(execFileSync('git',['show','HEAD~1:hello.txt'],{cwd:workspace,encoding:'utf8',windowsHide:true}),'original\ncontext')
   assert.equal(execFileSync('git',['show','HEAD:hello.txt'],{cwd:workspace,encoding:'utf8',windowsHide:true}),'updated\ncontext')
   assert.doesNotMatch(JSON.stringify(requests[1].messages),/fileChanges|original/)
   assert.match(JSON.stringify(requests[1].messages),/本地 Git 状态快照/)
  })
 }finally{rmSync(workspace,{recursive:true,force:true})}
})

test('chat search waits for approval, executes a registered Skill and returns tool results to the model',async()=>{
  let executed=0,approval=0,text='',release
  const waiting=new Promise(resolve=>{release=resolve})
  await withModel((input,n)=>n===1?toolCall(input,'agent.web_search',{query:'成都天气'}):{content:'今天有雨。来源 https://example.com/weather'},async(connection,requests)=>{
    const registry={list:()=>[capability('agent.web_search')],execute:async()=>{executed++;return {success:true,output:{results:[{title:'天气',url:'https://example.com/weather'}]}}}}
    const running=runCoreChat(registry,options(connection,{approve:async()=>{approval++;await waiting;return true},onContent:value=>{text+=value}}))
    while(!approval)await new Promise(resolve=>setTimeout(resolve,5))
    assert.equal(executed,0);release();await running
    assert.equal(executed,1);assert.equal(approval,1);assert.match(text,/https:\/\/example.com\/weather/)
    assert.match(requests[1].messages.find(item=>item.role==='tool').content,/天气/)
    assert.equal(requests[0].model,'test-model')
  })
})

test('denied tool is not executed and the model receives a denial with tools disabled',async()=>{
  let executed=0
  await withModel((input,n)=>n===1?toolCall(input,'agent.web_search',{query:'weather'}):{content:'操作已取消'},async(connection,requests)=>{
    await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>{executed++;return {success:true}}},options(connection,{approve:async()=>false}))
    assert.equal(executed,0);assert.equal(requests[1].tools,undefined);assert.match(requests[1].messages.at(-1).content,/拒绝/)
  })
})

test('network switch removes web, process and MCP tools; fabricated calls cannot execute',async()=>{
  const web=capability('agent.web_search'),command=capability('agent.run_command'),mcp={...web,name:'mcp.example.echo',source:{type:'mcp',serverId:'example'}}
  for(const item of [web,command,mcp])assert.equal(chatCapabilityAllowed(item,{filesEnabled:true,webEnabled:false}),false)
  let executed=0
  await withModel(()=>({content:null,tool_calls:[{id:'x',type:'function',function:{name:'cap_0',arguments:'{}'}}]}),async(connection,requests)=>{
    await assert.rejects(runCoreChat({list:()=>[web],execute:async()=>{executed++}},options(connection,{webEnabled:false})),/未授权/)
    assert.equal(requests[0].tools,undefined);assert.equal(executed,0);assert.equal(requests.length,3)
  })
})

test('a mistaken capability name is corrected through tool feedback before approval and execution',async()=>{
  let executed=0,approvals=0
  await withModel((input,n)=>{
    if(n===1)return {content:null,tool_calls:[{id:'wrong',type:'function',function:{name:'web_search',arguments:'{"query":"weather"}'}}]}
    if(n===2){
      assert.match(input.messages.at(-1).content,/不在本轮可用工具列表/)
      assert.match(input.tools[0].function.name,/agent_web_search/)
      return toolCall(input,'agent.web_search',{query:'weather'})
    }
    return {content:'搜索完成'}
  },async(connection)=>{
    await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>{executed++;return {success:true,output:'天气证据'}}},options(connection,{approve:async()=>{approvals++;return true}}))
    assert.equal(executed,1);assert.equal(approvals,1)
  })
})

test('mixed valid and unknown calls keep paired results and never replay the successful operation',async()=>{
  let executed=0
  await withModel((input,n)=>{
    if(n===1){const answer=toolCall(input,'agent.web_search',{query:'weather'});answer.tool_calls.push({id:'unknown',type:'function',function:{name:'invented_tool',arguments:'{}'}});return answer}
    const results=input.messages.filter(message=>message.role==='tool')
    assert.deepEqual(results.map(message=>message.tool_call_id),['call1','unknown'])
    assert.match(results[0].content,/complete/);assert.match(results[1].content,/工具未执行/)
    return {content:'搜索已完成，另一个工具不可用'}
  },async(connection)=>{
    await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>{executed++;return {success:true,output:'天气证据'}}},options(connection))
    assert.equal(executed,1)
  })
})

test('approval modes distinguish searches, workspace writes, risky commands and external paths',()=>{
  const base={workspace:tmpdir(),approvalMode:'auto'}
  assert.equal(chatApprovalRequired(capability('agent.web_search'),{query:'weather'},base),false)
  assert.equal(chatApprovalRequired(capability('agent.write_file','write'),{path:'note.txt'},base),false)
  assert.equal(chatApprovalRequired(capability('agent.run_command'),{command:'ls'},base),true)
  assert.equal(chatApprovalRequired(capability('agent.read_file','read'),{path:'../outside'},base),true)
  assert.equal(chatApprovalRequired(capability('agent.web_search'),{}, {...base,approvalMode:'ask'}),true)
  assert.equal(chatApprovalRequired(capability('agent.run_command'),{}, {...base,approvalMode:'full'}),false)
})

test('cancelling while approval is pending executes no tool',async()=>{
  const controller=new AbortController();let executed=0
  await withModel(input=>toolCall(input,'agent.web_search',{query:'weather'}),async(connection)=>{
    await assert.rejects(runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>{executed++}},options(connection,{signal:controller.signal,approve:async()=>{controller.abort();return false}})),{name:'AbortError'})
    assert.equal(executed,0)
  })
})

test('explicit external-file approval reaches Python Skill and does not leak into later calls',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'myplane-chat-')),workspace=path.join(root,'workspace'),skillsDir=path.join(root,'skills')
  mkdirSync(workspace);mkdirSync(skillsDir);writeFileSync(path.join(root,'outside.txt'),'external test data')
  cpSync(path.resolve('skills/agent-tools'),path.join(skillsDir,'agent-tools'),{recursive:true})
  let approvals=0
  const core=new AgentCoreService({dataDir:path.join(root,'data'),skillsDir,getConnection:()=>{throw Error('explicit connection expected')}})
  core.on('error',()=>{})
  try{
    await core.initialize()
    await withModel((input,n)=>n===1?toolCall(input,'agent.read_file',{path:path.join(root,'outside.txt')}):{content:'已读取测试文件'},async(connection,requests)=>{
      await core.runConversation(options({...connection,contextLength:32768},{workspace,filesEnabled:true,webEnabled:false,approve:async()=>{approvals++;return true}}))
      assert.equal(approvals,1);assert.match(requests[1].messages.find(item=>item.role==='tool').content,/external test data/)
    })
    const result=await core.getCapabilityRegistry().execute({capability:'agent.read_file',args:{path:path.join(root,'outside.txt')},workspace},new AbortController().signal)
    assert.equal(result.success,false)
  }finally{await core.dispose();rmSync(root,{recursive:true,force:true})}
})


test('incomplete prose is checked, continues with tools, and only the final candidate is published',async()=>{
  let execution=0, reviews=0, text=''
  await withModel((input,n)=> n===1?{content:'我接下来会搜索。'}:n===3?toolCall(input,'agent.web_search',{query:'weather'}):{content:'已核实天气'},async(connection,requests)=>{
    await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>{execution++;return {success:true,output:'天气证据'}}},options(connection,{onContent:value=>text+=value}))
    assert.equal(execution,1);assert.equal(text,'已核实天气');assert.equal(reviews,2)
    assert.ok(requests[2].messages.some(item=>item.role==='system'&&item.content.includes('核实天气')))
  },()=>({content:JSON.stringify(++reviews===1?{status:'continue',reason:'尚未查询',nextStep:'搜索并核实天气'}:{status:'complete',reason:'已有证据'})}))
})

test('completion checks stop on missing user input without running extra tools',async()=>{
  let executions=0,text=''
  await withModel(()=>({content:'请提供城市。'}),async(connection,requests)=>{
    await runCoreChat({list:()=>[],execute:async()=>{executions++}},options(connection,{onContent:value=>text+=value}))
    assert.equal(executions,0);assert.equal(requests.length,2);assert.match(text,/请提供城市/)
  },()=>({content:JSON.stringify({status:'needs_input',reason:'缺少城市'})}))
})

test('invalid completion checks preserve candidate as unverified and never declare success',async()=>{
  let outcome='',text='',executions=0
  await withModel(()=>({content:'计划稍后处理'}),async(connection,requests)=>{
    await runCoreChat({list:()=>[],execute:async()=>{executions++}},options(connection,{onOutcome:value=>outcome=value,onContent:value=>text+=value}))
    assert.equal(outcome,'blocked');assert.equal(executions,0);assert.equal(requests.length,3)
    assert.match(text,/完成状态未确认/);assert.match(text,/计划稍后处理/)
    assert.ok(requests[2].messages.some(message=>String(message.content).includes('上次完成检查未返回有效格式')))
  },()=>({content:'invalid'}))
})

test('completion review accepts a single JSON object wrapped in explanation and completed thinking',async()=>{
 let outcome=''
 await withModel(()=>({content:'回答内容'}),async(connection,requests)=>{
  await runCoreChat({list:()=>[],execute:async()=>assert.fail('review must not execute tools')},options(connection,{onOutcome:value=>outcome=value}))
  assert.equal(outcome,'complete');assert.equal(requests.length,2)
 },()=>({content:'<think>检查内容</think>检查结果：\n```json\n{"status":"complete","reason":"已回答问题"}\n```'}))
})

test('repeated incomplete responses stop at a bounded continuation limit',async()=>{
  await withModel(()=>({content:'稍后处理'}),async(connection,requests)=>{
    let text='',outcome
    await runCoreChat({list:()=>[],execute:async()=>{}},options(connection,{onContent:value=>text+=value,onOutcome:value=>outcome=value}))
    assert.equal(outcome,'blocked');assert.match(text,/仍未取得新执行结果/)
    assert.equal(requests.length,10)
  },()=>({content:JSON.stringify({status:'continue',reason:'未完成',nextStep:'执行搜索'})}))
})


test('large tool results are compacted within budget while preserving goal and tool-call pairs',async()=>{
  let executed=0, summaries=0; const states=[]
  await withModel((input)=>{
    if(input.messages[0].content.startsWith('仅压缩历史')){summaries++;return {content:'已搜索；返回天气资料，需要核实来源。'}}
    return executed?{content:'天气已核实'}:toolCall(input,'agent.web_search',{query:'weather'})
  },async(connection,requests)=>{
    const original=[{role:'user',content:'查询成都天气，只使用官方来源'}]
    await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>{executed++;return {success:true,output:'天气资料'.repeat(3000)}}},options(connection,{messages:original,onContext:state=>states.push(state)}))
    assert.equal(executed,1);assert.ok(summaries>0);assert.ok(states.some(state=>state.state==='compacting'))
    assert.deepEqual(original,[{role:'user',content:'查询成都天气，只使用官方来源'}])
    for(const request of requests){
      assert.ok(estimateTokens(request.messages)+estimateTokens(request.tools)+32+request.max_tokens<=connection.contextLength)
      const pending=new Set()
      for(const message of request.messages){
        for(const call of message.tool_calls||[])pending.add(call.id)
        if(message.role==='tool'){assert.ok(pending.has(message.tool_call_id));pending.delete(message.tool_call_id)}
      }
      assert.equal(pending.size,0)
    }
    const review=requests.find(request=>request.messages.some(message=>String(message.content).includes('你是任务完成检查器')))
    assert.ok(review.messages.some(message=>message.content===original[0].content))
  })
})

test('oversized tool definitions fail before any model or tool request',async()=>{
  await withModel(()=>{throw Error('must not request model')},async(connection,requests)=>{
    const oversized={...capability('agent.web_search'),description:'大型工具定义'.repeat(4000)}
    await assert.rejects(runCoreChat({list:()=>[oversized],execute:async()=>{throw Error('must not execute')}},options(connection)),/上下文/)
    assert.equal(requests.length,0)
  })
})

test('failed tool results remain explicit evidence and can lead to a different next action',async()=>{
  let executions=0,reviews=0
  await withModel(input=>executions===0?toolCall(input,'agent.web_search',{query:'first'}):executions===1&&reviews===1?toolCall(input,'agent.web_search',{query:'retry'}):{content:executions===1?'没查到':'已核实'},async(connection,requests)=>{
    await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>++executions===1?{success:false,error:'搜索失败'}:{success:true,output:'官方资料'}},options(connection))
    assert.equal(executions,2)
    assert.ok(requests.some(request=>request.messages.some(message=>message.role==='tool'&&JSON.parse(message.content).status==='error')))
  },()=>({content:JSON.stringify(++reviews===1?{status:'continue',reason:'仍可调整关键词',nextStep:'修改关键词搜索'}:{status:'complete',reason:'已核实'})}))
})


test('invalid tool arguments are returned for correction without executing the invalid call',async()=>{
  let executions=0;const ids=[]
  await withModel((input,n)=>n===1?toolCall(input,'agent.web_search',{}):n===2?toolCall(input,'agent.web_search',{query:'weather'}):{content:'已查询'},async(connection)=>{
    await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>{executions++;return {success:true,output:'天气'}}},options(connection,{onActivity:activity=>ids.push(activity.id)}))
    assert.equal(executions,1);assert.equal(new Set(ids).size,2)
  })
})

test('tool commentary is a progress event and final output contains only the final answer',async()=>{
 const progress=[];let text='',outcome
 await withModel((input,n)=>n===1?{...toolCall(input,'agent.web_search',{query:'weather'}),content:'正在查询天气来源。'}:{content:'已核实天气。'},async(connection)=>{
  await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>({success:true,output:'官方天气'})},options(connection,{onProgress:(text,phase)=>progress.push({text,phase}),onContent:value=>text+=value,onOutcome:value=>outcome=value}))
  assert.equal(text,'已核实天气。');assert.equal(outcome,'complete')
  assert.ok(progress.some(entry=>entry.text==='正在查询天气来源。'))
  assert.ok(progress.some(entry=>entry.phase==='reviewing'))
 })
})

test('productive tasks automatically continue past twenty rounds and still require completion review',async()=>{
 let executed=0,outcome='',text=''
 await withModel((input,n)=>n<=25?toolCall(input,'agent.web_search',{query:'step '+n}):{content:'已完成全部检查'},async(connection)=>{
  await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>({success:true,output:'result '+ ++executed})},options({...connection,contextLength:131072},{onOutcome:value=>outcome=value,onContent:value=>text+=value}))
  assert.equal(executed,25);assert.equal(outcome,'complete');assert.equal(text,'已完成全部检查')
 })
})

test('unchanged successful tool results trigger a strategy correction and bounded pause',async()=>{
 let executed=0,outcome='',text=''
 await withModel(input=>toolCall(input,'agent.web_search',{query:'same query'}),async(connection,requests)=>{
  await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>{executed++;return {success:true,output:'unchanged'}}},options({...connection,contextLength:131072},{onOutcome:value=>outcome=value,onContent:value=>text+=value}))
  assert.equal(executed,7);assert.equal(outcome,'blocked');assert.match(text,/连续 6 轮/)
  assert.ok(requests.some(request=>request.messages.some(message=>String(message.content).includes('避免重复相同操作'))))
 })
})

test('explicit round limits preserve partial progress and do not declare completion',async()=>{
 let executed=0,outcome='',text=''
 await withModel((input,n)=>toolCall(input,'agent.web_search',{query:'step '+n}),async(connection)=>{
  await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>({success:true,output:'result '+ ++executed})},options(connection,{maxRounds:2,onOutcome:value=>outcome=value,onContent:value=>text+=value}))
  assert.equal(executed,2);assert.equal(outcome,'blocked');assert.match(text,/成功 2 次/);assert.match(text,/2 轮/)
 })
})

test('productive auto continuation completes beyond sixty rounds',async()=>{
 let executed=0,outcome='',text=''
 await withModel((input,n)=>n<=65?toolCall(input,'agent.web_search',{query:'step '+n}):{content:'全部完成'},async(connection)=>{
  await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>({success:true,output:'result '+ ++executed})},options({...connection,contextLength:131072},{onOutcome:value=>outcome=value,onContent:value=>text+=value}))
  assert.equal(executed,65);assert.equal(outcome,'complete');assert.equal(text,'全部完成')
 })
})


test('browser snapshot IDs do not keep an unchanged page loop running',async()=>{
 let executed=0,text='',outcome
 const browser={...capability('browser.read_page'),parameters:{type:'object',properties:{}},source:{type:'builtin'},runtime:'builtin'}
 await withModel(input=>toolCall(input,'browser.read_page',{}),async(connection)=>{
  await runCoreChat({list:()=>[browser],execute:async()=>({success:true,output:{snapshot:'fresh-'+ ++executed,url:'http://localhost/',text:'unchanged',elements:[]}})},options({...connection,contextLength:131072},{onOutcome:value=>outcome=value,onContent:value=>text+=value}))
  assert.equal(executed,7);assert.equal(outcome,'blocked');assert.match(text,/连续 6 轮/)
 })
})

test('explicit limits above twenty are honored without an early stop',async()=>{
 let executed=0,text=''
 await withModel((input,n)=>toolCall(input,'agent.web_search',{query:'step '+n}),async(connection)=>{
  await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>({success:true,output:'result '+ ++executed})},options({...connection,contextLength:131072},{maxRounds:23,onContent:value=>text+=value}))
  assert.equal(executed,23);assert.match(text,/23 轮/)
 })
})

test('productive continuation remains cancellable after sixty rounds',async()=>{
 let executed=0
 const controller=new AbortController()
 await withModel((input,n)=>toolCall(input,'agent.web_search',{query:'step '+n}),async(connection)=>{
  await assert.rejects(runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>{if(++executed===62)controller.abort();return {success:true,output:'result '+executed}}},options({...connection,contextLength:131072},{signal:controller.signal})),{name:'AbortError'})
  assert.equal(executed,62)
 })
})


test('new execution evidence resets unsuccessful completion review retries',async()=>{
 let turns=0,reviews=0,executed=0,outcome
 await withModel(input=>++turns%2?toolCall(input,'agent.web_search',{query:'step '+turns}):{content:'本段处理结果'},async(connection)=>{
  await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>({success:true,output:'evidence '+ ++executed})},options({...connection,contextLength:131072},{onOutcome:value=>outcome=value}))
  assert.equal(reviews,6);assert.equal(executed,6);assert.equal(outcome,'complete')
 },()=>({content:JSON.stringify(++reviews<6?{status:'continue',reason:'还有剩余步骤',nextStep:'检查下一项'}:{status:'complete',reason:'全部核验完成'})}))
})


test('stalled execution reports the concrete tool failure',async()=>{
 let text=''
 await withModel(input=>toolCall(input,'agent.web_search',{query:'same'}),async(connection)=>{
  await runCoreChat({list:()=>[capability('agent.web_search')],execute:async()=>({success:false,error:'连接失败'})},options({...connection,contextLength:131072},{onContent:value=>text+=value}))
  assert.match(text,/最近一次工具失败：agent.web_search/);assert.match(text,/连接失败/)
 })
})
