import {app,BrowserWindow} from 'electron'
import {createServer} from 'node:http'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {InternalBrowser} from '../dist-electron/main/internal-browser.js'
import {CapabilityRegistry} from '../dist-electron/main/agent/core/capability-registry.js'
import {configureBrowserPlugin,registerBrowserPlugin} from '../dist-electron/main/browser-plugin.js'
import {protectedHandle} from '../dist-electron/main/auth.js'
app.on('window-all-closed',()=>{})
const root=mkdtempSync(path.join(tmpdir(),'myplane-browser-'));app.setPath('userData',root)
const wait=async check=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25))}throw Error('browser test timed out')}
async function main(){
 let server
 try{
  await app.whenReady()
  server=createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<title>${request.url==='/two'?'第二页':'测试网页'}</title><h1>内置浏览器测试</h1><input aria-label="姓名"><input type="password" aria-label="密码"><button onclick="if(!event.isTrusted)return;document.body.dataset.clicked=String(Number(document.body.dataset.clicked||0)+1)">确认</button><a href="/two" target="_blank">第二页</a><select aria-label="难度&#10;普通&#10;困难" onchange="document.querySelector('.status').textContent=this.value"><option value="normal">普通</option><option value="hard">困难</option><option value="locked" disabled>锁定</option><optgroup label="不可用" disabled><option value="grouped">分组选项</option></optgroup></select><div class="status" style="width:180px;white-space:nowrap;overflow:hidden">等待落子</div><canvas id="board" width="600" height="400" style="display:block;width:300px;height:200px;margin-top:900px" onclick="if(!event.isTrusted)return;document.body.dataset.point=event.offsetX+','+event.offsetY;document.querySelector('.status').textContent='已落子'"></canvas>`)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const url=`http://127.0.0.1:${server.address().port}`
  const browser=new InternalBrowser(path.resolve('dist-electron/main'))
  protectedHandle('browser:action',(event,action,value)=>browser.action(event.sender,action,value))
  await browser.open(url)
  const window=BrowserWindow.getAllWindows()[0],wc=window.contentView.children[0].webContents
  await wait(()=>browser.snapshot().title==='测试网页'&&!browser.snapshot().loading)
  assert.equal(await wc.executeJavaScript('typeof window.myplane'), 'undefined')
  assert.equal(await wc.executeJavaScript('typeof require'), 'undefined')
  await assert.rejects(browser.action(wc,'navigate',url+'/two'),/只能在内置浏览器/)
  await wc.executeJavaScript("document.querySelector('a').click()")
  await wait(()=>browser.snapshot().title==='第二页'&&!browser.snapshot().loading)
  assert.equal(BrowserWindow.getAllWindows().length,1)
  assert.equal(browser.snapshot().canGoBack,true)
  await browser.action(window.webContents,'back');await wait(()=>browser.snapshot().title==='测试网页'&&!browser.snapshot().loading)
  await browser.action(window.webContents,'forward');await wait(()=>browser.snapshot().title==='第二页'&&!browser.snapshot().loading)
  await assert.rejects(browser.action(window.webContents,'navigate','file:///etc/passwd'),/仅支持/)
  await assert.rejects(browser.action(window.webContents,'navigate','javascript:alert(1)'),/仅支持/)
  await browser.action(window.webContents,'navigate','http://127.0.0.1:1/')
  await wait(()=>!!browser.snapshot().error)
  assert.ok(browser.snapshot().url.includes('127.0.0.1:1'))
  await browser.action(window.webContents,'navigate',url);await wait(()=>browser.snapshot().title==='测试网页'&&!browser.snapshot().loading&&!browser.snapshot().error)
  const signal=new AbortController().signal
  configureBrowserPlugin(browser)
  const registry=new CapabilityRegistry({getAllTools:()=>[]});registerBrowserPlugin(registry)
  const automate=async(operation,args,signal)=>{
   const result=await registry.execute({capability:'browser.'+operation,args},signal)
   if(!result.success)throw Error(typeof result.error==='string'?result.error:JSON.stringify(result.error))
   return result.output
  }
  await assert.rejects(browser.automate('read_page',{},signal),/未启用/)
  await browser.action(window.webContents,'enable-automation',true)
  let snapshot=await automate('read_page',{},signal)
  assert.ok(snapshot.text.includes('内置浏览器测试'))
  assert.ok(!snapshot.elements.some(item=>item.type==='password'))
  const name=snapshot.elements.find(item=>item.label==='姓名')
  await automate('fill',{snapshot:snapshot.snapshot,url:snapshot.url,label:name.label,ref:name.ref,text:'测试 " <value>'},signal)
  assert.equal(await wc.executeJavaScript("document.querySelector('input').value"),'测试 " <value>')
  await assert.rejects(automate('fill',{snapshot:snapshot.snapshot,url:snapshot.url,label:name.label,ref:name.ref,text:'重复'},signal),/快照已失效/)
  snapshot=await automate('read_page',{},signal)
  const button=snapshot.elements.find(item=>item.label==='确认')
  const controller=new AbortController();controller.abort()
  await assert.rejects(automate('click',{snapshot:snapshot.snapshot,url:snapshot.url,label:button.label,ref:button.ref},controller.signal))
  assert.equal(await wc.executeJavaScript('document.body.dataset.clicked'),undefined)
  await automate('click',{snapshot:snapshot.snapshot,url:snapshot.url,label:button.label,ref:button.ref},signal)
  await wait(async()=>await wc.executeJavaScript('document.body.dataset.clicked')==='1')
  assert.equal(await wc.executeJavaScript('document.body.dataset.clicked'),'1')
  assert.equal(await wc.executeJavaScript("getComputedStyle(document.querySelector('[data-myplane-pointer]')).pointerEvents"),'none')
  assert.equal(await wc.executeJavaScript('typeof window.__myplanePointer'),'undefined')
  if(process.env.MYPLANE_POINTER_PREVIEW)writeFileSync(process.env.MYPLANE_POINTER_PREVIEW,(await wc.capturePage()).toPNG())
  const pointerPage=await automate('read_page',{},signal)
  assert.ok(!pointerPage.text.includes('Agent'))
  assert.ok(!pointerPage.elements.some(item=>item.label==='Agent'))
  await wait(async()=>!(await wc.executeJavaScript("!!document.querySelector('[data-myplane-pointer]')")))
  snapshot=await automate('read_page',{},signal)
  await wc.executeJavaScript("document.body.insertAdjacentHTML('beforeend','<div id=overlay style=\"position:fixed;inset:0;z-index:9999\"></div>')")
  await assert.rejects(automate('click',{snapshot:snapshot.snapshot,url:snapshot.url,label:button.label,ref:button.ref},signal),/被遮挡/)
  await wc.executeJavaScript("document.getElementById('overlay').remove()")
  snapshot=await automate('read_page',{},signal)
  await wc.executeJavaScript("document.querySelector('button').textContent='删除'")
  await assert.rejects(automate('click',{snapshot:snapshot.snapshot,url:snapshot.url,label:button.label,ref:button.ref},signal),/元素已变化/)
  const target=(page,label)=>{const element=page.elements.find(item=>item.label===label);assert.ok(element,'Missing '+label);return {snapshot:page.snapshot,url:page.url,label:element.label,ref:element.ref}}
  snapshot=await automate('read_page',{},signal)
  const board=snapshot.elements.find(item=>item.tag==='canvas')
  assert.deepEqual(board.canvas,{width:600,height:400})
  assert.equal(board.bounds.width,300)
  await automate('click',{...target(snapshot,'board'),x:75,y:60},signal)
  await wait(async()=>!!(await wc.executeJavaScript('document.body.dataset.point')))
  const point=(await wc.executeJavaScript('document.body.dataset.point')).split(',').map(Number)
  assert.ok(Math.abs(point[0]-75)<=1&&Math.abs(point[1]-60)<=1,JSON.stringify(point))
  snapshot=await automate('read_page',{},signal)
  assert.match(snapshot.text,/已落子/)
  await assert.rejects(automate('click',{...target(snapshot,'board'),x:300,y:60},signal),/超出元素/)
  snapshot=await automate('read_page',{},signal)
  await assert.rejects(automate('click',{...target(snapshot,'board'),x:10},signal),/坐标/)
  await wc.executeJavaScript("document.querySelector('canvas').style.width='280px'")
  await assert.rejects(automate('click',{...target(snapshot,'board'),x:10,y:10},signal),/尺寸已变化/)
  snapshot=await automate('read_page',{},signal)
  assert.equal(snapshot.elements.find(item=>item.label==='难度\n普通\n困难').options.find(item=>item.value==='hard').label,'困难')
  await automate('select_option',{...target(snapshot,'难度\n普通\n困难'),label:'难度\\n普通\\n困难',value:'hard'},signal)
  snapshot=await automate('read_page',{},signal)
  assert.equal(snapshot.elements.find(item=>item.label==='难度\n普通\n困难').value,'hard')
  assert.match(snapshot.text,/hard/)
  for(const value of ['locked','grouped','missing']){
   snapshot=await automate('read_page',{},signal)
   await assert.rejects(automate('select_option',{...target(snapshot,'难度\n普通\n困难'),value},signal),/不存在或已禁用/)
  }
  snapshot=await automate('read_page',{},signal)
  await wc.executeJavaScript("document.querySelector('option[value=normal]').textContent='已更改'")
  await assert.rejects(automate('select_option',{...target(snapshot,'难度\n普通\n困难'),value:'normal'},signal),/元素已变化/)
  const layout=await automate('inspect',{url:snapshot.url,selector:'.status'},signal)
  assert.equal(layout.count,1);assert.equal(layout.elements[0].bounds.width,180)
  assert.equal(layout.elements[0].styles['white-space'],'nowrap')
  assert.equal(layout.elements[0].text,'hard')
  await assert.rejects(automate('inspect',{url:snapshot.url,selector:'['},signal),/selector/i)
  await assert.rejects(automate('inspect',{url:snapshot.url+'/other',selector:'.status'},signal),/页面已变化/)
  snapshot=await automate('read_page',{},signal)
  await automate('click',{...target(snapshot,'board'),x:45,y:40},signal)
  assert.equal(await wc.executeJavaScript("!!document.querySelector('[data-myplane-pointer]')"),true)
  await browser.action(window.webContents,'enable-automation',false)
  assert.equal(await wc.executeJavaScript("!!document.querySelector('[data-myplane-pointer]')"),false)
  await assert.rejects(browser.automate('read_page',{},signal),/未启用/)
  window.destroy();await wait(()=>wc.isDestroyed());assert.equal(wc.isDestroyed(),true)
  console.log('Internal browser navigation, isolation and cleanup passed')
 }catch(error){console.error(error);process.exitCode=1}finally{for(const window of BrowserWindow.getAllWindows())window.destroy();server?.close();rmSync(root,{recursive:true,force:true});app.exit(process.exitCode||0)}
}
void main()
