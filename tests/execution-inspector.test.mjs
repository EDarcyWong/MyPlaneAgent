import assert from 'node:assert/strict'
import {test} from 'node:test'
import {ExecutionInspector} from '../dist-electron/main/agent/core/execution-inspector.js'
const schema={type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}
test('paused calls do not run until validated arguments are applied; originals remain intact',async()=>{
 const inspector=new ExecutionInspector(new AbortController().signal,true)
 let executed=false
 const run=inspector.run('example',{query:'original'},schema,async args=>{executed=true;return args.query})
 const checkpointId=inspector.snapshot().checkpointId
 assert.equal(executed,false)
 assert.throws(()=>inspector.command({action:'continue',checkpointId:'stale',args:{query:'wrong'}}),/暂停点/)
 assert.throws(()=>inspector.command({action:'continue',checkpointId,args:{query:42}}))
 assert.equal(inspector.snapshot().checkpointId,checkpointId)
 inspector.command({action:'continue',checkpointId,args:{query:'changed'}})
 assert.equal(await run,'changed')
 const call=inspector.snapshot().calls[0]
 assert.deepEqual(call.originalArgs,{query:'original'});assert.deepEqual(call.args,{query:'changed'})
 assert.equal(call.edited,true);assert.equal(call.output,'changed');assert.equal(call.status,'complete')
})
test('single step pauses the next call, cancelling an armed pause resumes continuous execution',async()=>{
 const inspector=new ExecutionInspector(new AbortController().signal)
 inspector.command({action:'pause'})
 const first=inspector.before('tool','one','plugin',{query:'one'},schema)
 inspector.command({action:'step',checkpointId:inspector.snapshot().checkpointId})
 await first
 const second=inspector.before('tool','two','plugin',{query:'two'},schema)
 assert.ok(inspector.snapshot().checkpointId)
 inspector.command({action:'continue',checkpointId:inspector.snapshot().checkpointId})
 await second
 inspector.command({action:'pause'});inspector.command({action:'continue'})
 assert.deepEqual(await inspector.before('tool','three','plugin',{query:'three'},schema),{query:'three'})
 assert.equal(inspector.snapshot().checkpointId,undefined)
})
test('abort releases a paused request without running it',async()=>{
 const controller=new AbortController(),inspector=new ExecutionInspector(controller.signal,true)
 const run=inspector.run('example',{query:'stop'},schema,async()=>assert.fail('must not execute'))
 controller.abort()
 await assert.rejects(run)
 assert.equal(inspector.snapshot().checkpointId,undefined)
 assert.equal(inspector.snapshot().calls[0].status,'error')
 assert.throws(()=>inspector.command({action:'continue'}))
})
test('module contract validation leaves invalid edits paused and snapshots cannot mutate the run',async()=>{
 const inspector=new ExecutionInspector(new AbortController().signal,true)
 const run=inspector.run('example',{query:'valid'},schema,async args=>args, args=>{if(args.query!=='valid')throw Error('module contract')})
 const state=inspector.snapshot(),checkpointId=state.checkpointId
 state.calls[0].args.query='tamper'
 assert.throws(()=>inspector.command({action:'step',checkpointId,args:{query:'invalid'}}),/module contract/)
 assert.equal(inspector.snapshot().calls[0].args.query,'valid')
 inspector.command({action:'continue',checkpointId})
 assert.deepEqual(await run,{query:'valid'})
})
test('history and large outputs are bounded',async()=>{
 const inspector=new ExecutionInspector(new AbortController().signal)
 for(let i=0;i<65;i++)await inspector.run('example',{query:String(i)},schema,async()=> 'x'.repeat(20000))
 const state=inspector.snapshot()
 assert.equal(state.calls.length,60);assert.equal(state.calls[0].args.query,'5');assert.ok(state.calls[0].output.length<16100)
})
