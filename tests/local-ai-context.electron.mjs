import {app,BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {LocalAiStudioService,registerLocalAiStudio} from '../dist-electron/main/local-ai-studio.js'
import {trackAuthWindow} from '../dist-electron/main/auth.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-context-ui-'))
app.setPath('userData',path.join(root,'profile'))
let win,server,service,failSummary=false,slowSummary=false,rejectMain=false,truncateSummary=true
const requests=[],errors=[],delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),js=source=>win.webContents.executeJavaScript(source,true)
async function until(check,label){const end=Date.now()+20000;while(!await check()){if(Date.now()>end)throw new Error('Timed out: '+label);await delay(30)}}
const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`)
const sessionFile=id=>path.join(root,'data','local-ai-sessions',id+'.json')
const history=()=>Array.from({length:12},(_,i)=>({id:randomUUID(),role:i%2?'assistant':'user',content:`第 ${i} 轮：`+'项目分析结果，保留用户数据。'.repeat(100),createdAt:new Date().toISOString()}))
async function send(text){await js(`(()=>{const el=document.querySelector('textarea[aria-label=消息]');el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.composer').requestSubmit()})()`);await until(()=>js("!document.querySelector('.stop-button')"),'chat finished')}
async function openChat(id){await js(`window.myplane.localAiStudio('updateSession',{id:${JSON.stringify(id)},title:'上下文测试'})`);await js(`localStorage.setItem('myplane.local-ai.workspace.selection',JSON.stringify({kind:'chat',id:${JSON.stringify(id)}}))`);await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await until(()=>js("!!document.querySelector('.unified-workspace .context-usage')"),'loaded');await click('.rail-button[aria-label=工作台]');await until(()=>js("!!document.querySelector('.composer')"),'chat visible')}
async function main(){try{
 await app.whenReady()
 server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json')
  if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'context-fixture'}]}));return}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end('{}');return}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body)
  const summary=body.messages[0]?.content?.includes('你负责压缩历史对话')
  if(summary&&slowSummary)await delay(800)
  if(summary&&truncateSummary){truncateSummary=false;res.end(JSON.stringify({choices:[{finish_reason:'length',message:{content:'未完成摘要'}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}));return}
  if(summary&&failSummary){res.writeHead(500);res.end('summary unavailable');return}
  if(!summary&&rejectMain){rejectMain=false;res.writeHead(400);res.end('maximum context length exceeded');return}
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:summary?'目标：完善项目，保留用户数据。已分析文件，未部署。下一步验证修改。':'已根据进度继续。'}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}))
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 service=new LocalAiStudioService(path.join(root,'data'));service.saveStudioSettings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'context-fixture',contextLength:8192,maxTokens:1024})
 const session=service.newSession();session.messages=history();fs.writeFileSync(sessionFile(session.id),JSON.stringify(session))
 registerLocalAiStudio(()=>service,()=>service.dispose())
 win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});trackAuthWindow(win.webContents,true,'http://127.0.0.1:5174')
 await win.loadURL('http://127.0.0.1:5174/tests/fixtures/local-ai-studio.html');await until(()=>js("!!document.querySelector('.unified-workspace .context-usage')"),'ready');await click('.rail-button[aria-label=工作台]')
 assert.match(await js("document.querySelector('.unified-workspace .context-usage').textContent"),/上下文约/)
 await send('继续验证，不要部署')
 let saved=service.session(session.id)
 assert.ok(requests[1].max_tokens>requests[0].max_tokens);assert.ok(requests[1].max_tokens<=1024);assert.doesNotMatch(saved.checkpoint.summary,/未完成摘要/);assert.ok(saved.checkpoint);assert.equal(saved.messages.length,14);assert.deepEqual(saved.messages.slice(0,12),session.messages)
 assert.match(JSON.stringify(requests.at(-1).messages),/历史对话的进度摘要/);assert.equal(requests.at(-1).messages.at(-1).content,'继续验证，不要部署')
 assert.equal(saved.usage.requests,requests.length,'summary usage included');assert.equal(saved.usage.totalTokens,requests.length*120)
 const checkpoint=structuredClone(saved.checkpoint)
 await openChat(session.id);assert.deepEqual(service.session(session.id).checkpoint,checkpoint)
 // Manual compression is visible, does not add a conversational message, and persists.
 await click('.unified-workspace .context-usage>button');await until(()=>js("!document.querySelector('.stop-button')"),'manual complete')
 saved=service.session(session.id);assert.equal(saved.messages.length,14);assert.ok(saved.checkpoint.compactions>checkpoint.compactions)
 await click('.unified-workspace .context-usage summary');await delay(100);fs.writeFileSync(path.join(root,'chat-context.png'),(await win.webContents.capturePage()).toPNG())
 // Failed manual compaction must preserve the previous checkpoint and full archive.
 saved.messages.push(...history().slice(0,4));fs.writeFileSync(sessionFile(saved.id),JSON.stringify(saved));await openChat(saved.id)
 failSummary=true;const before=service.session(saved.id);await click('.unified-workspace .context-usage>button');await until(()=>js("!document.querySelector('.stop-button')"),'failed summary')
 assert.deepEqual(service.session(saved.id).checkpoint,before.checkpoint);assert.deepEqual(service.session(saved.id).messages,before.messages)
 failSummary=false;slowSummary=true;const startCount=requests.length
 await click('.unified-workspace .context-usage>button');await until(()=>requests.length>startCount,'summary started');await click('.stop-button');await until(()=>js("!document.querySelector('.stop-button')"),'summary cancelled')
 assert.deepEqual(service.session(saved.id).checkpoint,before.checkpoint);assert.deepEqual(service.session(saved.id).messages,before.messages);slowSummary=false
 // Provider overflow triggers one stronger compaction and one retry before any output.
 const retrySession=service.newSession();retrySession.messages=history().slice(0,4).map(message=>({...message,content:message.content.slice(0,500)}));fs.writeFileSync(sessionFile(retrySession.id),JSON.stringify(retrySession));await openChat(retrySession.id)
 rejectMain=true;const retryFrom=requests.length;await send('继续工作');const retryRequests=requests.slice(retryFrom)
 assert.equal(retryRequests.filter(body=>!body.messages[0]?.content?.includes('你负责压缩历史对话')).length,2)
 assert.equal(service.session(retrySession.id).messages.at(-1).status,'complete');assert.ok(service.session(retrySession.id).checkpoint)
 // Agent has a larger tool schema. Keep room for the complete latest user message,
 // which compaction intentionally never discards.
 service.saveStudioSettings({contextLength:16384})
 // Agent manual control uses the same UI and preserves task history.
 const folder=path.join(root,'web');fs.mkdirSync(folder);const id=randomUUID(),time=new Date().toISOString(),events=[{id:randomUUID(),kind:'user',text:'完善 web 项目',createdAt:time}]
 fs.mkdirSync(path.join(root,'data','local-ai-agent-tasks'),{recursive:true});fs.writeFileSync(path.join(root,'data','local-ai-agent-tasks',id+'.json'),JSON.stringify({id,title:'上下文任务',workspace:fs.realpathSync(folder),mode:'coding',model:'context-fixture',status:'completed',steps:1,maxSteps:20,plan:[],events,artifacts:[],messages:history().map(({role,content})=>({role,content})),createdAt:time,updatedAt:time,error:''}))
 await js(`localStorage.setItem('myplane.local-ai.workspace.selection',JSON.stringify({kind:'agent',id:${JSON.stringify(id)}}))`);await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await until(()=>js("document.querySelector('.workspace-heading>strong')?.textContent==='上下文任务'"),'agent restored')
 truncateSummary=true;const agentSummaryStart=requests.length
 await click('.agent-workspace .context-usage>button');await until(()=>js("document.querySelector('.agent-workspace .context-saved')?.textContent.includes('已压缩')&&!document.querySelector('.agent-workspace .context-usage>button').disabled"),'agent compressed')
 const task=await js(`window.myplane.localAiStudio('agentTask',{id:${JSON.stringify(id)}})`);assert.deepEqual(task.events,events);assert.ok(task.checkpoint);assert.ok(requests[agentSummaryStart+1].max_tokens>requests[agentSummaryStart].max_tokens);assert.doesNotMatch(task.checkpoint.summary,/未完成摘要/);assert.equal(task.usage.totalTokens,(requests.length-agentSummaryStart)*120)
 for(const width of [520,760,1280]){win.setContentSize(width,800);await delay(100);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true)}
 await click('.agent-workspace .context-usage summary');fs.writeFileSync(path.join(root,'agent-context.png'),(await win.webContents.capturePage()).toPNG())
 // The Agent request must honor configured output limits above the former hidden 8192 cap.
 service.saveStudioSettings({contextLength:32768,maxTokens:10000})
 await js(`window.myplane.localAiStudio('agentStart',{taskId:${JSON.stringify(id)},mode:'coding',model:'context-fixture',prompt:'总结当前进展',maxSteps:10})`)
 await until(async()=>!['running','waiting'].includes((await js(`window.myplane.localAiStudio('agentTask',{id:${JSON.stringify(id)}})`)).status),'agent output configuration')
 assert.equal(requests.at(-1).max_tokens,10000)
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({ok:true,checks:['truncated summary recovery for chat and agent IPC','automatic chat compaction','manual compaction UI','archive and checkpoint persistence','summary usage accounting','failure rollback','stop during summary','provider overflow retry','manual agent compression','responsive context controls'],screenshots:root}))
}catch(error){console.error(error);if(win)console.error(await js('document.body.innerText.slice(-2500)').catch(()=>''));process.exitCode=1}finally{win?.destroy();service?.dispose();if(server){server.closeAllConnections();server.close()}app.exit(process.exitCode||0)}}
void main()
