import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {weatherSources} from '../dist-electron/main/agent/core/weather-source.js'
import {weatherDate} from '../dist-electron/main/agent/core/weather-workflow.js'
import {ExperienceFlow} from '../dist-electron/main/agent/core/experience-flow.js'
import {ExperienceStore,recipeTools} from '../dist-electron/main/agent/core/experience-store.js'
const date=()=>weatherDate('明天','Asia/Shanghai',new Date())
const page=(text=`上海 ${date()} 天气预报 20℃`,url='https://weather.example/forecast?token=private')=>({capability:'agent.web_fetch',status:'complete',output:JSON.stringify({url,text})})
test('weather learning extracts current evidence sources, not visited sites, raw URLs or answers',()=>{
 const valid=page()
 assert.deepEqual(weatherSources('上海明天天气',[{...valid,capability:'browser.open'},page('上海 昨天天气预报 20℃'),page(`北京 ${date()} 天气预报 20℃`),page(`上海 ${date()} 天气预报`),{...valid,status:'error'},valid,page()]),['weather.example'])
 assert.deepEqual(weatherSources('上海明天天气',[page(undefined,'https://user:secret@weather.example/')]),[])
 assert.deepEqual(weatherSources('写一个天气查询程序',[valid]),[])
})
test('weather methods deduplicate by source and query new parameters within that source',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'weather-source-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}))
 const store=new ExperienceStore(dir)
 store.record('上海明天天气',dir,['browser.open','browser.read_page','agent.web_fetch','agent.web_fetch'],true,undefined,'validation','weather.example')
 store.record('北京明天天气',dir,['agent.web_fetch'],true,undefined,'validation','weather.example')
 assert.equal(store.state().entries.length,1)
 const entry=store.state().entries[0]
 assert.equal(entry.successes,2);assert.equal(entry.recipe.kind,'weather-web');assert.equal(entry.enabled,false)
 assert.deepEqual(recipeTools(entry.recipe),['agent.web_search','agent.web_fetch'])
 assert.doesNotMatch(fs.readFileSync(path.join(dir,'experience-library.json'),'utf8'),/上海|北京|20℃|private|token/)
 for(const [body,finalUrl,passed] of [[`北京 ${date()} 天气预报 18℃`,'https://weather.example/beijing',true],[`上海 ${date()} 天气预报 18℃`,'https://weather.example/beijing',false],[`北京 2000-01-01 天气预报 18℃`,'https://weather.example/beijing',false],[`北京 ${date()} 天气预报 18℃`,'https://other.example/beijing',false]]){
  const flow=new ExperienceFlow(entry,{city:'北京',day:'明天'},dir,'18℃')
  const search=flow.next();assert.match(search.args.query,/北京/);assert.ok(search.args.query.includes(date()));assert.match(search.args.query,/site:weather\.example$/)
  flow.observe({capability:'agent.web_search',status:'complete',output:{results:[{url:'https://other.example/a',title:'北京天气预报'},{url:'https://weather.example/beijing',title:'北京天气预报'}]}})
  assert.equal(flow.next().args.url,'https://weather.example/beijing')
  flow.observe({capability:'agent.web_fetch',status:'complete',output:{requestedUrl:'https://weather.example/beijing',url:finalUrl,text:body}})
  assert.equal(flow.passed,passed)
 }
 store.verify(entry.id,1,true,[],'test');store.enable(entry.id,1,true)
 store.record('北京明天天气',dir,['weather.forecast'],true,'weather-v1')
 const loaded=new ExperienceStore(dir)
 assert.equal(loaded.match('北京明天天气',{workspace:dir,region:'CN',webEnabled:true,filesEnabled:false,tools:['weather.forecast','agent.web_search','agent.web_fetch']}).id,entry.id)
})
test('legacy weather traces need an explicit source and a new trial',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'weather-legacy-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}))
 const store=new ExperienceStore(dir)
 store.record('上海明天天气',dir,['browser.open','browser.read_page','agent.web_fetch','agent.web_fetch','agent.web_fetch','agent.web_fetch'],true)
 const entry=store.state().entries[0];store.convert(entry.id,1)
 const converted=store.get(entry.id)
 assert.equal(converted.recipe.kind,'weather-web');assert.equal(converted.recipe.sourceHost,'')
 assert.throws(()=>new ExperienceFlow(converted,{city:'上海',day:'明天'},dir,'20℃'),/补充天气来源/)
 assert.throws(()=>store.enable(entry.id,2,true),/试运行/)
 assert.equal(new ExperienceStore(dir).get(entry.id).recipe.kind,'weather-web')
})
