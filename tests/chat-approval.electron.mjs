import {app,BrowserWindow} from 'electron'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {LocalAiStudioService,registerLocalAiStudio} from '../dist-electron/main/local-ai-studio.js'
import {trackAuthWindow} from '../dist-electron/main/auth.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'approval-ui-'))
app.setPath('userData',path.join(root,'profile'))
app.disableHardwareAcceleration()
const delay=ms=>new Promise(r=>setTimeout(r,ms))
async function main(){
 await app.whenReady()
 const deadline=setTimeout(()=>{console.error('approval test timeout');app.exit(1)},30000)
 let win,service,server
 try{
 server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'fixture-model'}]}))});await new Promise(r=>server.listen(0,'127.0.0.1',r))
 service=new LocalAiStudioService(path.join(root,'data'))
 service.saveStudioSettings({source:'external',endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture-model'})
 registerLocalAiStudio(()=>service,()=>service.dispose())
 let completed=0,sessionId
 service.generate=async(session,_service,_settings,_signal,emit,requestId,_compact,options)=>{
   sessionId=session.id
   for(let i=0;i<2;i++){
    const activity={id:'operation-'+i,capability:'agent.run_command',args:{command:'echo '+i},status:'waiting'}
    if(options.getApprovalMode()!=='full')assert.equal(await options.approve(activity),true)
   }
   service.saveSession(session)
   emit({type:'finished',requestId,session})
   completed++
 }
 win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}})
 win.webContents.on('console-message',details=>console.log(details.message))
 trackAuthWindow(win.webContents,true)
 await win.loadFile(path.resolve('dist/index.html'))
 const evaluate=code=>win.webContents.executeJavaScript(code,true)
 async function until(check){for(let i=0;i<200;i++){if(await check())return;await delay(30)}throw Error('UI timeout')}
 await until(()=>evaluate("!!document.querySelector('.chat-workbench')"))
 await evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="消息"]');input.value='测试';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 await until(()=>evaluate("!!document.querySelector('.send-button:not(:disabled)')"))
 await evaluate("document.querySelector('.send-button').click()")
 await until(()=>evaluate("!!document.querySelector('.approval-button summary')"))
 async function click(selector){const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await delay(100)}
 await click('.approval-button summary')
 await click('.approval-menu button:last-child')
 await until(()=>completed)
 assert.equal(service.session(sessionId).approvalMode,'full')
 await evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="消息"]');input.value='继续';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 await until(()=>evaluate("!!document.querySelector('.send-button:not(:disabled)')"))
 await evaluate("document.querySelector('.send-button').click()")
 await until(()=>completed===2)
 assert.equal(service.session(sessionId).approvalMode,'full')
 assert.equal(await evaluate("!!document.querySelector('.chat-approval')"),false)
 await service.dispose()
 service=new LocalAiStudioService(path.join(root,'data'))
 assert.equal(service.session(sessionId).approvalMode,'full')
 console.log('PASS real mouse full approval, subsequent operation and session persistence')
 }catch(e){console.error(e);process.exitCode=1}finally{clearTimeout(deadline);win?.destroy();await service?.dispose();server?.close();app.exit(process.exitCode||0)}
}
void main()

