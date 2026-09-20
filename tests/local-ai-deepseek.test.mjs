import test from 'node:test'
import assert from 'node:assert/strict'
import {requestAgentModel} from '../dist-electron/main/agent/model.js'
import {DEEPSEEK_CONTEXT_TOKENS,DEEPSEEK_DEFAULT_OUTPUT_TOKENS,DEEPSEEK_MAX_OUTPUT_TOKENS,deepseekPreset,isDeepSeek} from '../dist-electron/shared/local-ai-providers.js'

test('DeepSeek recognition only applies to the official HTTPS host',()=>{
 assert.equal(isDeepSeek('https://api.deepseek.com/v1'),true)
 for(const endpoint of ['https://api.deepseek.com.evil.test','http://api.deepseek.com','http://127.0.0.1:1234/v1','invalid'])assert.equal(isDeepSeek(endpoint),false)
})

test('DeepSeek preset follows current official context and output budgets',()=>{
 assert.equal(deepseekPreset.contextLength,DEEPSEEK_CONTEXT_TOKENS)
 assert.equal(deepseekPreset.maxTokens,DEEPSEEK_DEFAULT_OUTPUT_TOKENS)
 assert.equal(DEEPSEEK_CONTEXT_TOKENS,1_000_000)
 assert.equal(DEEPSEEK_MAX_OUTPUT_TOKENS,393_216)
})

test('DeepSeek streaming reasoning survives tool turns; summary disables thinking',async t=>{
 const bodies=[]
 const tool={id:'call_1',type:'function',function:{name:'read_file',arguments:'{"path":"README.md"}'}}
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions')
  assert.equal(init.headers.Authorization,'Bearer test-key')
  bodies.push(JSON.parse(init.body))
  const delta=bodies.length===1?{reasoning_content:'Inspect the file',tool_calls:[{index:0,...tool}]}:{content:'Done'}
  return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:bodies.length===1?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}})
 })
 const connection={endpoint:'https://api.deepseek.com',key:'test-key',contextLength:DEEPSEEK_CONTEXT_TOKENS,maxTokens:DEEPSEEK_DEFAULT_OUTPUT_TOKENS}
 const tools=[{type:'function',function:{name:'read_file',description:'Read a file',parameters:{type:'object',properties:{path:{type:'string'}}}}}]
 const messages=[{role:'user',content:'Read README'}]
 const answer=await requestAgentModel(connection,'deepseek-flash',messages,new AbortController().signal,{tools,thinking:true})
 assert.equal(answer.reasoning_content,'Inspect the file')
 const {reasoning,...stored}=answer
 await requestAgentModel(connection,'deepseek-flash',[...messages,stored,{role:'tool',tool_call_id:tool.id,content:'Hello'}],new AbortController().signal,{tools,thinking:true})
 assert.equal(bodies[1].messages[1].reasoning_content,'Inspect the file')
 assert.deepEqual(bodies[1].thinking,{type:'enabled'})
 await requestAgentModel(connection,'deepseek-flash',messages,new AbortController().signal,{tools:false,summary:true})
 assert.deepEqual(bodies[2].thinking,{type:'disabled'})
 assert.equal(bodies[2].tools,undefined)
})

test('generic endpoints do not receive DeepSeek fields',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const body=JSON.parse(init.body)
  assert.equal(body.thinking,undefined)
  assert.equal(body.messages[1].reasoning_content,undefined)
  return Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}]})
 })
 await requestAgentModel({endpoint:'http://localhost:1234/v1',key:'',contextLength:4096,maxTokens:512},'local',[{role:'user',content:'hello'},{role:'assistant',content:'hi',reasoning_content:'private provider field'}],new AbortController().signal)
})
