import {app,BrowserWindow,clipboard,nativeImage,dialog} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {LocalAiStudioService,registerLocalAiStudio} from '../dist-electron/main/local-ai-studio.js'
import {trackAuthWindow} from '../dist-electron/main/auth.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-ai-images-'))
app.setPath('userData',path.join(root,'profile'))
let win,server,service,previousClipboard
const requests=[],errors=[]
const js=source=>win.webContents.executeJavaScript(source,true)
async function until(check,label){const end=Date.now()+15000;while(!await check()){if(Date.now()>end){console.error(await js("({text:document.body.innerText.slice(0,2000),paste:window.lastTestPaste})"));throw new Error('Timed out: '+label)};await new Promise(resolve=>setTimeout(resolve,50))}}
async function count(selector,n){await until(()=>js(`document.querySelectorAll(${JSON.stringify(selector)}).length===${n}`),`${selector}: ${n}`)}
async function click(selector){await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function pasteImage(){await until(()=>js("!!document.querySelector('textarea[aria-label=消息]')&&!document.querySelector('textarea[aria-label=消息]').disabled"),'composer ready');clipboard.writeImage(nativeImage.createFromBitmap(Buffer.alloc(80*60*4,180),{width:80,height:60}));await js("document.querySelector('textarea[aria-label=消息]').focus()");win.webContents.paste();await count('.composer-images img',1);await until(()=>js("!document.querySelector('.send-button').disabled"),'image ready')}
async function send(){await js("document.querySelector('.composer').requestSubmit()");await until(()=>js("!document.querySelector('.stop-button')&&document.querySelectorAll('.message.assistant').length>0"),'reply completed')}
async function main(){try{
 await app.whenReady()
 previousClipboard=clipboard.availableFormats().map(format=>({format,data:clipboard.readBuffer(format)}))
 server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json')
  if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'vision-test'}]}));return}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end('{}');return}
  let body='';for await(const chunk of req)body+=chunk
  requests.push(JSON.parse(body));res.end(JSON.stringify({choices:[{message:{content:'已收到图片'}}]}))
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 service=new LocalAiStudioService(path.join(root,'data'))
 service.saveStudioSettings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'vision-test',contextLength:16384})
 registerLocalAiStudio(()=>service,()=>service.dispose())
 win=new BrowserWindow({width:1100,height:800,show:false,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
 win.webContents.on('render-process-gone',(_event,details)=>errors.push(details))
 trackAuthWindow(win.webContents,true,'http://127.0.0.1:5174')
 await win.loadURL('http://127.0.0.1:5174/tests/fixtures/local-ai-studio.html')
 await until(()=>js("!!document.querySelector('.rail-button[aria-label=工作台]')"),'chat navigation');await click('.rail-button[aria-label=工作台]');await count('.composer',1)
 await js("document.addEventListener('paste',event=>{window.lastTestPaste={types:[...event.clipboardData.types],items:[...event.clipboardData.items].map(item=>({kind:item.kind,type:item.type})),prevented:event.defaultPrevented}})")
 // Native clipboard text retains the normal textarea insertion behavior.
 clipboard.writeText('原有文字');await js("document.querySelector('textarea[aria-label=消息]').focus()");win.webContents.paste()
 await until(()=>js("document.querySelector('textarea[aria-label=消息]').value==='原有文字'"),'plain text paste')
 await pasteImage()
 assert.equal(await js("document.querySelector('textarea[aria-label=消息]').value"),'原有文字')
 await click('[aria-label="移除图片 1"]');await count('.composer-images img',0)
 await js("const el=document.querySelector('textarea[aria-label=消息]');el.value='';el.dispatchEvent(new Event('input',{bubbles:true}))")
 await pasteImage()
 const preview=await js("document.querySelector('.composer-images img').src")
 await send();await count('.message-images img',1);await count('.composer-images img',0)
 assert.deepEqual(requests[0].messages.at(-1).content,[{type:'image_url',image_url:{url:preview}}])
 const id=service.sessions()[0].id
 assert.equal(service.session(id).messages[0].images[0].dataUrl,preview)
 assert.equal(service.session(id).messages[0].content,'')
 // Regeneration retains the original image even when the composer is empty.
 await js("[...document.querySelectorAll('.message-actions button')].find(button=>button.textContent.includes('重新生成')).click()")
 await until(()=>requests.length===2,'regenerated request');await until(()=>js("!document.querySelector('.stop-button')"),'regeneration complete')
 assert.deepEqual(requests[1].messages.at(-1).content,requests[0].messages.at(-1).content)
 assert.equal(service.session(id).messages.length,2)
 // Reopening from disk restores the visible attachment.
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await until(()=>js("!!document.querySelector('.rail-button[aria-label=工作台]')"),'chat navigation');await click('.rail-button[aria-label=工作台]');await count('.message-images img',1)
 assert.equal(await js("document.querySelector('.message-images img').src"),preview)
 // Markdown export includes attachments too.
 const originalSaveDialog=dialog.showSaveDialog
 dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(root,'conversation.md')})
 try{await click('[aria-label="导出会话"]');await until(()=>fs.existsSync(path.join(root,'conversation.md')),'export');assert.ok(fs.readFileSync(path.join(root,'conversation.md'),'utf8').includes(preview))}finally{dialog.showSaveDialog=originalSaveDialog}
 // An IPC rejection restores the image and text draft so it can be retried.
 await pasteImage()
 await js("const el=document.querySelector('textarea[aria-label=消息]');el.value='描述图片';el.dispatchEvent(new Event('input',{bubbles:true}))")
 const originalStart=service.startChat.bind(service);let rejectOnce=true
 service.startChat=async(...args)=>{if(rejectOnce){rejectOnce=false;throw new Error('测试发送失败')}return originalStart(...args)}
 await js("document.querySelector('.composer').requestSubmit()")
 await until(()=>js("document.querySelector('.error-banner')?.textContent.includes('测试发送失败')"),'failed request')
 await count('.composer-images img',1)
 assert.equal(await js("document.querySelector('textarea[aria-label=消息]').value"),'描述图片')
 assert.equal(service.session(id).messages.length,2)
 await send();await until(()=>requests.length===3,'retry sent');await count('.message-images img',2)
 assert.equal(requests[2].messages.at(-1).content[0].text,'描述图片')
 assert.equal(requests[2].messages.at(-1).content[1].image_url.url,preview)
 // A draft image must not leak to a newly opened conversation.
 await pasteImage();await click('[aria-label="新建会话"]');await count('.composer-images img',0)
 await pasteImage()
 win.setContentSize(520,640)
 await until(()=>js("innerWidth===520"),'narrow viewport')
 assert.equal(await js("(()=>{const box=document.querySelector('.composer').getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight})()"),true)
 // A renderer updated by HMR must not send images into an older main process.
 const originalBootstrap=service.bootstrap.bind(service)
 service.bootstrap=()=>({...originalBootstrap(),chatImagesSupported:undefined})
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await until(()=>js("!!document.querySelector('.rail-button[aria-label=工作台]')"),'chat navigation');await click('.rail-button[aria-label=工作台]');await count('.composer',1)
 await pasteImage();await js("document.querySelector('.composer').requestSubmit()")
 await until(()=>js("document.querySelector('.error-banner')?.textContent.includes('重启 MyPlane')"),'old backend compatibility warning')
 await count('.composer-images img',1)
 assert.equal(requests.length,3)
 service.bootstrap=originalBootstrap
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({ok:true,checks:['native text and image paste','preview/removal','image-only send','multimodal request payload','persistence/reload','regeneration','Markdown export','failed-send draft recovery','text and image retry','new-session cleanup','narrow composer layout','old backend image protection']}))
}catch(error){console.error(error);process.exitCode=1}
finally{if(previousClipboard){clipboard.clear();for(const item of previousClipboard)clipboard.writeBuffer(item.format,item.data)}if(win&&!win.isDestroyed())win.destroy();service?.dispose();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}app.exit(process.exitCode||0)}

}
void main()
