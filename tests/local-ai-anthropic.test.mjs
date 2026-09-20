import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {requestAgentModel} from '../dist-electron/main/agent/model.js'

const event=data=>`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`
const tool={type:'function',function:{name:'read_file',description:'Read one file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}}

async function anthropicServer(t,handle){
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;await handle(req,JSON.parse(raw),res)})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>{server.closeAllConnections();server.close()})
 return {apiFormat:'anthropic',endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'secret',maxTokens:2048,contextLength:16384}
}

test('Anthropic format converts tools, streams tool calls, and sends tool results back',async t=>{
 const requests=[]
 const connection=await anthropicServer(t,(req,body,res)=>{
  requests.push({url:req.url,headers:req.headers,body})
  res.setHeader('Content-Type','text/event-stream')
  if(requests.length===1){
   res.end(event({type:'message_start',message:{usage:{input_tokens:12,output_tokens:0}}})+event({type:'content_block_start',index:0,content_block:{type:'text',text:''}})+event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'先读取。'}})+event({type:'content_block_start',index:1,content_block:{type:'tool_use',id:'toolu_1',name:'read_file',input:{}}})+event({type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"path":"README.md"}'}})+event({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:9}})+event({type:'message_stop'}))
  }else{
   res.end(event({type:'message_start',message:{usage:{input_tokens:20,output_tokens:0}}})+event({type:'content_block_start',index:0,content_block:{type:'text',text:''}})+event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'文件已读取。'}})+event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:5}})+event({type:'message_stop'}))
  }
 })
 const usage=[]
 const first=await requestAgentModel(connection,'claude-fixture',[{role:'system',content:'Use tools.'},{role:'user',content:'Read it.'}],new AbortController().signal,{tools:[tool],onUsage:value=>usage.push(value)})
 assert.equal(first.content,'先读取。')
 assert.deepEqual(first.tool_calls,[{id:'toolu_1',type:'function',function:{name:'read_file',arguments:'{"path":"README.md"}'}}])
 assert.equal(requests[0].url,'/v1/messages');assert.equal(requests[0].headers['x-api-key'],'secret');assert.equal(requests[0].headers['anthropic-version'],'2023-06-01')
 assert.equal(requests[0].body.system,'Use tools.');assert.deepEqual(requests[0].body.tools,[{name:'read_file',description:'Read one file',input_schema:tool.function.parameters}]);assert.equal(requests[0].body.temperature,undefined)
 const second=await requestAgentModel(connection,'claude-fixture',[{role:'user',content:'Read it.'},first,{role:'tool',tool_call_id:'toolu_1',content:'Hello'}],new AbortController().signal,{tools:[tool]})
 assert.equal(second.content,'文件已读取。')
 const assistant=requests[1].body.messages[1],toolResult=requests[1].body.messages[2]
 assert.equal(assistant.role,'assistant');assert.equal(assistant.content[1].type,'tool_use');assert.deepEqual(assistant.content[1].input,{path:'README.md'})
 assert.equal(toolResult.role,'user');assert.deepEqual(toolResult.content,[{type:'tool_result',tool_use_id:'toolu_1',content:'Hello'}])
 assert.deepEqual(usage.at(-1),{inputTokens:12,outputTokens:9,totalTokens:21})
})

test('Anthropic max_tokens stop reason is treated as an incomplete model turn',async t=>{
 const connection=await anthropicServer(t,(_req,_body,res)=>{res.setHeader('Content-Type','text/event-stream');res.end(event({type:'message_start',message:{usage:{input_tokens:1,output_tokens:0}}})+event({type:'content_block_start',index:0,content_block:{type:'text',text:''}})+event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'partial'}})+event({type:'message_delta',delta:{stop_reason:'max_tokens'},usage:{output_tokens:2048}})+event({type:'message_stop'}))})
 await assert.rejects(requestAgentModel(connection,'claude-fixture',[{role:'user',content:'test'}],new AbortController().signal),/2048 Token/)
})
