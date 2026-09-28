import {app,BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {LocalAiRuntime} from '../dist-electron/main/local-ai-runtime.js'
import {ModelPerformanceTracker} from '../dist-electron/main/model-performance.js'
import {externalModelPerformance} from '../dist-electron/main/external-model-performance.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-native-widgets-'))
process.env.MYPLANE_AGENT_DATA_DIR=root;process.env.MYPLANE_AGENT_TEST_MODE='1';app.setAppPath(path.resolve('.'))
const tracker=new ModelPerformanceTracker(),original=LocalAiRuntime.prototype.snapshot
LocalAiRuntime.prototype.snapshot=function(){return {...original.call(this),state:'running',modelName:'fixture-local',performance:tracker.snapshot()}}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check,label){for(let i=0;i<250;i++){if(await check())return;await delay(60)}throw Error('Timeout: '+label)}
const surface=name=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('surface='+name))
const watchdog=setTimeout(()=>app.exit(1),60000)
async function main(){try{
 await import('../dist-electron/main/index.js');await app.whenReady()
 await until(()=>BrowserWindow.getAllWindows().length,'main window')
 const main=BrowserWindow.getAllWindows()[0],evaluate=code=>main.webContents.executeJavaScript(code,true)
 await until(()=>evaluate("!!document.querySelector('.chat-workbench')").catch(()=>false),'app')
 await evaluate("window.myplane.localAiStudio('settings',{source:'managed',showTokenSpeed:true,showExecutionInspector:true})")
 main.webContents.reload()
 await until(()=>surface('performance')&&surface('inspector'),'automatically opened both independent windows')
 let performance=surface('performance'),inspector=surface('inspector')
 const perf=code=>performance.webContents.executeJavaScript(code,true)
 await until(()=>perf("!!document.querySelector('.model-performance .empty')").catch(()=>false),'performance loaded')
 assert.equal(await evaluate("!!document.querySelector('.model-performance,.execution-inspector')"),false)
 for(const win of [performance,inspector]){assert.equal(win.getParentWindow(),null);assert.equal(win.isResizable(),true);assert.equal(win.isMovable(),true)}
 assert.equal(await perf("!!document.querySelector('.desktop-titlebar')"),false)
 tracker.feed('stderr',Buffer.from('id 0 | task 50 | prompt processing, n_tokens = 100, t = 1 s / 204.57 tokens per second\nid 0 | task 50 | n_gen = 100, tg = 3.05 t/s, tg_3s = 3.08 t/s\n'))
 await until(()=>perf("document.querySelector('.model-performance').textContent.includes('204.6')"),'local samples')
 await perf("document.querySelector('.chart-toggle').click()")
 await until(()=>perf("document.querySelectorAll('.speed-chart').length===2"),'local graphs')
 await perf("document.querySelector('.chart-toggle').click()")
 assert.equal(await perf("document.querySelectorAll('.speed-chart').length"),0)
 const endpoint='http://127.0.0.1:65000/v1',now=Date.now(),id=externalModelPerformance.begin(endpoint,'fixture-external',now-4000)
 externalModelPerformance.progress(id,40,now-3000);externalModelPerformance.progress(id,80,now-2000);externalModelPerformance.usage(id,{inputTokens:200,outputTokens:20});externalModelPerformance.finish(id,'complete',80,now)
 await evaluate(`window.myplane.localAiStudio('settings',{source:'external',endpoint:${JSON.stringify(endpoint)}})`)
 await until(()=>perf("document.querySelector('.model-performance').textContent.includes('fixture-external')"),'external samples')
 assert.match(await perf("document.querySelector('.model-performance').textContent"),/服务端 Token 用量/)
 assert.match(await perf("document.querySelector('.model-performance').textContent"),/5\.0/)
 await perf("document.querySelector('.chart-toggle').click()")
 assert.equal(await perf("document.querySelectorAll('.speed-chart').length"),1)
 const expected={x:140,y:120,width:540,height:720}
 inspector.setBounds(expected);await delay(100)
 const oldId=inspector.id;inspector.close();await until(()=>!surface('inspector'),'inspector closed')
 await evaluate("window.myplane.inspectorWindow('open')");inspector=surface('inspector');assert.notEqual(inspector.id,oldId)
 for(const [key,value] of Object.entries(expected))assert.ok(Math.abs(inspector.getBounds()[key]-value)<=1,key)
 performance.setBounds({x:700,y:140,width:450,height:680});await delay(100)
 const savedPerformance=performance.getBounds()
 performance.close();await until(()=>!surface('performance'),'performance closed')
 await evaluate("window.myplane.performanceWindow('open')");performance=surface('performance')
 await delay(150)
 assert.ok(Math.abs(performance.getBounds().width-savedPerformance.width)<=1,JSON.stringify({before:savedPerformance,after:performance.getBounds()}))
 console.log('PASS default native windows, local/external statistics, graphs, independent resize/move and remembered bounds')
 }catch(error){console.error(error);process.exitCode=1}finally{clearTimeout(watchdog);app.removeAllListeners('window-all-closed');for(const win of BrowserWindow.getAllWindows())win.destroy();app.exit(process.exitCode||0)}}
void main()
