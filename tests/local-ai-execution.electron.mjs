import {app,BrowserWindow,dialog} from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {LocalAiStudioService,registerLocalAiStudio} from '../dist-electron/main/local-ai-studio.js'
import {trackAuthWindow} from '../dist-electron/main/auth.js'
import {ExecutionJournal} from '../dist-electron/main/agent/execution-journal.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-execution-ui-')),workspace=path.join(root,'project'),directory=path.join(root,'data','local-ai-agent-tasks')
fs.mkdirSync(workspace);fs.mkdirSync(directory,{recursive:true});app.setPath('userData',path.join(root,'profile'))
const id=randomUUID(),eventId=randomUUID(),time=new Date().toISOString()
fs.writeFileSync(path.join(directory,id+'.json'),JSON.stringify({id,title:'核对中断命令',workspace,mode:'coding',model:'fixture',status:'running',steps:1,maxSteps:10,plan:[],artifacts:[],error:'',createdAt:time,updatedAt:time,messages:[{role:'user',content:'检查项目'}],events:[{id:randomUUID(),kind:'user',text:'检查项目',createdAt:time},{id:eventId,kind:'tool',tool:'run_command',text:'run_command',args:{command:'echo done'},status:'running',createdAt:time}]}))
new ExecutionJournal(directory).save({id:eventId,taskId:id,tool:'run_command',source:'builtin',argumentHash:'fixture',state:'running',effectful:true,expectedFiles:[],createdAt:time,updatedAt:time})
const originalDialog=dialog.showMessageBox,base=process.env.TEST_VITE_URL||'http://127.0.0.1:5199'
let win,service,server,confirm=false,dialogs=0
dialog.showMessageBox=async()=>{dialogs++;return {response:confirm?1:0,checkboxChecked:false}}
const js=source=>win.webContents.executeJavaScript(source,true),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check){for(let i=0;i<500;i++){if(await check())return;await pause(30)}throw new Error('Timed out: '+await js('document.body.innerText'))}
async function run(){try{
 await app.whenReady()
 server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture'}]}))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 service=new LocalAiStudioService(path.join(root,'data'));service.saveStudioSettings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',contextLength:16384})
 registerLocalAiStudio(()=>service,()=>service.dispose())
 win=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
 trackAuthWindow(win.webContents,true,base);await win.loadURL(base+'/tests/fixtures/local-ai-studio.html')
 await until(()=>js("!!document.querySelector('.agent-task-item')"));await js("document.querySelector('.agent-task-item').click()")
 await until(()=>js("document.body.innerText.includes('这些步骤的执行结果需要核对')"))
 assert.equal(await js(`window.myplane.localAiStudio('agentTask',{id:${JSON.stringify(id)}}).then(task=>task.events.at(-1).execution.state)`),'unknown')
 fs.writeFileSync(path.join(root,'recovery-wide.png'),(await win.webContents.capturePage()).toPNG())
 const click=()=>js("[...document.querySelectorAll('button')].find(button=>button.textContent==='已核对完成').click()")
 await click();await until(()=>dialogs===1);await pause(100)
 assert.equal(await js(`window.myplane.localAiStudio('agentTask',{id:${JSON.stringify(id)}}).then(task=>task.events.at(-1).execution.state)`),'unknown','cancelled native confirmation must not resolve operation')
 win.setContentSize(520,720);await pause(150)
 assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true)
 assert.equal(await js("(()=>{const panel=document.querySelector('.agent-recovery');return panel.scrollWidth<=panel.clientWidth&&[...panel.querySelectorAll('button')].every(button=>button.getBoundingClientRect().right<=panel.getBoundingClientRect().right)})()"),true)
 fs.writeFileSync(path.join(root,'recovery-narrow.png'),(await win.webContents.capturePage()).toPNG())
 confirm=true;await click();await until(()=>dialogs===2);await until(()=>js("!document.body.innerText.includes('这些步骤的执行结果需要核对')"))
 const task=await js(`window.myplane.localAiStudio('agentTask',{id:${JSON.stringify(id)}})`)
 assert.equal(task.events.at(-1).execution.resolution.by,'user');assert.equal(task.events.at(-1).execution.verification.status,'unverified')
 assert.deepEqual(fs.readdirSync(workspace),[],'resolving a record must not execute its command')
 console.log(JSON.stringify({ok:true,artifacts:root,checks:['restart shows unknown operation','native confirmation cancellation preserves state','explicit resolution persists without execution','manual resolution is not automatic verification','narrow layout']}))
}catch(error){console.error(error);process.exitCode=1}finally{dialog.showMessageBox=originalDialog;win?.destroy();service?.dispose();server?.closeAllConnections();server?.close();app.exit(process.exitCode||0)}}
void run()
