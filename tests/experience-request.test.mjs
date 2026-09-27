import test from 'node:test'
import assert from 'node:assert/strict'
import {parseExperienceRequest} from '../dist-electron/main/agent/core/experience-request.js'
import {experienceIntent,defaultRecipe} from '../dist-electron/main/agent/core/experience-store.js'
import {flowInputs} from '../dist-electron/main/agent/core/experience-flow.js'
import {parseWeatherRequest} from '../dist-electron/main/agent/core/weather-workflow.js'

test('equivalent explicit research phrases bind the same literal query and intent',()=>{
 for(const phrase of ['搜索','请帮我搜一下','麻烦你帮我查一下','帮我上网找一下','查下','搜一搜','please search for ','look up ','find ']){
  const text=phrase+'Vue 官方文档'
  assert.deepEqual(parseExperienceRequest(text),{kind:'web-research',values:{query:'Vue 官方文档'}},text)
  assert.equal(experienceIntent(text),'research')
  assert.deepEqual(flowInputs(text,defaultRecipe('research',['agent.web_search','agent.web_fetch'])),{query:'Vue 官方文档'})
 }
 const query='site:vuejs.org Composition API v3.5'
 assert.equal(parseExperienceRequest('帮我搜一下 '+query).values.query,query)
})
test('file phrases preserve the exact path, case and quoted spaces',()=>{
 for(const phrase of ['读取','请帮我看一下','查看','读一读','麻烦你帮我查阅','please read ','show me the file ','view ']){
  const text=phrase+'README.md'
  assert.deepEqual(parseExperienceRequest(text),{kind:'file-read',values:{path:'README.md'}},text)
  assert.equal(experienceIntent(text),'files')
 }
 for(const text of ['读取文件 “docs/My Notes.md”的内容','请帮我查看 "docs/My Notes.md"','please read the file "docs/My Notes.md"']){
  assert.equal(parseExperienceRequest(text).values.path,'docs/My Notes.md',text)
 }
 assert.equal(parseExperienceRequest('查看文件说明.md').values.path,'文件说明.md')
 assert.equal(parseExperienceRequest('读取 .gitignore').values.path,'.gitignore')
 assert.equal(parseExperienceRequest('读取 docs/My Notes.md'),undefined)
 for(const text of ['查看上海明天天气','打开浏览器','查看这个项目','查看 https://vuejs.org'])assert.equal(parseExperienceRequest(text),undefined,text)
})
test('negated, compound, restricted and ambiguous requests are not auto-bound',()=>{
 for(const text of ['不要搜索 Vue','不用读取 README.md','搜索 Vue 然后保存结果','查询 Vue 并解释结果','搜索 Vue，只用百度','只用 Google 搜索 Vue','read README.md and delete it','search Vue then send it','read "a.md" "b.md"','查看这个文件','帮我看看','读取 "unclosed.md','搜索 x']){
  assert.equal(parseExperienceRequest(text),undefined,text)
 }
 assert.equal(flowInputs('搜索 Vue',defaultRecipe('files',['agent.read_file'])),undefined)
 assert.equal(flowInputs('读取 README.md',defaultRecipe('research',['agent.web_search','agent.web_fetch'])),undefined)
})
test('weather umbrella and rain expressions preserve city and date binding',()=>{
 for(const query of ['上海明天会不会下雨','明天上海是否下雨？','上海明天需不需要带伞','上海明天用不用带伞']){
  assert.deepEqual(parseWeatherRequest(query),{city:'上海',day:'明天'},query)
 }
 for(const query of ['不要查上海明天天气','上海明天会不会下雨然后发邮件','上海和北京明天是否下雨','上海明天天气只用百度'])assert.equal(parseWeatherRequest(query),undefined,query)
})
