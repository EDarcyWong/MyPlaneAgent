import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {parseBaiduResults,parseDuckDuckGoResults,parseGoogleResults,webFetch,webSearch} from '../dist-electron/main/agent/web-access.js'
import {LocalAgentService} from '../dist-electron/main/agent/service.js'
import {ExecutionJournal} from '../dist-electron/main/agent/execution-journal.js'

const signal=()=>new AbortController().signal
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const until=async check=>{for(let index=0;index<500;index++){if(check())return;await pause(10)}throw new Error('Timed out')}

test('web search supports a configured local SearXNG endpoint and returns public source metadata',async t=>{
 const server=createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');assert.equal(url.searchParams.get('q'),'官方文档');assert.equal(url.searchParams.get('format'),'json')
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({results:[{title:'<b>文档</b>',url:'https://docs.example.com/guide',content:'可核对的 <em>摘要</em>'},{title:'private',url:'http://127.0.0.1/admin',content:'blocked'}]}))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
 const previous=process.env.MYPLANE_WEB_SEARCH_ENDPOINT;process.env.MYPLANE_WEB_SEARCH_ENDPOINT=`http://127.0.0.1:${server.address().port}/search`;t.after(()=>previous===undefined?delete process.env.MYPLANE_WEB_SEARCH_ENDPOINT:process.env.MYPLANE_WEB_SEARCH_ENDPOINT=previous)
 const result=JSON.parse(await webSearch({query:'官方文档',limit:5},signal()))
 assert.equal(result.provider,'configured-searxng');assert.equal(result.results.length,1);assert.deepEqual(result.results[0],{title:'文档',url:'https://docs.example.com/guide',snippet:'可核对的 摘要',source:'docs.example.com',engine:'searxng'});assert.ok(result.searchedAt)
})

test('web tools reject private targets and sensitive queries before sending data',async()=>{
 await assert.rejects(webFetch({url:'http://127.0.0.1:8080/private'},signal()),error=>error.code==='WEB_URL_BLOCKED')
 await assert.rejects(webFetch({url:'file:///etc/passwd'},signal()),error=>error.code==='WEB_URL_BLOCKED')
 await assert.rejects(webSearch({query:'token=super-secret-value'},signal()),error=>error.code==='WEB_QUERY_SENSITIVE')
 await assert.rejects(webSearch({query:'/Users/alice/project/private/error.log'},signal()),error=>error.code==='WEB_QUERY_SENSITIVE')
})

test('major search engine HTML results retain engine provenance and public URLs',()=>{
 const duck=parseDuckDuckGoResults('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.com%2Fguide">Guide</a><a class="result__snippet">Duck summary</a>',5)
 const baidu=parseBaiduResults('<h3 class="t"><a href="https://www.example.cn/article">中文结果</a></h3><div class="c-abstract">百度摘要</div>',5)
 const google=parseGoogleResults('<a href="/url?q=https%3A%2F%2Fexample.org%2Fdocs"><h3>Docs</h3></a><div data-sncf="1">Google summary</div>',5)
 assert.deepEqual(duck[0],{title:'Guide',url:'https://docs.example.com/guide',snippet:'Duck summary',source:'docs.example.com',engine:'duckduckgo'})
 assert.deepEqual(baidu[0],{title:'中文结果',url:'https://www.example.cn/article',snippet:'百度摘要',source:'www.example.cn',engine:'baidu'})
 assert.deepEqual(google[0],{title:'Docs',url:'https://example.org/docs',snippet:'Google summary',source:'example.org',engine:'google'})
})

