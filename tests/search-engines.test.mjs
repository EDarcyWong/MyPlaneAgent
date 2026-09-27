import test from 'node:test'
import assert from 'node:assert/strict'
import {searchRegion,searchOrders,searchEngineUrl,runSearchPlan,relevantSearchResult} from '../dist-electron/main/agent/search-engines.js'
import {parseSearchResults} from '../dist-electron/main/agent/web-access.js'
import {CapabilityRegistry} from '../dist-electron/main/agent/core/capability-registry.js'

test('region uses timezone ahead of locale and supports explicit overrides without IP lookup',()=>{
 for(const [timezone,locale,region] of [['Asia/Shanghai','en-US','CN'],['Asia/Seoul','en-US','KR'],['Europe/Moscow','en-US','RU'],['Asia/Vladivostok','en-US','RU'],['America/Los_Angeles','zh-CN','GLOBAL'],['Asia/Taipei','zh-TW','GLOBAL'],['UTC','zh-CN','CN'],['UTC','en-US','GLOBAL']]){
  assert.equal(searchRegion({override:'AUTO',timezone,locale}).region,region)
 }
 assert.equal(searchRegion({override:'GLOBAL',timezone:'Asia/Shanghai'}).basis,'override')
 assert.throws(()=>searchRegion({override:'unknown'}))
})
test('every regional plan uses ten unique mainstream search endpoints with encoded queries',()=>{
 for(const order of Object.values(searchOrders)){
  assert.equal(new Set(order).size,10)
  const urls=order.map(engine=>new URL(searchEngineUrl(engine,'上海 & weather?',5)))
  assert.equal(new Set(urls.map(url=>url.hostname)).size,10)
  for(const url of urls){assert.equal(url.protocol,'https:');assert.ok([...url.searchParams.values()].includes('上海 & weather?'));assert.doesNotMatch(url.hostname,/baike|wikipedia/)}
 }
})
test('regional fallback stops at first nonempty result and propagates cancellation',async()=>{
 const calls=[]
 const result=await runSearchPlan('CN',new AbortController().signal,async name=>{calls.push(name);if(name==='baidu')throw new Error('blocked');if(name==='bing')return [];return [{url:'https://example.com'}]})
 assert.deepEqual(calls,['baidu','bing','so']);assert.deepEqual(result.providers.map(p=>p.status),['failed','empty','ok'])
 const exhausted=await runSearchPlan('RU',new AbortController().signal,async()=>[])
 assert.equal(exhausted.providers.length,10);assert.equal(exhausted.results.length,0)
 const abort=new AbortController(),visited=[]
 await assert.rejects(runSearchPlan('GLOBAL',abort.signal,async name=>{visited.push(name);abort.abort();throw new Error('aborted')}),{name:'AbortError'})
 assert.deepEqual(visited,['google'])
})
test('additional engine parsers retain result links and ignore navigation/private targets',()=>{
 for(const engine of ['yahoo','yandex','shenma','so','sogou','naver']){
  const body='<a href="/login">Login</a><h3><a href="https://example.com/docs">Official docs</a></h3><h3><a href="http://127.0.0.1/admin">Private</a></h3>'
  const results=parseSearchResults(body,engine,5)
  assert.equal(results.length,1,engine);assert.equal(results[0].url,'https://example.com/docs');assert.equal(results[0].engine,engine)
 }
 assert.equal(parseSearchResults('<a class="title_link" href="https://example.com">Naver result</a>','naver',5).length,1)
 assert.equal(parseSearchResults('<h3><a href="https://r.search.yahoo.com/a/RU=https%3A%2F%2Fexample.com%2Fdocs/RK=2/RS=x">Docs</a></h3>','yahoo',5)[0].url,'https://example.com/docs')
 assert.deepEqual(parseSearchResults('<h3><a href="/search?query=other">Search again</a></h3>','naver',5),[])
})
test('host forwards detected region into the shipped Python search runtime',async()=>{
 let context
 const registry=new CapabilityRegistry({executeTool:async(_id,_name,_args,_signal,_workspace,value)=>{context=value;return {results:[]}}})
 registry.register({name:'agent.web_search',description:'search',category:'agent',runtime:'python-native',source:{type:'skill',skillId:'agent-tools'},parameters:{type:'object',properties:{query:{type:'string'}}},permissions:['network']})
 const result=await registry.execute({capability:'agent.web_search',args:{query:'hello'},workspace:'.',context:{allowExternalPaths:false}},new AbortController().signal)
 assert.equal(result.success,true);assert.deepEqual(context.searchRouting,searchRegion());assert.equal(context.allowExternalPaths,false)
})
test('unrelated search responses are not accepted as usable results',()=>{
 assert.equal(relevantSearchResult('Vue 官方文档','Apple','Apple official site'),false)
 assert.equal(relevantSearchResult('Vue 官方文档','Vue.js','The official guide'),true)
 assert.equal(relevantSearchResult('上海明天天气','上海天气预报','明日预报'),true)
})
