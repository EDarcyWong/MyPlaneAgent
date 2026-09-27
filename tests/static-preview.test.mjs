import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {StaticPreview} from '../dist-electron/main/agent/static-preview.js'
import {CapabilityRegistry} from '../dist-electron/main/agent/core/capability-registry.js'
import {chatCapabilityAllowed} from '../dist-electron/main/agent/core/chat-runner.js'
import {beginOperation,operationKey,journalRequired} from '../dist-electron/main/agent/core/operation-journal.js'
test('static preview plugin lifecycle, registry workspace, file boundary and MIME',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'preview-plugin-')),config=path.join(root,'settings.json'),service=new StaticPreview(config)
 t.after(async()=>{await service.dispose();fs.rmSync(root,{recursive:true,force:true})})
 const registry=new CapabilityRegistry({getAllTools:()=>[]});service.register(registry)
 assert.equal(registry.list().length,0);await service.configure(true)
 assert.equal(registry.list().length,3)
 assert.equal(new StaticPreview(config).state().enabled,true)
 fs.writeFileSync(path.join(root,'index.html'),'<script type="module" src="./app.js"></script>');fs.writeFileSync(path.join(root,'app.js'),'export const value=1');fs.writeFileSync(path.join(root,'.env'),'secret')
 const signal=new AbortController().signal
 const started=await registry.execute({capability:'preview.start',args:{},workspace:root},signal)
 assert.equal(started.success,true);const url=started.output.url
 assert.equal((await fetch(url)).status,200);assert.match((await fetch(url+'app.js')).headers.get('content-type'),/javascript/)
 assert.equal((await fetch(url+'.env')).status,404);assert.equal((await fetch(url,{method:'POST'})).status,405)
 assert.equal((await service.start(root,undefined,signal)).reused,true)
 const capability=registry.get('preview.start')
 assert.equal(chatCapabilityAllowed(capability,{filesEnabled:true,webEnabled:true}),true)
 assert.equal(chatCapabilityAllowed(capability,{filesEnabled:false,webEnabled:true}),false)
 await service.configure(false);assert.equal(registry.list().length,0);assert.equal(service.state().running,0)
 await assert.rejects(fetch(url));await assert.rejects(service.start(root,undefined,signal),/未启用/)
})

test('persisted successful preview calls can reuse, stop and restart with live URLs',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'preview-replay-')),config=path.join(root,'settings.json')
 let service=new StaticPreview(config)
 t.after(async()=>{await service.dispose();fs.rmSync(root,{recursive:true,force:true})})
 fs.writeFileSync(path.join(root,'index.html'),'preview ready')
 await service.configure(true)
 let registry=new CapabilityRegistry({getAllTools:()=>[]});service.register(registry)
 const journal=Object.fromEntries(['start','stop','status'].map(op=>[operationKey('task',root,'preview.'+op,{}),{status:'succeeded',updatedAt:new Date().toISOString()}]))
 const saved=JSON.stringify(journal),signal=new AbortController().signal
 const execute=async name=>{
  const cap=registry.get(name)
  const block=journalRequired(cap)?beginOperation(journal,operationKey('task',root,name,{}),()=>{}):undefined
  assert.equal(block,undefined)
  const result=await registry.execute({capability:name,args:{},workspace:root},signal)
  assert.equal(result.success,true)
  return result.output
 }
 const first=await execute('preview.start'),reused=await execute('preview.start')
 assert.equal(reused.reused,true);assert.equal(reused.url,first.url)
 assert.equal(await(await fetch(reused.url)).text(),'preview ready')
 await execute('preview.stop');await execute('preview.stop')
 assert.equal((await execute('preview.status')).status,'stopped')
 const restarted=await execute('preview.start');assert.equal(restarted.reused,false)
 assert.equal((await fetch(restarted.url)).status,200)
 await service.dispose()
 service=new StaticPreview(config);registry=new CapabilityRegistry({getAllTools:()=>[]});service.register(registry)
 const restored=await execute('preview.start');assert.equal(restored.reused,false)
 assert.equal((await fetch(restored.url)).status,200)
 assert.equal(JSON.stringify(journal),saved,'old execution records must be preserved')
})
