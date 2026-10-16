import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {PythonRuntimeManager} from '../dist-electron/main/agent/core/python-runtime-manager.js'

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-worker-'))
 fs.writeFileSync(path.join(root,'index.py'),`import json, os, pathlib, sys, time
print('READY', flush=True)
for line in sys.stdin:
    request=json.loads(line)
    args=request['args']
    if args.get('started'): pathlib.Path(args['started']).write_text('started')
    while args.get('gate') and not pathlib.Path(args['gate']).exists(): time.sleep(0.005)
    print(json.dumps({'type':'response','id':request['id'],'output':{'pid':os.getpid(),'value':args.get('value')},'elapsedMs':1}), flush=True)
`)
 const manager=new PythonRuntimeManager(root)
 t.after(async()=>{await manager.dispose();fs.rmSync(root,{recursive:true,force:true})})
 const run=(args,signal=new AbortController().signal)=>manager.execute({skillId:'fixture',skillPath:root,tool:'read',args,workspace:root,venv:false,timeout:5000},signal)
 return {root,manager,run}
}
async function started(file){
 for(let n=0;n<400;n++){if(fs.existsSync(file))return;await new Promise(resolve=>setTimeout(resolve,5))}
 assert.fail('Python request did not start')
}

test('concurrent subagents reuse one skill process without startup races',async t=>{
 const {manager,run}=fixture(t)
 const results=await Promise.all([run({value:'A'}),run({value:'B'})])
 assert.equal(results[0].output.pid,results[1].output.pid)
 assert.deepEqual(results.map(result=>result.output.value),['A','B'])
 assert.equal(manager.listWorkers().length,1)
 assert.equal(manager.listWorkers()[0].pendingTasks,0)
})

test('cancelling a queued or completed caller does not interrupt another subagent',async t=>{
 const {root,run}=fixture(t),firstController=new AbortController(),queuedController=new AbortController()
 const firstStarted=path.join(root,'first'),firstGate=path.join(root,'release-first')
 const first=run({started:firstStarted,gate:firstGate,value:'first'},firstController.signal)
 await started(firstStarted)
 const cancelled=assert.rejects(run({value:'cancelled'},queuedController.signal),/queued cancellation/)
 const secondStarted=path.join(root,'second'),secondGate=path.join(root,'release-second')
 const second=run({started:secondStarted,gate:secondGate,value:'second'})
 queuedController.abort(new Error('queued cancellation'))
 await cancelled
 fs.writeFileSync(firstGate,'go')
 const firstResult=await first
 await started(secondStarted)
 firstController.abort(new Error('old completed caller cancelled'))
 fs.writeFileSync(secondGate,'go')
 const secondResult=await second
 assert.equal(firstResult.output.pid,secondResult.output.pid)
 assert.equal(secondResult.output.value,'second')
})

test('active cancellation finishes stopping its process before a queued peer starts',async t=>{
 const {root,manager,run}=fixture(t),controller=new AbortController(),marker=path.join(root,'active')
 const cancelled=assert.rejects(run({started:marker,gate:path.join(root,'never')},controller.signal),/cancelled/i)
 await started(marker)
 const oldPid=manager.listWorkers()[0].pid
 const next=run({value:'recovered'})
 controller.abort()
 await cancelled
 const result=await next
 assert.notEqual(result.output.pid,oldPid)
 assert.equal((await run({value:'again'})).output.pid,result.output.pid)
})

test('disposing the runtime prevents queued callers from restarting a worker',async t=>{
 const {root,manager,run}=fixture(t),marker=path.join(root,'active')
 const active=assert.rejects(run({started:marker,gate:path.join(root,'never')}),/stopped/)
 await started(marker)
 const queued=assert.rejects(run({value:'must not start'}),/disposed/)
 await manager.dispose()
 await Promise.all([active,queued])
 assert.equal(manager.listWorkers().length,0)
 await assert.rejects(run({}),/disposed/)
})
