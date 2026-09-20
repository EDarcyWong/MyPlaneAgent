import {app,BrowserWindow} from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {LocalAiStudioService,registerLocalAiStudio} from '../dist-electron/main/local-ai-studio.js'
import {trackAuthWindow} from '../dist-electron/main/auth.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-queue-ui-')),workspace=path.join(root,'project'),directory=path.join(root,'data','local-ai-agent-tasks')
fs.mkdirSync(workspace);fs.mkdirSync(directory,{recursive:true});app.setPath('userData',path.join(root,'profile'))
const id=randomUUID(),time=new Date().toISOString(),base=process.env.TEST_VITE_URL||'http://127.0.0.1:5199'
fs.writeFileSync(path.join(directory,id+'.json'),JSON.stringify({id,title:'队列测试',workspace,mode:'coding',model:'fixture',status:'completed',steps:0,maxSteps:10,plan:[],artifacts:[],error:'',createdAt:time,updatedAt:time,messages:[],events:[]}))
let win,service,server
const requests=[],pending=[],pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),js=source=>win.webContents.executeJavaScript(source,true)
async function until(check){for(let i=0;i<400;i++){if(await check())return;await pause(25)}throw new Error('Timed out: '+await js('document.body.innerText'))}
async function draft(text){await js(`(()=>{const el=document.querySelector('.agent-prompt textarea');el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
async function send(text){await draft(text);await js("document.querySelector('.agent-prompt').requestSubmit()");await pause(50)}
function finish(){const response=pending.shift();assert.ok(response);response.setHeader('Content-Type','text/event-stream');response.end('data: '+JSON.stringify({choices:[{delta:{content:'完成'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')}
async function run(){try{
 await app.whenReady()
 server=createServer(async(req,res)=>{
  if(!req.url.includes('chat/completions')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture'}]}));return}
  let raw='';for await(const chunk of req)raw+=chunk
  const body=JSON.parse(raw);requests.push(body.messages.findLast(message=>message.role==='user').content);pending.push(res)
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 service=new LocalAiStudioService(path.join(root,'data'));service.saveStudioSettings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',contextLength:16384})
 registerLocalAiStudio(()=>service,()=>service.dispose())
 win=new BrowserWindow({width:1100,height:800,show:false,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
 trackAuthWindow(win.webContents,true,base);await win.loadURL(base+'/tests/fixtures/local-ai-studio.html')
 await until(()=>js("!!document.querySelector('.agent-task-item[data-kind=agent]')"));await js("document.querySelector('.agent-task-item[data-kind=agent]').click()")
 await until(()=>js("!document.querySelector('.agent-prompt textarea').disabled"))
 await send('第一项');await until(()=>requests.length===1)
 assert.equal(await js("document.querySelector('.agent-prompt textarea').disabled"),false)
 await send('第二项待编辑');await send('移除项');await send('第三项')
 await js("document.querySelector('[aria-label=\"移除待执行任务 2\"]').click()")
 await js("document.querySelector('.queue-menu>button').click()")
 await pause(300)
 fs.writeFileSync(path.join(root,'queue-wide.png'),(await win.webContents.capturePage()).toPNG())
 await js("[...document.querySelectorAll('.el-dropdown-menu__item')].find(el=>el.textContent.includes('编辑消息')).click()")
 await until(()=>js("!!document.querySelector('.el-message-box textarea')"))
 await js("(()=>{const el=document.querySelector('.el-message-box textarea');el.value='第二项';el.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.el-message-box__btns .el-button--primary').click()})()")
 await until(()=>js("!document.querySelector('.el-overlay-message-box')||document.querySelector('.el-overlay-message-box').offsetParent===null"))
 win.setContentSize(520,720);await pause(150)
 await js("document.querySelector('.queue-menu>button').click()");await pause(300)
 assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true)
 fs.writeFileSync(path.join(root,'queue-narrow.png'),(await win.webContents.capturePage()).toPNG())
 win.setContentSize(1100,800);await js("document.querySelector('.agent-prompt textarea').click()")
 await draft('未发送草稿');assert.equal(requests.length,1)
 assert.equal(await js("document.querySelectorAll('.agent-message-queue li').length"),2)
 finish();await until(()=>requests.length===2);assert.equal(requests[1],'第二项')
 assert.equal(await js("document.querySelector('.agent-prompt textarea').value"),'未发送草稿')
 finish();await until(()=>requests.length===3);assert.equal(requests[2],'第三项')
 finish();await until(()=>js("!document.querySelector('.stop-button')"))
 await send('停止当前项');await until(()=>requests.length===4);await send('保留排队项');await send('继续后的下一项')
 await js("document.querySelector('.stop-button').click()");await until(()=>js("document.querySelector('.agent-message-queue').innerText.includes('已暂停')"))
 await until(()=>js("!document.querySelector('.stop-button')"));await pause(100);assert.equal(requests.length,4);pending.shift()
 await js("document.querySelector('.agent-all-projects').click()")
 await until(()=>js("!document.querySelector('.agent-message-queue')"))
 await send('聊天第一项');await until(()=>requests.length===5);await send('聊天第二项');await draft('聊天草稿')
 finish();await until(()=>requests.length===6);assert.equal(requests[5],'聊天第二项')
 assert.equal(await js("document.querySelector('.agent-prompt textarea').value"),'聊天草稿')
 finish();await until(()=>js("!document.querySelector('.stop-button')"))
 await js("document.querySelector('.agent-task-item[data-kind=agent]').click()")
 await until(()=>js("document.querySelector('.agent-message-queue')?.innerText.includes('保留排队项')"))
 assert.equal(requests.length,6)
 await js("document.querySelector('.agent-message-queue header button').click()")
 await until(()=>requests.length===7);assert.equal(requests[6],'保留排队项');finish()
 await until(()=>requests.length===8);assert.equal(requests[7],'继续后的下一项');finish()
 await until(()=>js("!document.querySelector('.stop-button')"))
 await send('调整前的任务');await until(()=>requests.length===9)
 await send('新的方向，只分析');await send('保留为下一项')
 await js("document.querySelector('.queue-steer').click()")
 await until(()=>requests.length===10)
 assert.match(requests[9],/新的方向，只分析/)
 assert.equal(await js("document.querySelectorAll('.agent-message-queue li').length"),1)
 pending.shift();finish();await until(()=>requests.length===11);assert.equal(requests[10],'保留为下一项');finish()
 await until(()=>js("!document.querySelector('.stop-button')"))
 await send('服务失败项');await until(()=>requests.length===12);await send('失败后保留项')
 const failed=pending.shift();failed.writeHead(400,{'Content-Type':'application/json'});failed.end(JSON.stringify({error:{message:'fixture failure'}}))
 await until(()=>js("document.querySelector('.agent-message-queue')?.innerText.includes('排队已暂停')"))
 await pause(100);assert.equal(requests.length,12)
 console.log(JSON.stringify({ok:true,artifacts:root,checks:['agent FIFO','remove pending item','draft preservation','stop pauses queue','conversation isolation','chat FIFO','resume queue']}))
}catch(error){console.error(error);process.exitCode=1}finally{win?.destroy();service?.dispose();server?.closeAllConnections();server?.close();app.exit(process.exitCode||0)}}
void run()
