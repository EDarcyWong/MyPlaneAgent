import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ExperienceStore} from '../dist-electron/main/agent/core/experience-store.js'
import {learnExperience} from '../dist-electron/main/agent/core/experience-learning.js'
const activity=(capability,args,output)=>({id:capability,capability,args,status:'complete',output:JSON.stringify(output)})
test('successful evidence improves a repeated trace without executing tools or enabling it',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'learning-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=new ExperienceStore(dir),query='搜索 Vue 文档',tools=['agent.web_search','agent.web_search','agent.web_fetch']
 const entry=store.record(query,dir,tools,true)
 const evidence=[activity('agent.web_search',{query},{results:[]}),activity('agent.web_search',{query},{results:[{title:'Vue 文档',url:'https://vuejs.org/guide'}]}),activity('agent.web_fetch',{url:'https://vuejs.org/guide'},{url:'https://vuejs.org/guide',text:'Vue 文档正文'})]
 learnExperience(store,entry,query,dir,evidence,true)
 const current=store.get(entry.id)
 assert.equal(current.recipe.kind,'web-research');assert.equal(current.revision,2)
 assert.equal(current.verification.passed,true);assert.equal(current.enabled,false);assert.equal(current.learning.status,'verified')
 assert.equal(current.history[0].recipe.kind,'unsupported')
 assert.equal(new ExperienceStore(dir).get(entry.id).learning.status,'verified')
 assert.doesNotMatch(fs.readFileSync(path.join(dir,'experience-library.json'),'utf8'),/文档正文|https:/)
 store.edit(entry.id,2,{...current.recipe,title:'用户条件'})
 learnExperience(store,store.get(entry.id),query,dir,evidence,true)
 assert.equal(store.get(entry.id).revision,3);assert.equal(store.get(entry.id).verification,undefined)
})
test('failed or incomplete executions cannot certify a learned method',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'learning-failed-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const store=new ExperienceStore(dir),query='搜索资料',entry=store.record(query,dir,['agent.web_search'],false)
 learnExperience(store,entry,query,dir,[],false)
 assert.equal(store.get(entry.id).learning.status,'blocked');assert.equal(store.get(entry.id).recipe.kind,'unsupported')
 learnExperience(store,store.get(entry.id),query,dir,[],true)
 assert.equal(store.get(entry.id).learning.status,'candidate');assert.equal(store.get(entry.id).verification,undefined)
 const query2='搜索资料',url='https://example.org/info'
 const evidence=[activity('agent.web_search',{query:query2},{results:[{url,title:'资料'}]}),activity('agent.web_fetch',{url},{url,text:'资料正文'})]
 learnExperience(store,store.get(entry.id),query2,dir,evidence,true)
 assert.equal(store.get(entry.id).learning.status,'verified')
})
