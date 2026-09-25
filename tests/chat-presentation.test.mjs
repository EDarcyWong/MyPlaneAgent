import test from 'node:test'
import assert from 'node:assert/strict'
import {chatArtifacts,executionEntries,toolState,toolTarget} from '../dist-electron/shared/chat-presentation.js'
const activity=(overrides={})=>({id:'a',capability:'agent.write_file',args:{path:'hello.txt',content:'hello'},status:'complete',...overrides})
const message=(overrides={})=>({id:'m',role:'assistant',content:'已完成',createdAt:'now',toolActivity:[activity()],...overrides})
test('only successful file actions produce artifacts, without inventing a previous file version',()=>{
 const artifact=chatArtifacts([message()])[0]
 assert.equal(artifact.path,'hello.txt');assert.equal(artifact.after,'hello');assert.equal(artifact.before,undefined);assert.equal(artifact.kind,'text')
 for(const status of ['running','waiting','denied','error'])assert.deepEqual(chatArtifacts([message({toolActivity:[activity({status})]})]),[])
})
test('patches and replacements retain exact recorded content and clarify fragment scope',()=>{
 const patch=activity({capability:'agent.apply_patch',args:{changes:[{path:'a.ts',before:'before',after:'after'},{path:'b.ts',before:null,after:'new'}]}})
 const artifacts=chatArtifacts([message({toolActivity:[patch]})])
 assert.equal(artifacts.length,2);assert.equal(artifacts[0].before,'before');assert.equal(artifacts[0].after,'after');assert.notEqual(artifacts[0].id,artifacts[1].id)
 const replace=chatArtifacts([message({toolActivity:[activity({capability:'agent.replace_text',args:{path:'a.ts',oldText:'old',newText:'new'}})]})])[0]
 assert.match(replace.note,/文本片段/)
})
test('timeline keeps chronological progress and resolves latest tool status without duplicate cards',()=>{
 const execution=[{id:'p1',type:'progress',text:'读取文件',phase:'working',createdAt:'1'},{id:'a',type:'tool',activityId:'a',createdAt:'2'},{id:'p2',type:'progress',text:'核对结果',phase:'reviewing',createdAt:'3'}]
 const entries=executionEntries(message({execution}))
 assert.deepEqual(entries.map(row=>row.id),['p1','a','p2']);assert.equal(entries[1].activity.status,'complete')
 assert.equal(executionEntries(message())[0].activity.id,'a')
})
test('nonzero command exit codes are displayed as failures; targets remain literal strings',()=>{
 const command=activity({capability:'agent.run_command',args:{command:'npm test'},output:'{"exitCode":1,"output":"failed"}'})
 assert.equal(toolState(command),'error');assert.equal(toolTarget(command),'npm test')
 assert.deepEqual(chatArtifacts([message({toolActivity:[command]})]),[])
})
