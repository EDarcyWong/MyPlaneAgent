import {test} from 'node:test'
import assert from 'node:assert/strict'
import {beginOperation,operationKey,journalRequired} from '../dist-electron/main/agent/core/operation-journal.js'
test('journal identity survives reordered arguments and replanning but distinguishes workspace/task/arguments',()=>{
 const key=operationKey('t','w','write',{path:'a',content:'b'})
 assert.equal(key,operationKey('t','w','write',{content:'b',path:'a'}))
 for(const [task,workspace,args] of [['other','w',{path:'a',content:'b'}],['t','other',{path:'a',content:'b'}],['t','w',{path:'a',content:'c'}]])assert.notEqual(key,operationKey(task,workspace,'write',args))
})
test('persist before execution and block both succeeded and uncertain operations after reload',()=>{
 const journal={};let disk
 assert.equal(beginOperation(journal,'key',()=>disk=JSON.stringify(journal)),undefined)
 assert.equal(JSON.parse(disk).key.status,'started')
 assert.match(beginOperation(JSON.parse(disk),'key',()=>assert.fail()),/副作用/)
 journal.key.status='succeeded'
 assert.match(beginOperation(journal,'key',()=>assert.fail()),/成功记录/)
})
test('known reads and verification remain repeatable, writes and unknown tools are journaled',()=>{
 const cap=name=>({name,source:{type:'skill',skillId:'agent-tools'}})
 for(const name of ['agent.read_file','agent.list_files','agent.run_test','agent.get_diagnostics','agent.inspect_build','agent.read_history','agent.read_tool_result','agent.reconcile_execution'])assert.equal(journalRequired(cap(name)),false)
 for(const method of [undefined,'GET','HEAD'])assert.equal(journalRequired(cap('agent.http_request'),{method}),false)
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(journalRequired(cap('agent.http_request'),{method}),true)
 for(const name of ['agent.write_file','agent.run_command','agent.replace_text'])assert.equal(journalRequired(cap(name)),true)
 assert.equal(journalRequired({name:'read_file',source:{type:'mcp',serverId:'third-party'}}),true)
 for(const name of ['preview.start','preview.status','preview.stop']){
  assert.equal(journalRequired({name,source:{type:'builtin'}}),false)
  assert.equal(journalRequired({name,source:{type:'mcp',serverId:'third-party'}}),true)
 }
 assert.equal(journalRequired({name:'unknown.write',source:{type:'builtin'}}),true)
})
