import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ExperienceStore} from '../dist-electron/main/agent/core/experience-store.js'

function setup(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'experience-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return {directory,store:new ExperienceStore(directory)}}
test('experience persists safe metadata and requires program validation to promote',t=>{
 const {directory,store}=setup(t)
 store.record('查询天气 password=secret sk-private-user-text','/project-a',['weather.forecast'],true)
 assert.equal(store.state().entries[0].status,'candidate')
 assert.doesNotMatch(store.context('明天需要带伞吗','/project-a'),/已验证的方法/)
 store.record('上海明天天气','/project-a',['weather.forecast'],true,'weather-v1')
 store.enable(store.state().entries[0].id,1,true)
 const loaded=new ExperienceStore(directory)
 assert.equal(loaded.state().entries[0].status,'verified')
 assert.equal(loaded.state().entries[0].successes,2)
 assert.match(loaded.context('上海要带伞吗','/project-a'),/已验证的方法/)
 assert.doesNotMatch(loaded.context('上海要带伞吗','/project-b'),/已验证的方法/)
 assert.doesNotMatch(fs.readFileSync(path.join(directory,'experience-library.json'),'utf8'),/password|secret|sk-private|上海|project-a/)
 loaded.record('上海天气','/project-a',['weather.forecast'],false)
 assert.equal(loaded.state().entries[0].status,'candidate')
 assert.equal(loaded.state().entries[0].failures,1)
})
test('disabled collection, deletion, snapshot isolation and unrelated retrieval',t=>{
 const {directory,store}=setup(t)
 store.record('搜索资料','a',['agent.web_search','agent.web_fetch'],true)
 assert.equal(store.context('你好','a'),'')
 assert.equal(store.context('开发一个天气预报程序','a'),'')
 const state=store.state();state.entries.length=0
 assert.equal(store.state().entries.length,1)
 store.configure(false);store.record('搜索资料','a',['agent.web_fetch'],true)
 assert.equal(store.state().entries.length,1);assert.equal(store.context('搜索资料','a'),'')
 assert.equal(new ExperienceStore(directory).state().enabled,false)
 store.remove(store.state().entries[0].id)
 assert.equal(new ExperienceStore(directory).state().entries.length,0)
 assert.throws(()=>store.configure('yes'))
})
test('malformed persisted experience is preserved instead of silently overwritten',t=>{
 const {directory}=setup(t),file=path.join(directory,'experience-library.json')
 const content=JSON.stringify({enabled:true,entries:[{intent:'weather',tools:['system.override']}]})
 fs.writeFileSync(file,content)
 assert.throws(()=>new ExperienceStore(directory),/知识库格式无效/)
 assert.equal(fs.readFileSync(file,'utf8'),content)
})
