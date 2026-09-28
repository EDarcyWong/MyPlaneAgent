import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {requestAgentModel,ModelFormatError} from '../dist-electron/main/agent/model.js'

async function stream(batches,finish='tool_calls'){
 const server=createServer(async(req,res)=>{
  for await(const _ of req){}
  res.setHeader('content-type','text/event-stream')
  const frames=batches.map(tool_calls=>({choices:[{delta:{tool_calls},finish_reason:null}]}))
  if(finish)frames.push({choices:[{delta:{},finish_reason:finish}]})
  res.end(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join('')+'data: [DONE]\n\n')
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{return await requestAgentModel({endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',contextLength:4096,maxTokens:512},'fixture',[{role:'user',content:'fixture'}],new AbortController().signal)}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
}
const start=(id,index)=>({id,...(index===undefined?{}:{index}),type:'function',function:{name:'lookup',arguments:'{"query":"'}})
const part=(arguments_,index,extra={})=>({...extra,...(index===undefined?{}:{index}),function:{...extra.function,arguments:arguments_}})
test('ordinary indexed deltas, string indexes and sparse indexes preserve one complete call',async()=>{
 for(const index of [0,'0',9,100]){
  const answer=await stream([[start('a',index)],[part('hello',index)],[part('"}',index)]])
  assert.deepEqual(answer.tool_calls,[{id:'a',type:'function',function:{name:'lookup',arguments:'{"query":"hello"}'}}])
 }
})
test('single call missing/null index can continue by its unambiguous identity',async()=>{
 for(const index of [undefined,null]){
  const answer=await stream([[start('a',index)],[part('hello',index)],[part('"}',index)]])
  assert.equal(answer.tool_calls[0].id,'a');assert.equal(JSON.parse(answer.tool_calls[0].function.arguments).query,'hello')
 }
})
test('parallel missing-index deltas match IDs rather than the position of each batch',async()=>{
 const answer=await stream([[start('a'),start('b')],[part('second',undefined,{id:'b'})],[part('first',undefined,{id:'a'})],[part('"}',undefined,{id:'b'}),part('"}',undefined,{id:'a'})]])
 assert.deepEqual(answer.tool_calls.map(call=>[call.id,JSON.parse(call.function.arguments).query]),[['a','first'],['b','second']])
})
test('repeated metadata is not concatenated, but repeated argument fragments are preserved',async()=>{
 const answer=await stream([[start('a',0)],[part('x',0,{id:'a',function:{name:'lookup'}})],[part('x',0,{id:'a',function:{name:'lookup'}})],[part('"}',0)]])
 assert.equal(answer.tool_calls[0].id,'a');assert.equal(answer.tool_calls[0].function.name,'lookup');assert.equal(JSON.parse(answer.tool_calls[0].function.arguments).query,'xx')
})
test('ambiguous parallel unindexed continuations fail without producing executable calls',async()=>{
 await assert.rejects(stream([[start('a',0),start('b',1)],[part('unknown')]]),error=>error instanceof ModelFormatError&&/唯一匹配/.test(error.message))
 await assert.rejects(stream([[start('a')],[part('wrong',0,{id:'b'})]]),/不同调用 ID/)
})
test('malformed indexes remain errors and the eight-call limit applies across frames',async()=>{
 for(const index of [-1,0.5,'','1e0',true,{},[],Number.MAX_SAFE_INTEGER+1])await assert.rejects(stream([[start('a',index)]]),ModelFormatError)
 await assert.rejects(stream(Array.from({length:9},(_,index)=>[{...start('call'+index,index*10),function:{name:'lookup',arguments:'{}'}}])),/超过 8 个/)
})
test('truncated responses still cannot return partial tool calls',async()=>{
 await assert.rejects(stream([[start('a')]],null),/意外中断/)
 await assert.rejects(stream([[start('a')]],'length'),error=>error.name==='ModelOutputLimitError')
})
