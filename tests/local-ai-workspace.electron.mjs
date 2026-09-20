import {app,BrowserWindow,dialog,shell} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {LocalAiStudioService,registerLocalAiStudio} from '../dist-electron/main/local-ai-studio.js'
import {trackAuthWindow} from '../dist-electron/main/auth.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-workspace-')),workspace=path.join(root,'web')
fs.mkdirSync(workspace);app.setPath('userData',path.join(root,'profile'))
let win,service,server
const originalDialog=dialog.showOpenDialog,originalReveal=shell.showItemInFolder,requests=[],errors=[],revealed=[]
shell.showItemInFolder=target=>revealed.push(target)
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),js=source=>win.webContents.executeJavaScript(source,true)
async function until(check,label){const end=Date.now()+15000;while(!await check()){if(Date.now()>end){console.error(await js('document.body.innerText'));throw new Error('Timed out: '+label)}await delay(40)}}
const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`)
const mode=value=>js(`(()=>{const el=document.querySelector('[aria-label="工作模式"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
const fill=text=>js(`(()=>{const el=document.querySelector('textarea[aria-label="消息"]');el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
async function send(text){await fill(text);await until(()=>js("!document.querySelector('.send-button').disabled"),'send enabled');await js("document.querySelector('.composer').requestSubmit()")}
async function idle(){await until(()=>js("!!document.querySelector('.agent-new')&&!document.querySelector('.stop-button')&&!document.querySelector('.agent-new').disabled"),'idle')}
async function shot(name){await delay(350);fs.writeFileSync(path.join(root,name+'.png'),(await win.webContents.capturePage()).toPNG())}
async function main(){try{
 await app.whenReady()
 server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json')
  if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'local-workspace-model'}]}));return}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end('{}');return}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body)
  if(body.tools?.length&&!body.messages.some(message=>message.role==='tool')){
   res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:'根据前面的配色要求创建页面。',tool_calls:[{id:'write-page',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'index.html',content:'<!doctype html><title>蓝色页面</title><button>你好</button>'})}}]}}],usage:{prompt_tokens:40,completion_tokens:10,total_tokens:50}}));return
  }
  const content=body.tools?'页面已生成，保留了之前的蓝色配色要求。':'记住了蓝色配色，接下来可以继续讨论或执行。'
  res.setHeader('Content-Type','text/event-stream');res.flushHeaders()
  res.write('data: '+JSON.stringify({choices:[{delta:{content:content.slice(0,7)},finish_reason:null}]})+'\n\n')
  await delay(550)
  res.end('data: '+JSON.stringify({choices:[{delta:{content:content.slice(7)},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:40,completion_tokens:10,total_tokens:50}})+'\n\ndata: [DONE]\n\n')
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 service=new LocalAiStudioService(path.join(root,'data'));service.saveStudioSettings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'local-workspace-model',theme:'light',contextLength:16384})
 registerLocalAiStudio(()=>service,()=>service.dispose())
 win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)})
 trackAuthWindow(win.webContents,true,'http://127.0.0.1:5174');await win.loadURL('http://127.0.0.1:5174/tests/fixtures/local-ai-studio.html');await idle()
 assert.equal(await js("document.querySelectorAll('.composer').length"),1)
 assert.equal(await js("document.querySelectorAll('.rail-button[aria-label=聊天],.rail-button[aria-label=智能任务]').length"),0)
 await shot('welcome')
 await send('我想做一个蓝色的页面，先讨论方案。');await until(()=>requests.length===1,'first chat request');await idle()
 const first=service.sessions().find(item=>item.messageCount>0);assert.ok(first)
 assert.equal(requests[0].tools,undefined)
 await until(()=>js("document.querySelectorAll('.agent-task-item[data-kind=chat]').length===1"),'chat in sidebar')
 assert.equal(await js("document.querySelector('.agent-task-item').closest('.agent-project-group').dataset.projectId"),'')
 // A new project and mode change must not inherit the previous independent conversation.
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});await click('.agent-create-project')
 await until(()=>js("!!document.querySelector('.el-message-box__input input')"),'project dialog');await click('.el-message-box__btns .el-button--primary');await idle()
 assert.equal(await js("!!document.querySelector('.agent-welcome')"),true)
 await mode('chat');await idle();assert.equal(await js("document.querySelectorAll('.message').length"),0)
 await send('这是一段独立的项目聊天');await until(()=>requests.length===2,'project chat request');await idle()
 const [project]=await js("window.myplane.localAiStudio('agentProjects')")
 assert.equal(service.sessions().find(item=>item.id!==first.id&&item.messageCount>0).projectId,project.id)
 assert.equal(requests[1].messages.some(item=>String(item.content).includes('蓝色')),false)
 // Open the earlier chat, bind it to the project, and convert it without losing history.
 await js("[...document.querySelectorAll('.agent-task-item')].find(item=>item.title.includes('蓝色')).click()");await idle()
 await click('.agent-workspace-picker');await idle()
 assert.equal(service.session(first.id).projectId,project.id)
 await fill('按照刚才的方案新建页面');await mode('coding');await click('.send-button')
 await until(()=>js("!!document.querySelector('.agent-approval')"),'write approval')
 assert.equal(fs.existsSync(path.join(workspace,'index.html')),false)
 assert.ok(requests[2].messages.some(item=>String(item.content).includes('蓝色的页面')))
 assert.ok(requests[2].messages.some(item=>item.role==='assistant'&&String(item.content).includes('记住了')))
 assert.equal(await js("document.querySelectorAll('.agent-event.user').length"),2)
 await shot('review');await click('.agent-approval .agent-primary');await idle()
 const [task]=await js("window.myplane.localAiStudio('agentTasks')");assert.equal(task.sourceSessionId,first.id);assert.equal(task.projectId,project.id)
 assert.equal(service.session(first.id).messages.length,2,'original chat is retained')
 assert.equal(await js("document.querySelectorAll('.agent-task-item').length"),2,'converted chat is listed once')
 assert.equal(await js("document.querySelectorAll('.agent-task-item[data-kind=chat]').length"),1)
 assert.match(fs.readFileSync(path.join(workspace,'index.html'),'utf8'),/蓝色页面/)
 assert.match(await js("document.querySelector('.agent-composer-hint .token-usage').innerText"),/150/)
 await shot('conversation')
 // Discussion after execution remains in the same task, streams text, and cannot call tools.
 await mode('chat');await send('解释一下这个页面，不要改文件。')
 await until(()=>requests.length===5,'task chat request')
 await until(()=>js("!!document.querySelector('.agent-event.assistant.running')"),'streamed task chat')
 assert.equal(requests[4].tools,undefined)
 assert.ok(requests[4].messages.some(item=>item.role==='tool'))
 await idle();assert.equal((await js("window.myplane.localAiStudio('agentTasks')")).length,1)
 assert.equal((await js("window.myplane.localAiStudio('agentTasks')"))[0].id,task.id)
 await mode('coding');await send('继续核对刚才的结果');await until(()=>requests.length===6,'task coding request');await idle()
 assert.ok(requests[5].tools?.length);assert.ok(requests[5].messages.some(item=>String(item.content).includes('不要改文件')))
 await win.reload();await until(()=>js("!!document.querySelector('.agent-status.completed')"),'restored task')
 assert.equal(await js("document.querySelector('.agent-task-item.selected').dataset.kind"),'agent')
 // Starting an independent conversation cannot retain the previous project binding.
 await click('.agent-all-projects');await idle();assert.equal(await js("document.querySelector('[aria-label=工作模式]').value"),'chat')
 assert.equal(await js("!!document.querySelector('.agent-welcome')"),true)
 await send('独立的问题');await until(()=>requests.length===7,'independent question');await idle()
 const independent=service.sessions().find(item=>item.title==='独立的问题');assert.equal(independent.projectId,undefined)
 assert.equal(requests[6].messages.some(item=>String(item.content).includes('蓝色')),false)
 await win.reload();await until(()=>js("document.querySelector('.workspace-heading>strong')?.textContent==='独立的问题'"),'restore chat')
 assert.equal(await js("document.querySelectorAll('.composer').length"),1)
 await js("(()=>{const el=document.querySelector('[aria-label=搜索会话]');el.value='蓝色';el.dispatchEvent(new Event('input',{bubbles:true}))})()")
 assert.equal(await js("document.querySelectorAll('.agent-task-item').length"),1)
 await click('[aria-label=清除搜索]')
 // Project row actions act on their own project without replacing the current conversation.
 const group='[data-project-id="'+project.id+'"]'
 await click(group+' .project-more');await until(()=>js("!!document.querySelector('.agent-project-popup:not([style*=\"display: none\"])')"),'project popup')
 assert.equal(await js("document.querySelector('.workspace-heading>strong').textContent"),'独立的问题')
 await js("[...document.querySelectorAll('.agent-project-popup [role=menuitem]')].find(el=>el.textContent.trim()==='置顶').click()")
 await until(async()=> (await js("window.myplane.localAiStudio('agentProjects')"))[0].pinned===true,'pin persisted')
 await click(group+' .project-more');await js("[...document.querySelectorAll('.agent-project-popup [role=menuitem]')].find(el=>el.textContent.includes('编辑项目')).click()")
 await until(()=>js("!!document.querySelector('.el-message-box__input input')"),'rename project');await js("(()=>{const el=document.querySelector('.el-message-box__input input');el.value='web-renamed';el.dispatchEvent(new Event('input',{bubbles:true}))})()");await click('.el-message-box__btns .el-button--primary')
 await until(()=>js("document.querySelector('.agent-project-item').textContent.includes('web-renamed')"),'renamed project')
 await click(group+' .project-more');await shot('project-menu');await js("[...document.querySelectorAll('.agent-project-popup [role=menuitem]')].find(el=>el.textContent.includes('Finder')||el.textContent.includes('文件管理器')).click()");await until(()=>revealed.length===1,'reveal project');assert.equal(revealed[0],fs.realpathSync(workspace))
 await click(group+' .project-new-chat');await idle();assert.equal(await js("!!document.querySelector('.agent-welcome')"),true);assert.equal(await js("document.querySelector('.agent-workspace-picker').textContent.includes('web-renamed')"),true);assert.equal(await js("document.querySelector('textarea[aria-label=消息]').value"),'');assert.equal(service.session(independent.id).messages.length,2)
 await win.reload();await idle();const restoredProject=(await js("window.myplane.localAiStudio('agentProjects')"))[0];assert.equal(restoredProject.name,'web-renamed');assert.equal(restoredProject.pinned,true)
 for(const [width,height] of [[520,640],[760,720],[1280,900]]){
  win.setContentSize(width,height);await delay(150)
  assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"),true)
  assert.equal(await js("document.querySelector('.composer').getBoundingClientRect().bottom<innerHeight"),true)
  if(width===520){await shot('narrow');await click('.agent-history-toggle');await shot('narrow-sidebar');await click(group+' .project-more');await delay(350);assert.equal(await js("(()=>{const rect=document.querySelector('.agent-project-popup').getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth})()"),true);await click('.workspace-search input');await click('.agent-history-close')}
 }
 await click('[aria-label=设置]');await js("(()=>{const el=[...document.querySelectorAll('.settings-page select')].find(el=>[...el.options].some(option=>option.value==='dark'));el.value='dark';el.dispatchEvent(new Event('change',{bubbles:true}))})()");await click('[aria-label=工作台]');await shot('dark')
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({ok:true,requests:requests.length,screenshots:root,checks:['one workspace and composer','independent and project chats','no cross-conversation context leak','chat to task imports full history','write approval','original session retained and deduplicated in sidebar','chat mode tools disabled and streamed','coding continuation preserves conversation','token totals across conversion','chat/task restart restoration','search','responsive and dark layout','project row new conversation','project pin/rename persistence','project popup and Finder reveal']}))
}catch(error){console.error(error);process.exitCode=1}finally{dialog.showOpenDialog=originalDialog;shell.showItemInFolder=originalReveal;win?.destroy();service?.dispose();if(server){server.closeAllConnections();server.close()}app.exit(process.exitCode||0)}}
void main()
