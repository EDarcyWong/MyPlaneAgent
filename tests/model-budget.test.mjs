import test from 'node:test'
import assert from 'node:assert/strict'
import {requestAgentModel} from '../dist-electron/main/agent/model.js'
import {requestBudget,modelCapacity,rememberModelCapacity,ModelContextCapacityError} from '../dist-electron/main/agent/model-budget.js'
import {estimateTokens} from '../dist-electron/main/local-ai-context.js'
const signal=()=>new AbortController().signal
const connection={endpoint:'http://budget.test/v1',key:'',contextLength:1_000_000,maxTokens:64000}
const messages=[{role:'user',content:'请查询今日天气'}]
const success=()=>Response.json({choices:[{message:{content:'完成'},finish_reason:'stop'}]})

test('65536-token server rejection reduces 64000 output, retries once, and remembers the model limit',async t=>{
 const bodies=[]
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  bodies.push(JSON.parse(init.body))
  return bodies.length===1?Response.json({error:{message:"This model's maximum context length is 65536 tokens. However, you requested 64000 output tokens and your prompt contains at least 1537 input tokens, for a total of at least 65537 tokens."}},{status:400}):success()
 })
 const answer=await requestAgentModel(connection,'capacity-retry',messages,signal())
 assert.equal(answer.content,'完成');assert.equal(bodies.length,2)
 assert.equal(bodies[0].max_tokens,64000);assert.ok(bodies[1].max_tokens+1537<65536)
 assert.ok(bodies[1].max_tokens<=32768);assert.deepEqual(bodies[1].messages,bodies[0].messages)
 await requestAgentModel(connection,'capacity-retry',messages,signal())
 assert.ok(bodies[2].max_tokens<=32768)
 assert.equal(modelCapacity({...connection,endpoint:'http://another.test'},'capacity-retry'),1_000_000)
 assert.equal(modelCapacity(connection,'other-model'),1_000_000)
})

test('budget includes tool schemas and input and leaves headroom for tokenizer differences',()=>{
 const tools=[{type:'function',function:{name:'read',description:'描述'.repeat(1500),parameters:{type:'object',properties:{}}}}]
 const config={...connection,contextLength:8192}
 const budget=requestBudget(config,'tools',messages,tools)
 assert.ok(budget.maxTokens+estimateTokens(messages)+estimateTokens(tools)+256<8192)
 assert.equal(config.maxTokens,64000)
})

test('inputs exceeding the actual model limit are not retried or silently truncated',async t=>{
 let calls=0
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{message:"This model's maximum context length is 4096 tokens. Your prompt contains at least 9000 input tokens."}},{status:400})})
 await assert.rejects(requestAgentModel(connection,'too-large',messages,signal()),ModelContextCapacityError)
 assert.equal(calls,1);assert.equal(modelCapacity(connection,'too-large'),4096)
})

test('unrelated HTTP failures are not retried',async t=>{
 let calls=0
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{message:'Invalid API key'}},{status:401})})
 await assert.rejects(requestAgentModel(connection,'unauthorized',messages,signal()),/HTTP 401/)
 assert.equal(calls,1)
})

test('known capacity also constrains Anthropic output',async t=>{
 const config={...connection,apiFormat:'anthropic'}
 rememberModelCapacity(config,'anthropic-limit',65536)
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  assert.ok(JSON.parse(init.body).max_tokens<=32768)
  return Response.json({content:[{type:'text',text:'完成'}],stop_reason:'end_turn'})
 })
 assert.equal((await requestAgentModel(config,'anthropic-limit',messages,signal())).content,'完成')
})

test('chat recomputes and compacts history after discovering a smaller server window',async t=>{
 const {runCoreChat}=await import('../dist-electron/main/agent/core/chat-runner.js')
 let calls=0,summaries=0,text=''
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  calls++;const body=JSON.parse(init.body)
  if(calls===1)return Response.json({error:{message:"This model's maximum context length is 8192 tokens. Your prompt contains at least 9000 input tokens."}},{status:400})
  assert.ok(estimateTokens(body.messages)+32+body.max_tokens<8192)
  if(String(body.messages[0].content).startsWith('仅压缩历史')){
   summaries++;return Response.json({choices:[{message:{content:'旧对话已结束。最新要求：回复你好。'},finish_reason:'stop'}]})
  }
  const reviewing=body.messages.some(item=>String(item.content).includes('你是任务完成检查器'))
  return Response.json({choices:[{message:{content:reviewing?JSON.stringify({status:'complete',reason:'已回答'}):'你好'},finish_reason:'stop'}]})
 })
 await runCoreChat({list:()=>[],execute:async()=>{throw Error('unexpected tool')}},{connection,model:'chat-smaller-window',messages:[{role:'user',content:'旧问题'},{role:'assistant',content:'旧资料'.repeat(1800)},{role:'user',content:'回复你好'}],workspace:'/tmp',filesEnabled:false,webEnabled:false,approvalMode:'ask',signal:signal(),onRequest(){},onUsage(){},onActivity(){},onReasoning(){},onContent:value=>text+=value,approve:async()=>false})
 assert.ok(summaries>0);assert.equal(text,'你好')
})


test('late completion instructions become a single leading system message for local templates',async t=>{
 const original=[{role:'system',content:'原始约束'},{role:'user',content:'用户目标'},{role:'assistant',content:'候选答案'},{role:'system',content:'完成检查'}]
 const saved=structuredClone(original)
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  const body=JSON.parse(init.body)
  assert.equal(body.messages.filter(message=>message.role==='system').length,1)
  assert.equal(body.messages[0].content,'原始约束\n\n完成检查')
  assert.deepEqual(body.messages.slice(1),original.slice(1,3))
  return success()
 })
 await requestAgentModel(connection,'system-order',original,signal())
 assert.deepEqual(original,saved)
})
