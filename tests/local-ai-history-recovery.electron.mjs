import {app,BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {LocalAiStudioService,registerLocalAiStudio} from '../dist-electron/main/local-ai-studio.js'
import {trackAuthWindow} from '../dist-electron/main/auth.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-history-recovery-'))
app.setPath('userData',path.join(root,'profile'))
let win,service
const errors=[]
async function main(){try{
 await app.whenReady()
 const directory=path.join(root,'data','local-ai-agent-tasks'),id=randomUUID(),at=new Date().toISOString()
 fs.mkdirSync(directory,{recursive:true})
 // Legacy records represent a newly created file with before:null, including
 // both single-file previews and multi-file change previews.
 const task={id,title:'恢复旧会话',workspace:root,mode:'coding',model:'fixture',status:'completed',steps:1,maxSteps:20,plan:[],messages:[],createdAt:at,updatedAt:at,events:[
  {id:randomUUID(),kind:'user',text:'创建文件',createdAt:at},
  ...[
   {path:'single.txt',before:null,after:'hello'},
   {changes:[{path:'batch.txt',before:null,after:'world'}]},
   {path:'existing.txt',before:'first\r\nold',after:'first\r\nnew'},
   {path:'existing.txt',before:'first\r\nnew',after:'first\r\nnewer'},
  ].map((preview,index)=>({id:randomUUID(),kind:'tool',tool:index===1?'apply_patch':'write_file',text:'完成',status:'completed',preview,createdAt:at})),
  {id:randomUUID(),kind:'assistant',text:'文件已生成',createdAt:at},
 ],artifacts:['single.txt','batch.txt','existing.txt'].map(name=>({path:name,kind:'file'}))}
 const file=path.join(directory,id+'.json')
 fs.writeFileSync(file,JSON.stringify(task))
 service=new LocalAiStudioService(path.join(root,'data'))
 service.saveStudioSettings({source:'managed',model:'fixture'})
 registerLocalAiStudio(()=>service,()=>service.dispose())
 win=new BrowserWindow({show:false,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)})
 trackAuthWindow(win.webContents,true,'http://127.0.0.1:5174')
 const url='http://127.0.0.1:5174/tests/fixtures/local-ai-studio.html'
 for(let attempt=0;attempt<2;attempt++){
  await win.loadURL(url)
  const end=Date.now()+15000
  while(!await win.webContents.executeJavaScript("!!document.querySelector('.agent-result') && !document.querySelector('.agent-new').disabled")){
   if(errors.length)throw new Error(errors.join('\n'))
   if(Date.now()>end)throw new Error('History restoration stayed locked')
   await new Promise(resolve=>setTimeout(resolve,40))
  }
  const state=await win.webContents.executeJavaScript(`({text:document.body.innerText,lines:[...document.querySelectorAll('.agent-result-files small')].map(el=>el.textContent),disabled:document.querySelector('textarea[aria-label="消息"]').disabled})`)
  assert.doesNotMatch(state.text,/正在读取会话/)
  assert.match(state.text,/文件已生成/)
  assert.deepEqual(state.lines,['第 1 行 · 点击预览','第 1 行 · 点击预览','第 2 行 · 点击预览'])
  assert.deepEqual(await win.webContents.executeJavaScript("[...document.querySelectorAll('.agent-edit-list strong')].map(el=>el.textContent)"),['existing.txt','batch.txt','single.txt'],'edited files are unique and retain the latest operation')
  assert.equal(state.disabled,false)
 }
 assert.deepEqual(errors,[])
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).events[1].preview.before,null,'display preserves stored history')
 console.log('PASS: legacy null previews restore after reload without render errors; composer unlocked; line locations preserved')
}catch(error){console.error(error);process.exitCode=1}finally{
 win?.destroy();service?.dispose();fs.rmSync(root,{recursive:true,force:true});app.exit(process.exitCode||0)
}}
void main()
