import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {LocalAgentService} from '../dist-electron/main/agent/service.js'

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check){for(let i=0;i<600;i++){if(check())return;await pause(10)}throw new Error('Timed out')}
const call=name=>({id:randomUUID(),type:'function',function:{name,arguments:'{}'}})
const response=(content,tool_calls)=>({choices:[{finish_reason:tool_calls?'tool_calls':'stop',message:{role:'assistant',content,tool_calls}}]})
async function fixture(t,reply,external=[]){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-steering-')),workspace=path.join(root,'project');fs.mkdirSync(workspace)
 const bodies=[],server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);bodies.push(body);const answer=await reply(body,bodies.length);if(answer){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(answer))}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const directory=path.join(root,'tasks'),connection=()=>({endpoint:`http://127.0.0.1:${server.address().port}/v1`,key:'',contextLength:16384,maxTokens:1000})
 const service=new LocalAgentService(directory,connection,()=>external)
 t.after(()=>{service.dispose();server.closeAllConnections();server.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50})})
 return {service,bodies,directory,connection,start:(extra={})=>service.start({workspace,mode:'general',model:'fixture',prompt:'原任务',maxSteps:10,approvalMode:'full',...extra},7,()=>{})}
}
test('steering interrupts generation, is owner-scoped and deduplicated, and reaches the same task',async t=>{
 const h=await fixture(t,(_body,n)=>n===1?null:response('遵循新的方向'))
 const task=h.start();await until(()=>h.bodies.length===1)
 const messageId=randomUUID()
 assert.throws(()=>h.service.steer(task.id,messageId,'错误窗口',[],8),/当前窗口/)
 h.service.steer(task.id,messageId,'只分析，不修改',[],7)
 h.service.steer(task.id,messageId,'只分析，不修改',[],7)
 await until(()=>!h.service.active(task.id))
 const result=h.service.get(task.id)
 assert.equal(result.status,'completed',result.error);assert.equal(result.events.filter(event=>event.id===messageId).length,1)
 assert.equal(result.events.find(event=>event.id===messageId).steering,'applied')
 assert.match(JSON.stringify(h.bodies.at(-1).messages),/只分析，不修改/)
 assert.throws(()=>h.service.steer(task.id,randomUUID(),'已结束',[],7),/已结束/)
})
test('steering waits for a started tool, skips unstarted batch calls and keeps tool replies paired',async t=>{
 let release,started=false,secondCalls=0
 const spec=(name,execute)=>({definition:{type:'function',function:{name,description:name,parameters:{type:'object',properties:{},additionalProperties:false}}},source:'mcp:fixture',risk:'high',timeoutMs:5000,execute})
 const h=await fixture(t,(_body,n)=>n===1?response(null,[call('first'),call('second')]):response('已调整'),[
  spec('first',async()=>{started=true;return await new Promise(resolve=>{release=()=>resolve('{"ok":true}')})}),
  spec('second',async()=>{secondCalls++;return '{}'})
 ])
 const task=h.start();await until(()=>h.service.get(task.id).status==='waiting');const pending=h.service.get(task.id).events.at(-1);assert.equal(pending.tool,'first');h.service.approve(task.id,pending.id,true,7);await until(()=>started)
 h.service.steer(task.id,randomUUID(),'跳过剩余操作，只汇报',[],7)
 await pause(30);assert.equal(h.bodies.length,1,'must not start another round during a tool')
 release();await until(()=>!h.service.active(task.id))
 assert.equal(secondCalls,0);assert.equal(h.service.get(task.id).status,'completed')
 const messages=h.bodies.at(-1).messages,assistant=messages.find(message=>message.tool_calls?.length)
 for(const invocation of assistant.tool_calls)assert.equal(messages.filter(message=>message.tool_call_id===invocation.id).length,1)
 assert.match(JSON.stringify(messages),/STEERED/);assert.match(JSON.stringify(messages.at(-1)),/跳过剩余操作/)
})
test('steering dismisses pending approval without executing or treating it as a permission rejection',async t=>{
 const h=await fixture(t,(_body,n)=>n===1?response(null,[{id:randomUUID(),type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'unwanted.txt',content:'old plan'})}}]):response('已取消原修改'))
 const task=h.start({approvalMode:'ask'});await until(()=>h.service.get(task.id).status==='waiting')
 h.service.steer(task.id,randomUUID(),'不要写入，直接说明',[],7)
 await until(()=>!h.service.active(task.id))
 const result=h.service.get(task.id),operation=result.events.find(event=>event.tool==='write_file')
 assert.equal(result.status,'completed',result.error);assert.equal(operation.audit.errorCode,'STEERED');assert.equal(operation.execution.state,'not-applied')
 assert.equal(fs.existsSync(path.join(result.workspace,'unwanted.txt')),false)
})
