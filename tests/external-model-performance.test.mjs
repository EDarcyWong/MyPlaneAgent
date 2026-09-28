import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {ExternalModelPerformanceTracker,externalModelPerformance} from '../dist-electron/main/external-model-performance.js'
import {requestAgentModel} from '../dist-electron/main/agent/model.js'
test('external request throughput includes waiting, corrects cumulative usage, isolates requests and bounds history',()=>{
 const tracker=new ExternalModelPerformanceTracker(),id=tracker.begin('https://fixture/v1','model',1000)
 tracker.progress(id,40,2000);tracker.usage(id,{inputTokens:100,outputTokens:1})
 const live=tracker.snapshot(undefined,3000)[0]
 assert.equal(live.outputTokens,10);assert.equal(live.outputRate,5);assert.equal(live.firstOutputMs,1000);assert.equal(live.tokenBasis,'estimated');assert.equal(live.inputRate,undefined)
 tracker.usage(id,{outputTokens:20});tracker.usage(id,{outputTokens:20});tracker.finish(id,'complete',0,5000)
 const done=tracker.snapshot()[0];assert.equal(done.outputTokens,20);assert.equal(done.outputRate,5);assert.equal(done.tokenBasis,'usage');assert.equal(done.elapsedMs,4000)
 assert.equal(tracker.snapshot('https://other/v1').length,0)
 for(let i=0;i<20;i++){const next=tracker.begin('https://fixture/v1','parallel',6000);tracker.finish(next,'cancelled',0,6500)}
 assert.equal(tracker.snapshot().length,16);assert.equal(tracker.snapshot()[0].outcome,'cancelled');assert.equal(tracker.snapshot()[0].outputTokens,undefined)
})
test('missing usage stays estimated, failed requests do not claim a complete token report',()=>{
 const tracker=new ExternalModelPerformanceTracker(),id=tracker.begin('url','model',0)
 tracker.progress(id,80,1000);tracker.finish(id,'complete',80,2000)
 assert.equal(tracker.snapshot()[0].tokenBasis,'estimated');assert.equal(tracker.snapshot()[0].outputRate,10)
 const failed=tracker.begin('url','model',0);tracker.usage(failed,{outputTokens:100});tracker.finish(failed,'error',0,2000)
 assert.equal(tracker.snapshot()[0].outputTokens,undefined);assert.equal(tracker.snapshot()[0].outcome,'error')
})
async function withServer(handler,work){const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await work(`http://127.0.0.1:${server.address().port}/v1`)}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
const connection=endpoint=>({endpoint,key:'test-private-key',maxTokens:512,contextLength:4096})
const messages=[{role:'user',content:'private prompt'}]
test('actual OpenAI SSE instrumentation counts reasoning, then uses provider usage',async()=>{
 externalModelPerformance.reset()
 await withServer(async(req,res)=>{
  for await(const _ of req){}
  res.writeHead(200,{'content-type':'text/event-stream'})
  res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'think',content:'result'},finish_reason:null}]})+'\n\n')
  await new Promise(resolve=>setTimeout(resolve,160))
  res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:25,completion_tokens:12}})+'\n\ndata: [DONE]\n\n')
 },async endpoint=>{
  let reported
  const answer=await requestAgentModel(connection(endpoint),'fixture',messages,new AbortController().signal,{onUsage:value=>reported=value})
  assert.equal(answer.content,'result');assert.equal(reported.outputTokens,12)
  const sample=externalModelPerformance.snapshot(endpoint)[0]
  assert.equal(sample.tokenBasis,'usage');assert.equal(sample.inputTokens,25);assert.equal(sample.outputTokens,12);assert.ok(sample.outputRate>0);assert.ok(sample.firstOutputMs>=0)
  assert.doesNotMatch(JSON.stringify(sample),/private prompt|test-private-key|reasoning_content/)
 })
})
test('Anthropic SSE final usage replaces its initial zero output; JSON fallback is measured',async()=>{
 externalModelPerformance.reset()
 for(const streaming of [true,false])await withServer(async(req,res)=>{
  for await(const _ of req){}
  await new Promise(resolve=>setTimeout(resolve,120))
  if(!streaming){res.setHeader('content-type','application/json');res.end(JSON.stringify({content:[{type:'text',text:'answer'}],stop_reason:'end_turn',usage:{input_tokens:11,output_tokens:7}}));return}
  res.setHeader('content-type','text/event-stream')
  const frames=[{type:'message_start',message:{usage:{input_tokens:11,output_tokens:0}}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'answer'}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:7}},{type:'message_stop'}]
  res.end(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join(''))
 },async endpoint=>{
  await requestAgentModel({...connection(endpoint),apiFormat:'anthropic'},'fixture',messages,new AbortController().signal)
  const sample=externalModelPerformance.snapshot(endpoint)[0];assert.equal(sample.outputTokens,7);assert.equal(sample.inputTokens,11);assert.equal(sample.tokenBasis,'usage');assert.ok(sample.outputRate>0)
 })
})
test('managed llama requests do not create external samples; failed attempts terminate',async()=>{
 externalModelPerformance.reset()
 await withServer(async(req,res)=>{for await(const _ of req){}res.writeHead(503);res.end('fixture unavailable')},async endpoint=>{
  await assert.rejects(requestAgentModel({...connection(endpoint),localLlama:true},'fixture',messages,new AbortController().signal))
  assert.equal(externalModelPerformance.snapshot(endpoint).length,0)
  await assert.rejects(requestAgentModel(connection(endpoint),'fixture',messages,new AbortController().signal))
  assert.equal(externalModelPerformance.snapshot(endpoint)[0].outcome,'error')
 })
})
test('stream cancellation records a terminal partial estimate and concurrent requests remain independent',async()=>{
 externalModelPerformance.reset()
 await withServer(async(req,res)=>{for await(const _ of req){}res.setHeader('content-type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{content:'partial output'},finish_reason:null}]})+'\n\n')},async endpoint=>{
  const controller=new AbortController()
  await assert.rejects(requestAgentModel(connection(endpoint),'cancel-fixture',messages,controller.signal,{onProgress:()=>controller.abort()}))
  const sample=externalModelPerformance.snapshot(endpoint)[0];assert.equal(sample.outcome,'cancelled');assert.equal(sample.phase,'finished');assert.equal(sample.tokenBasis,'estimated');assert.ok(sample.outputTokens>0)
 })
 const tracker=new ExternalModelPerformanceTracker(),first=tracker.begin('a','first',1000),second=tracker.begin('b','second',1000)
 tracker.progress(first,40,2000);tracker.progress(second,80,2000);tracker.usage(first,{outputTokens:4});tracker.finish(first,'complete',0,3000)
 assert.equal(tracker.snapshot('a')[0].outputTokens,4);assert.equal(tracker.snapshot('b',3000)[0].outputTokens,20)
})
