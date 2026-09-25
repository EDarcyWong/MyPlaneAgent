import test from 'node:test'
import assert from 'node:assert/strict'
import {CapabilityRegistry} from '../dist-electron/main/agent/core/capability-registry.js'
import {configureBrowserPlugin,registerBrowserPlugin} from '../dist-electron/main/browser-plugin.js'
import {chatCapabilityAllowed,chatApprovalRequired} from '../dist-electron/main/agent/core/chat-runner.js'
test('browser plugin is opt-in, respects web access and approval, and disables stale capabilities',async()=>{
 let enabled=false,calls=0
 configureBrowserPlugin({isAutomationEnabled:()=>enabled,automate:async()=>{calls++;return {performed:true}}})
 const registry=new CapabilityRegistry({getAllTools:()=>[]});registerBrowserPlugin(registry)
 assert.equal(registry.list().length,0);assert.equal(registry.getStats().total,0)
 enabled=true;assert.equal(registry.list().length,6)
 for(const capability of registry.list()){
  assert.equal(chatCapabilityAllowed(capability,{filesEnabled:false,webEnabled:true}),true)
  assert.equal(chatCapabilityAllowed(capability,{filesEnabled:true,webEnabled:false}),false)
  assert.equal(chatApprovalRequired(capability,{}, {workspace:'/tmp',approvalMode:'ask'}),true)
  assert.equal(chatApprovalRequired(capability,{}, {workspace:'/tmp',approvalMode:'auto'}),true)
 }
 const request={capability:'browser.read_page',args:{}}
 assert.equal((await registry.execute(request,new AbortController().signal)).success,true)
 enabled=false
 assert.equal((await registry.execute(request,new AbortController().signal)).success,false)
 assert.equal(calls,1)
})