test('project web policy defaults to automatic research and can be disabled',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-web-policy-')),workspace=path.join(root,'project');fs.mkdirSync(workspace);t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 let searches=0
 const server=createServer(async(request,response)=>{
  if(request.method==='GET'){searches++;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({results:[{title:'Official',url:'https://example.com/docs',content:'source'}]}));return}
  let raw='';for await(const chunk of request)raw+=chunk;const body=JSON.parse(raw),hasResult=body.messages.some(message=>message.role==='tool')
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{finish_reason:hasResult?'stop':'tool_calls',message:{role:'assistant',content:hasResult?'已核对来源':null,...(hasResult?{}:{tool_calls:[{id:randomUUID(),type:'function',function:{name:'web_search',arguments:JSON.stringify({query:'official docs'})}}]})}}]}))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
 const endpoint=`http://127.0.0.1:${server.address().port}`,previous=process.env.MYPLANE_WEB_SEARCH_ENDPOINT;process.env.MYPLANE_WEB_SEARCH_ENDPOINT=endpoint+'/search';t.after(()=>previous===undefined?delete process.env.MYPLANE_WEB_SEARCH_ENDPOINT:process.env.MYPLANE_WEB_SEARCH_ENDPOINT=previous)
 const service=new LocalAgentService(path.join(root,'tasks'),()=>({endpoint:endpoint+'/v1',key:'',maxTokens:1024,contextLength:16384}));t.after(()=>service.dispose())
 const project=service.createProject(workspace,'web');assert.equal(project.webAccess,'allow');assert.equal(project.webAllowSyntheticIp,true);service.updateProject({id:project.id,policy:'read-only',webAccess:'allow',webAllowSyntheticIp:true,autoWritePaths:[]});assert.equal(service.projects().find(item=>item.id===project.id).webAllowSyntheticIp,true)
 const allowed=service.start({projectId:project.id,mode:'coding',model:'fixture',prompt:'请联网搜索最新官方文档',maxSteps:4},1,()=>{});await until(()=>!service.active(allowed.id))
 const allowedEvent=service.get(allowed.id).events.find(event=>event.tool==='web_search');assert.equal(allowedEvent.status,'completed');assert.equal(allowedEvent.audit.authorization,'automatic');assert.equal(searches,1)
 service.updateProject({id:project.id,policy:'read-only',webAccess:'disabled',autoWritePaths:[]})
 const blocked=service.start({projectId:project.id,mode:'coding',model:'fixture',prompt:'请联网搜索最新官方文档',maxSteps:4},1,()=>{});await until(()=>!service.active(blocked.id))
 const blockedEvent=service.get(blocked.id).events.find(event=>event.tool==='web_search');assert.equal(blockedEvent.status,'failed');assert.match(blockedEvent.output,/WEB_ACCESS_DISABLED|禁止联网/);assert.equal(searches,1)
 service.updateProject({id:project.id,policy:'read-only',webAccess:'allow',autoWritePaths:[]});process.env.MYPLANE_WEB_SEARCH_ENDPOINT='http://127.0.0.1:1/search'
 const failed=service.start({projectId:project.id,mode:'coding',model:'fixture',prompt:'请联网搜索最新官方文档',maxSteps:4},1,()=>{});await until(()=>!service.active(failed.id))
 const failedEvent=service.get(failed.id).events.find(event=>event.tool==='web_search');assert.equal(failedEvent.status,'failed');assert.equal(failedEvent.execution.state,'failed');assert.notEqual(failedEvent.execution.failure?.kind,'unknown');assert.doesNotMatch(failedEvent.output,/无法确认全部副作用|结果未知/)
})

test('legacy web executions migrate out of unknown side-effect state',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-web-migration-')),workspace=path.join(root,'project'),directory=path.join(root,'tasks'),taskId=randomUUID(),eventId=randomUUID(),time=new Date().toISOString();fs.mkdirSync(workspace);fs.mkdirSync(directory);t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const execution={id:eventId,taskId,tool:'web_search',source:'builtin',argumentHash:'legacy',state:'unknown',effectful:true,expectedFiles:[],createdAt:time,updatedAt:time}
 fs.writeFileSync(path.join(directory,taskId+'.json'),JSON.stringify({id:taskId,title:'legacy web',workspace,mode:'coding',model:'fixture',status:'stopped',steps:1,maxSteps:4,plan:[],events:[{id:eventId,kind:'tool',tool:'web_search',text:'web_search',status:'failed',execution,createdAt:time}],artifacts:[],messages:[],error:'结果未知',createdAt:time,updatedAt:time}))
 new ExecutionJournal(directory).save(execution);const service=new LocalAgentService(directory,()=>{throw new Error('unused')});t.after(()=>service.dispose())
 const migrated=service.get(taskId).events[0].execution;assert.equal(migrated.effectful,false);assert.equal(migrated.state,'failed');assert.equal(new ExecutionJournal(directory).list(taskId)[0].state,'failed')
})
