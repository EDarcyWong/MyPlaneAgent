import {app,BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-agent-standalone-'))
process.env.MYPLANE_AGENT_DATA_DIR=root
const errors=[]
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)}))
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check,label){const end=Date.now()+15000;while(!await check()){if(Date.now()>end)throw new Error('Timed out: '+label+'\n'+errors.join('\n'));await delay(50)}}
async function main(){let code=0;try{
 await import('../dist-electron/main/index.js')
 await app.whenReady()
 await until(()=>BrowserWindow.getAllWindows().length,'window created')
 const win=BrowserWindow.getAllWindows()[0],js=source=>win.webContents.executeJavaScript(source,true)
 await until(()=>!win.webContents.isLoading()&&win.webContents.getURL().includes('index.html'),'production renderer loaded')
 await until(()=>js("!!document.querySelector('.agent-new')&&!document.querySelector('.agent-new').disabled"),'workspace ready')
 assert.equal(app.getName(),'MyPlaneAgent')
 assert.equal(app.getPath('userData'),root)
 assert.equal(win.webContents.getLastWebPreferences().sandbox,true)
 assert.deepEqual(await js('Object.keys(window.myplane).sort()'),['localAiStudio','onLocalAiAgentEvent','onLocalAiStudioEvent','openAiLink'])
 const bootstrap=await js("window.myplane.localAiStudio('bootstrap')")
 assert.equal(bootstrap.settings.runtimePort,8089)
 assert.ok(bootstrap.settings.downloadDirectory.startsWith(root))
 for(const label of ['我的模型','开发者','工具','设置','工作台']){
  await js(`document.querySelector('[aria-label="${label}"]').click()`)
 }
 await js(`document.querySelector('[aria-label="设置"]').click()`)
 await js("[...document.querySelectorAll('.preset-buttons button')].find(button=>button.textContent.includes('DeepSeek')).click()")
 assert.equal(await js("document.querySelector('input[type=url]').value"),'https://api.deepseek.com')
 assert.equal(await js("document.querySelector('input[list=settings-models]').value"),'deepseek-flash')
 assert.ok(await js("document.body.innerText.includes('保存并测试连接')"))
 await win.loadFile(path.resolve('dist/index.html'))
 await until(()=>js("!!document.querySelector('.agent-new')&&!document.querySelector('.agent-new').disabled"),'workspace restored after reload')
 const unauthorized=new BrowserWindow({show:false,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}})
 await unauthorized.loadFile(path.resolve('dist/index.html'))
 await assert.rejects(unauthorized.webContents.executeJavaScript("window.myplane.localAiStudio('bootstrap')"),/无权访问/)
 unauthorized.destroy()
 assert.deepEqual(errors,[])
 console.log('PASS: standalone production app, isolated profile, sandboxed preload, all sections, reload and IPC access boundary')
}catch(error){console.error(error);code=1}finally{
 for(const win of BrowserWindow.getAllWindows())win.destroy()
 // Exercise the actual application shutdown hook, which disposes AI processes.
 app.once('will-quit',()=>{fs.rmSync(root,{recursive:true,force:true});process.exitCode=code})
 app.quit()
}}
void main()
