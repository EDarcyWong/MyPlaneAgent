import {app,BrowserWindow,ipcMain,net} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {LocalAiStudioService,registerLocalAiStudio} from '../dist-electron/main/local-ai-studio.js'
import {trackAuthWindow} from '../dist-electron/main/auth.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-local-ai-ui-')),project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
fs.mkdirSync(path.join(root,'profile'),{recursive:true});app.setPath('userData',path.join(root,'profile'))
const originalNetFetch=net.fetch,originalFetch=globalThis.fetch,modelData=Buffer.from('GGUF-smoke-test-download'),revision='b'.repeat(40)
net.fetch=globalThis.fetch=async(url,options)=>{
 const address=String(url)
 if(address.startsWith('https://huggingface.co/api/models?'))return new Response(JSON.stringify([{id:'test/Small-GGUF',author:'test',downloads:12500,likes:55,tags:['gguf','text-generation']}]),{headers:{'Content-Type':'application/json'}})
 if(address.startsWith('https://huggingface.co/api/models/test/Small-GGUF'))return new Response(JSON.stringify({sha:revision,siblings:[{rfilename:'tiny-Q4_K_M.gguf',size:modelData.length,lfs:{size:modelData.length,sha256:createHash('sha256').update(modelData).digest('hex')}}]}))
 if(address.startsWith('https://huggingface.co/test/Small-GGUF/resolve/'))return new Response(modelData,{headers:{'content-length':String(modelData.length)}})
 if(address.startsWith('https://huggingface.co/'))return new Response('Not found',{status:404})
 return originalFetch(url,options)
}
let server,window,service
const errors=[]
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function waitFor(check,label){const deadline=Date.now()+20000;while(!await check()){if(Date.now()>deadline)throw new Error(`Timed out: ${label}`);await delay(70)}}
const js=async source=>{try{return await window.webContents.executeJavaScript(source,true)}catch(error){throw new Error(`Renderer script failed: ${source}\n${error}`)}}
const click=label=>js(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`)
async function uiText(value){await waitFor(()=>js(`document.body.innerText.includes(${JSON.stringify(value)})`),value)}
async function main(){try{
 await app.whenReady()
 server=createServer(async(req,res)=>{
  if(req.url==='/v1/models'){await delay(250);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'smoke-model'}]}));return}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end('not found');return}
  let text='';for await(const chunk of req)text+=chunk
  const payload=JSON.parse(text);assert.equal(payload.model,'smoke-model');assert.equal(payload.stream,true);assert.deepEqual(payload.stream_options,{include_usage:true})
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'})
  const stop=payload.messages.at(-1).content.includes('STOP'),chunks=stop?Array(100).fill('继续 '):['## 本地回复\n','你好，流式聊天工作正常。\n','```js\nconsole.log("local");\n```']
  let index=0;const timer=setInterval(()=>{if(index<chunks.length){res.write(`data: ${JSON.stringify({choices:[{delta:{content:chunks[index++]}}]})}\r\n\r\n`)}else{clearInterval(timer);res.end(`data: ${JSON.stringify({usage:{prompt_tokens:100,completion_tokens:24,total_tokens:124},choices:[]})}\n\ndata: [DONE]\n\n`)}},stop?150:50);res.once('close',()=>clearInterval(timer))
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 service=new LocalAiStudioService(path.join(root,'data'));service.saveStudioSettings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'previous-model',theme:'light'});service.newSession();service.saveStudioSettings({model:''})
 registerLocalAiStudio(()=>service,()=>service.dispose());ipcMain.handle('ai:open-link',()=>{})
 window=new BrowserWindow({width:1380,height:900,show:false,webPreferences:{preload:path.join(project,'dist-electron/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
 window.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)})
 window.webContents.on('render-process-gone',(_event,details)=>errors.push(JSON.stringify(details)))
 trackAuthWindow(window.webContents,true,'http://127.0.0.1:5174')
 await window.loadURL('http://127.0.0.1:5174/tests/fixtures/local-ai-studio.html')
 await waitFor(()=>js("!!document.querySelector('.rail-button[aria-label=工作台]')"),'chat navigation');await click('工作台');await uiText('有什么可以帮你？');await uiText('已连接')
 assert.equal(await js("document.querySelectorAll('.rail-button').length"),7)
 assert.equal(await js("[...document.querySelectorAll('.rail-button>span')].every(label=>label.getBoundingClientRect().height<18)"),true,'navigation labels stay on one line')
 assert.ok(await js("Math.abs(document.querySelector('.local-ai-studio').getBoundingClientRect().width-innerWidth)<2"),'studio fills its flex host')
 assert.equal(await js("document.querySelectorAll('.composer').length"),1)
 await waitFor(()=>js("!!document.querySelector('select[aria-label=\"会话模型\"]')"),'conversation model control');assert.equal(await js("document.querySelector('select[aria-label=\"会话模型\"]').value"),'smoke-model','late remote validation refreshes the restored session model');assert.equal(await js("[...document.querySelectorAll('select[aria-label=\"会话模型\"] option')].some(option=>option.value==='smoke-model')"),true,'late remote validation refreshes model options')
 await js("document.querySelector('textarea[aria-label=消息]').value='请介绍本地模型';document.querySelector('textarea[aria-label=消息]').dispatchEvent(new Event('input',{bubbles:true}))")
 await js("document.querySelector('.composer').requestSubmit()")
 await uiText('流式聊天工作正常');await waitFor(()=>js("!document.querySelector('.stop-button')"),'stream completion')
 assert.equal(await js("document.querySelectorAll('.code-block').length"),1)
 let current=service.session(service.sessions()[0].id);assert.equal(current.messages.length,2);assert.equal(current.messages[1].tokens,24);assert.equal(current.usage.totalTokens,124);assert.equal(current.messages[1].usage.inputTokens,100)
 assert.match(await js("document.querySelector('.agent-token-usage').innerText"),/124/)
 await js("[...document.querySelectorAll('.message-actions button')].find(button=>button.textContent.includes('重新生成')).click()")
 await waitFor(()=>service.session(current.id).usage.requests===2&&service.session(current.id).usage.totalTokens===248,'regeneration usage');await waitFor(()=>js("!document.querySelector('.stop-button')"),'regeneration finished')
 current=service.session(current.id);assert.equal(current.messages.length,2);assert.equal(current.usage.totalTokens,248)
 await window.reload();await waitFor(()=>js("!!document.querySelector('.rail-button[aria-label=工作台]')"),'reloaded navigation');await click('工作台');await uiText('流式聊天工作正常')
 assert.match(await js("document.querySelector('.agent-token-usage').innerText"),/248/)
 await js("document.querySelector('textarea[aria-label=消息]').value='STOP';document.querySelector('textarea[aria-label=消息]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.composer').requestSubmit()")
 await uiText('继续');await js("document.querySelector('.stop-button').click()");await uiText('已停止生成')
 current=service.session(service.sessions()[0].id);assert.equal(current.messages.at(-1).status,'stopped');assert.equal(current.usage.requests,3);assert.equal(current.usage.totalTokens,248);assert.equal(current.usage.totalReports,2)
 await click('发现模型');await uiText('发现你的下一个模型');await js("document.querySelector('.discovery-search').requestSubmit()")
 await waitFor(()=>js("!!document.querySelector('.catalog-model-title strong[title=\"test/Small-GGUF\"]')"),'model result');await js("document.querySelector('.catalog-model-title strong[title=\"test/Small-GGUF\"]').closest('button').click()");await uiText('tiny-Q4_K_M.gguf');await js("document.querySelector('.download-file').click()")
 await uiText('SHA-256 已校验');assert.equal(service.models().length,1);assert.deepEqual(fs.readFileSync(service.models()[0].localPath),modelData)
 await click('关闭下载队列');await click('我的模型');await uiText('tiny-Q4_K_M.gguf')
 await click('模型服务');await waitFor(()=>js("!!document.querySelector('.service-workspace')"),'model service workspace');await click('设置');await uiText('应用设置')
 await click('工作台');await click('新建会话');await uiText('有什么可以帮你？')
 await waitFor(()=>js("!document.querySelector('.el-message')"),'transient notifications dismissed')
 await delay(450)
 await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
 const screenshot=process.env.LOCAL_AI_SCREENSHOT||path.join(os.tmpdir(),'myplane-local-ai-preview.png');fs.writeFileSync(screenshot,(await window.webContents.capturePage()).toPNG())
 for(const [width,height] of [[520,640],[760,640],[1024,768],[1440,900]]){
  window.setContentSize(width,height);await delay(150)
  for(const label of ['发现模型','我的模型','模型服务','设置','工作台']){
   await click(label);await delay(70)
   const bounds=await js(`(()=>{const root=document.querySelector('.local-ai-studio').getBoundingClientRect();const page=[...document.querySelectorAll('.unified-workspace,.discover-workspace,.scroll-page,.service-workspace')].find(el=>el.getBoundingClientRect().width>0);const box=page.getBoundingClientRect();return {root:Math.abs(root.width-innerWidth)<2,page:box.left>=root.left&&box.right<=root.right+1,overflow:document.documentElement.scrollWidth<=innerWidth}})()`)
   assert.deepEqual(bounds,{root:true,page:true,overflow:true},`${label} fits ${width}x${height}`)
  }
  if(width<850){
   assert.equal(await js("getComputedStyle(document.querySelector('.agent-history')).display"),'none')
   await click('项目与会话');assert.equal(await js("document.querySelector('.agent-history').classList.contains('expanded')"),true)
   await js("document.querySelector('.agent-history').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
   assert.equal(await js("getComputedStyle(document.querySelector('.agent-history')).display"),'none')
   const composer=await js("(()=>{const box=document.querySelector('.composer').getBoundingClientRect(),bottom=document.querySelector('.status-bar').getBoundingClientRect().top;return box.width>350&&box.bottom<=bottom})()")
   assert.equal(composer,true,'composer retains room in narrow windows')
   await click('发现模型');await js("document.querySelector('.discovery-card').click()")
   await waitFor(()=>js("document.querySelector('#studio-details').getAttribute('aria-modal')==='true'&&document.querySelector('#studio-details').getBoundingClientRect().width>0"),'model details overlay')
   await click('返回搜索结果');assert.equal(await js("getComputedStyle(document.querySelector('#studio-details')).display"),'none')
  }
 }
 await js("document.querySelector('.rail-button[aria-label=设置]').click()")
 await js("const select=[...document.querySelectorAll('select')].find(el=>[...el.options].some(option=>option.value==='dark'));select.value='dark';select.dispatchEvent(new Event('change',{bubbles:true}))")
 assert.equal(await js("document.querySelector('.local-ai-studio').dataset.theme"),'dark')
 assert.equal(errors.length,0,errors.join('\n'))
 console.log(JSON.stringify({ok:true,checks:['full-width flex host','unified project sidebar and composer','window renders','real protected IPC','streamed Markdown and code','cancel generation','model search and download','five workspaces at 520/760/1024/1440px','narrow overlays and Escape','composer remains accessible','dark theme'],screenshot}))
}catch(error){console.error(error);process.exitCode=1}
finally{
 net.fetch=originalNetFetch;globalThis.fetch=originalFetch
 if(window&&!window.isDestroyed())window.destroy()
 try{service?.dispose()}catch{}
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'myplane-local-ai-ui-')))
 // Chromium owns profile handles until process shutdown. Leave the isolated profile to the OS temp cleaner.
 app.exit(process.exitCode||0)
}
}
void main()
