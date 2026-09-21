import {app,BrowserWindow,dialog} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:http'
import {randomUUID} from 'node:crypto'
import {LocalAiStudioService,registerLocalAiStudio} from '../dist-electron/main/local-ai-studio.js'
import {trackAuthWindow} from '../dist-electron/main/auth.js'
import {extractDocument} from '../dist-electron/main/agent/documents.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-agent-ui-')),workspace=path.join(root,'workspace')
fs.mkdirSync(workspace);fs.writeFileSync(path.join(workspace,'math.mjs'),'export const add = (a, b) => a - b;\n')
app.setPath('userData',path.join(root,'profile'))
let window,server,service,originalDialog=dialog.showOpenDialog,requests=0,legacyProjectApi=false
const errors=[],js=async source=>{try{return await window.webContents.executeJavaScript(source,true)}catch(error){console.error('Renderer script failed:',source);throw error}},delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check,label){const deadline=Date.now()+20000;while(!await check()){if(Date.now()>deadline){console.error(await js('document.body.innerText.slice(-4000)'));throw new Error('Timed out: '+label)}await delay(40)}}
const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`)
const tool=(name,args)=>({id:randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}})
const answer=(content,calls)=>({choices:[{finish_reason:calls?'tool_calls':'stop',message:{role:'assistant',content,tool_calls:calls}}]})
async function screenshot(name){await delay(400);fs.writeFileSync(path.join(root,name+'.png'),(await window.webContents.capturePage()).toPNG())}
async function createProject(folder,name){
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});await click('.agent-create-project')
 await until(()=>js("!!document.querySelector('.el-message-box__input input')"),'project name dialog')
 await js(`(()=>{const input=document.querySelector('.el-message-box__input input');input.value=${JSON.stringify(name)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 await click('.el-message-box__btns .el-button--primary')
 await until(()=>js(`document.querySelector('.agent-project-item.selected strong')?.textContent===${JSON.stringify(name)}&&!document.querySelector('.agent-create-project').disabled`),'project selected')
 dialog.showOpenDialog=originalDialog
}
async function submit(prompt){await js(`(()=>{const input=document.querySelector('textarea[aria-label="消息"]');input.value=${JSON.stringify(prompt)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.agent-prompt').requestSubmit()})()`)}
async function main(){try{
 await app.whenReady()
 server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'agent-fixture'}]}));return}if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end('{}');return}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);assert.ok(body.tools?.length)
  const replies=[
   answer('我会先读取代码，修复加法逻辑，再运行验证并生成说明文档。',[tool('set_plan',{steps:[{text:'检查并修复加法逻辑',status:'running'},{text:'运行验证',status:'pending'},{text:'生成修复报告',status:'pending'}]}),tool('read_file',{path:'math.mjs'})]),
   answer('当前函数使用了减法，将其改为加法。',[tool('replace_text',{path:'math.mjs',oldText:'a - b',newText:'a + b'})]),
   answer('文件已保存，准备运行验证。',[tool('run_command',{command:'node --input-type=module -e "import {add} from \'./math.mjs\'; if(add(2,3)!==5)process.exit(1); console.log(\'check passed\')"',timeoutSeconds:10})]),
   answer('验证通过，准备生成报告。',[tool('create_document',{path:'修复报告.docx',title:'加法功能修复报告',content:'## 修改\n将 math.mjs 中的减法改为加法。\n## 验证\nadd(2, 3) = 5，命令退出码为 0。\n## 交付\n- math.mjs\n- 修复报告.docx'})]),
   answer('已完成修复和验证。',[tool('set_plan',{steps:[{text:'检查并修复加法逻辑',status:'completed'},{text:'运行验证',status:'completed'},{text:'生成修复报告',status:'completed'}]})]),
   answer('修复完成。已修改 `math.mjs`，验证命令退出码为 0，并生成 `修复报告.docx`。')
  ];const reply=replies[requests++]||answer('补充说明已完成。')
  assert.equal(body.stream,true);assert.deepEqual(body.stream_options,{include_usage:true});reply.usage={prompt_tokens:100,completion_tokens:20,total_tokens:120}
  if(requests===1){
   res.setHeader('Content-Type','text/event-stream');res.flushHeaders()
   res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'正在理解项目结构'},finish_reason:null}]})+'\n\n')
   await delay(900)
   const message=reply.choices[0].message
   res.write('data: '+JSON.stringify({choices:[{delta:{content:message.content,tool_calls:message.tool_calls.map((call,index)=>({...call,index}))},finish_reason:null}]})+'\n\n')
   res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'tool_calls'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:reply.usage})+'\n\ndata: [DONE]\n\n')
  }else res.end(JSON.stringify(reply))
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 service=new LocalAiStudioService(path.join(root,'data'));service.saveStudioSettings({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'agent-fixture',theme:'light',contextLength:16384});registerLocalAiStudio(()=>service,()=>service.dispose())
 const dispatch=service.dispatch.bind(service);service.dispatch=(action,...args)=>{if(legacyProjectApi&&action==='agentProjects')throw new Error('不支持的本地 AI 操作');return dispatch(action,...args)}
 window=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}})
 window.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});trackAuthWindow(window.webContents,true,'http://127.0.0.1:5174')
 await window.loadURL('http://127.0.0.1:5174/tests/fixtures/local-ai-studio.html');await until(()=>js("!!document.querySelector('.agent-welcome')"),'agent welcome')
 await screenshot('agent-welcome')
 assert.equal(await js("document.querySelector('.rail-button[aria-label=工作台]').getAttribute('aria-current')"),'page')
 assert.match(await js("window.myplane.localAiStudio('agentStart',{mode:'coding',model:'x',prompt:'test',maxSteps:10}).then(()=>'',e=>String(e))"),/选择目录/)
 assert.match(await js("window.myplane.localAiStudio('agentCreateProject',{workspaceToken:'forged',name:'unauthorized'}).then(()=>'',e=>String(e))"),/选择目录/)
 dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});await click('.agent-create-project');await until(()=>js("!document.querySelector('.agent-create-project').disabled"),'cancel picker');assert.equal((await js("window.myplane.localAiStudio('agentProjects')")).length,0)
 await createProject(workspace,'加法工具项目')
 assert.equal(await js("document.querySelector('select[aria-label=\"会话模型\"]').value"),'agent-fixture')
 await click('[aria-label=会话设置]');await until(()=>js("(document.querySelector('.agent-settings')?.getBoundingClientRect().width||0)>0"),'settings dialog');await delay(200)
 assert.deepEqual(await js("(()=>{const dialog=document.querySelector('.agent-settings'),style=getComputedStyle(dialog);return {theme:style.getPropertyValue('--s-panel').trim().length>0,background:style.backgroundColor!=='rgba(0, 0, 0, 0)',color:style.color!=='rgba(0, 0, 0, 0)'}})()"),{theme:true,background:true,color:true})
 await screenshot('agent-settings')
 assert.equal(await js("!!document.querySelector('.agent-settings-model')||!!document.querySelector('.model-capabilities')"),false)
 assert.equal(await js("!!document.querySelector('select[aria-label=\"执行上限\"]')"),true)
 assert.deepEqual(await js("(()=>{const panel=document.querySelector('.agent-settings-panel'),button=[...panel.querySelectorAll('button')].find(item=>item.textContent==='完成'),style=getComputedStyle(button);return {noScroll:panel.scrollHeight<=panel.clientHeight,colorVisible:style.color!==style.backgroundColor&&style.color!=='rgba(0, 0, 0, 0)'}})()"),{noScroll:true,colorVisible:true})
 await js("(()=>{const limit=document.querySelector('select[aria-label=\"执行上限\"]');limit.value='10';limit.dispatchEvent(new Event('change',{bubbles:true}))})()")
 window.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});await until(()=>js("(document.querySelector('.agent-settings')?.getBoundingClientRect().width||0)===0"),'settings dialog closes with Escape')
 const [project]=await js("window.myplane.localAiStudio('agentProjects')");assert.equal(project.workspace,fs.realpathSync(workspace))
 assert.match(await js("document.querySelector('.agent-workspace-picker').innerText"),/加法工具项目/)
 await screenshot('agent-project')
 for(const [width,height] of [[520,640],[760,720],[1280,900]]){
  window.setContentSize(width,height);await delay(200)
  const welcome=await js("(()=>{const scroll=document.querySelector('.agent-scroll'),cards=document.querySelector('.agent-template-grid').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,cards:cards.bottom<=scroll.getBoundingClientRect().bottom+1}})()")
  assert.deepEqual(welcome,{overflow:false,cards:true},'welcome cards visible at '+width)
  if(width===520)await screenshot('agent-welcome-narrow')
 }
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});await click('.agent-create-project');await until(()=>js("!document.querySelector('.agent-create-project').disabled"),'duplicate project');dialog.showOpenDialog=originalDialog
 assert.equal((await js("window.myplane.localAiStudio('agentProjects')")).length,1)
 const cancelledFolder=path.join(root,'cancelled');fs.mkdirSync(cancelledFolder)
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[cancelledFolder]});await click('.agent-create-project');await until(()=>js("!!document.querySelector('.el-message-box__input input')"),'cancel project dialog')
 await click('.el-message-box__btns .el-button:not(.el-button--primary)');await until(()=>js("!document.querySelector('.agent-create-project').disabled&&!document.querySelector('.el-message-box__input input')"),'cancel project name');dialog.showOpenDialog=originalDialog
 assert.equal((await js("window.myplane.localAiStudio('agentProjects')")).length,1);assert.equal(await js("document.querySelector('.agent-workspace-picker').title"),project.workspace)
 await js("const input=document.querySelector('textarea[aria-label=\"消息\"]');input.value='修复加法函数，运行验证，并生成 Word 报告。';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.agent-prompt').requestSubmit()")
 await until(()=>js("document.querySelector('.agent-working')?.textContent.includes('模型正在思考')||!!document.querySelector('.agent-approval')"),'live model progress')
 if(await js("!!document.querySelector('.agent-working')"))assert.match(await js("document.querySelector('.agent-working').textContent"),/已接收/)
 await until(()=>js("!!document.querySelector('.agent-approval')"),'file approval')
 const collapsedExecution=await js("(()=>{const user=document.querySelector('.agent-event.user'),plan=document.querySelector('.agent-plan'),process=document.querySelector('.agent-process'),tool=document.querySelector('.agent-event.tool.waiting>details'),normal=document.querySelector('.agent-event.user .ai-markdown'),stream=document.querySelector('.agent-process-stream'),toggle=document.querySelector('.agent-process-toggle');if(!user||!plan||!process||!tool||!normal||!stream||!toggle)return {missing:{user:!!user,plan:!!plan,process:!!process,tool:!!tool,normal:!!normal,stream:!!stream,toggle:!!toggle}};const planSummary=plan.querySelector('summary'),processSummary=process.querySelector('summary'),planStyle=getComputedStyle(planSummary),normalStyle=getComputedStyle(normal);return {state:{planOpen:plan.open,processOpen:process.open,toolOpen:tool.open,planAfterUser:!!(user.compareDocumentPosition(plan)&4),processAfterPlan:!!(plan.compareDocumentPosition(process)&4),singleLine:planSummary.getBoundingClientRect().height<50&&processSummary.getBoundingClientRect().height<50&&stream.scrollHeight<30,detailsHidden:Math.abs(process.getBoundingClientRect().height-processSummary.getBoundingClientRect().height)<3,toggleLeft:toggle.getBoundingClientRect().left<stream.getBoundingClientRect().left,fontDifferent:planStyle.fontSize!==normalStyle.fontSize,colorDifferent:planStyle.color!==normalStyle.color},flow:stream.textContent}})()")
 assert.deepEqual(collapsedExecution.state,{planOpen:true,processOpen:false,toolOpen:false,planAfterUser:true,processAfterPlan:true,singleLine:true,detailsHidden:true,toggleLeft:true,fontDifferent:true,colorDifferent:true})
 assert.match(collapsedExecution.flow,/等待确认工具：修改文件：\{"path":"math\.mjs".*"oldText":"a - b"/)
 await screenshot('agent-process-collapsed')
 assert.match(fs.readFileSync(path.join(workspace,'math.mjs'),'utf8'),/a - b/)
 assert.equal(await js("document.querySelector('.agent-create-project').disabled && !document.querySelector('.agent-project-item').disabled"),true)
 await click('.agent-process>summary')
 await click('.agent-event.tool.waiting>details>summary')
 assert.equal(await js("document.querySelector('.agent-event.tool.waiting>details').open"),true)
 assert.match(await js("document.querySelector('.agent-event.tool.waiting .agent-diff').textContent"),/a \+ b/)
 await screenshot('agent-review')
 await click('[aria-label="设置"]');await click('[aria-label="工作台"]');assert.equal(await js("!!document.querySelector('.agent-approval')"),true,'approval survives tab change')
 await click('.agent-approval .agent-primary');await until(()=>js("document.querySelector('.agent-event.tool.waiting .agent-tool-name')?.textContent==='run_command'"),'command approval')
 assert.match(fs.readFileSync(path.join(workspace,'math.mjs'),'utf8'),/a \+ b/);await screenshot('agent-command')
 await click('.agent-approval .agent-primary');await until(()=>js("document.querySelector('.agent-event.tool.waiting .agent-tool-name')?.textContent==='create_document'"),'document approval')
 assert.equal(fs.existsSync(path.join(workspace,'修复报告.docx')),false);await click('.agent-approval .agent-primary');await until(()=>js("!!document.querySelector('.agent-result')&&!document.querySelector('.agent-approval')"),'completed')
 assert.equal(await js("document.querySelectorAll('.agent-result-files button').length"),2)
 assert.deepEqual(await js("[...document.querySelectorAll('.agent-file-table>header h3')].map(node=>node.textContent)"),['修改文件','已编辑文件'])
 assert.equal(await js("[...document.querySelectorAll('.agent-result-files>button,.agent-edit-list>div')].every(row=>row.getBoundingClientRect().height<=38)"),true,'file table rows stay compact')
 const doc=JSON.parse(await extractDocument(path.join(workspace,'修复报告.docx'),{},new AbortController().signal));assert.match(doc.text,/验证/);assert.match(doc.text,/退出码为 0/)
 await screenshot('agent-completed')
 const tasks=await js("window.myplane.localAiStudio('agentTasks')");assert.equal(tasks.length,1);assert.equal(tasks[0].projectId,project.id);assert.equal(tasks[0].workspace,project.workspace);assert.equal(tasks[0].usage.totalTokens,720);assert.equal(tasks[0].usage.inputTokens,600);assert.equal(tasks[0].usage.outputTokens,120)
 assert.match(await js("document.querySelector('.agent-token-usage').innerText"),/720/)
 await window.reload();await until(()=>js("!!document.querySelector('.agent-result')&&!document.querySelector('.agent-approval')"),'restored task')
 assert.match(await js("document.querySelector('.agent-token-usage').innerText"),/720/)
 assert.match(await js("document.querySelector('.agent-project-item.selected strong').textContent"),/加法工具项目/)
 await click('.agent-new-actions .agent-new');assert.equal(await js("!!document.querySelector('.agent-welcome')"),true)
 assert.equal(await js("document.querySelector('.agent-workspace-picker').title"),project.workspace)
 await submit('再次分析此项目');await until(()=>js("!!document.querySelector('.agent-result')&&!document.querySelector('.agent-approval')"),'new task in saved project')
 const secondFolder=path.join(root,'documents');fs.mkdirSync(secondFolder)
 await createProject(secondFolder,'文档整理项目');assert.equal(await js("document.querySelector('.agent-project-item.selected').closest('.agent-project-group').querySelectorAll('.agent-task-item').length"),0)
 assert.equal(await js("document.querySelectorAll('.agent-task-item').length"),2,'other project tasks remain in their group')
 await window.reload();await until(()=>js("document.querySelector('.agent-project-item.selected strong')?.textContent==='文档整理项目'&&!document.querySelector('.agent-create-project').disabled"),'empty project restored')
 assert.equal(await js("!!document.querySelector('.agent-welcome')"),true)
 await submit('分析文档目录');await until(()=>js("!!document.querySelector('.agent-result')&&!document.querySelector('.agent-approval')"),'second project task')
 assert.equal(await js("document.querySelector('.agent-project-item.selected').closest('.agent-project-group').querySelectorAll('.agent-task-item').length"),1)
 await click('.agent-all-projects');assert.equal(await js("document.querySelectorAll('.agent-task-item').length"),3)
 assert.deepEqual(await js("[...document.querySelectorAll('.agent-project-group')].map(group=>({name:group.querySelector('.agent-project-item strong').textContent,count:group.querySelector('.agent-project-item small').textContent,tasks:[...group.querySelectorAll('.agent-task-item strong')].map(el=>el.textContent)}))"),[
  {name:'文档整理项目',count:'1',tasks:['分析文档目录']},
  {name:'加法工具项目',count:'2',tasks:['再次分析此项目','修复加法函数，运行验证，并生成 Word 报告。']}
 ])
 await click('.agent-project-group .agent-project-item')
 assert.equal(await js("document.querySelector('.agent-project-item').getAttribute('aria-expanded')"),'false')
 assert.equal(await js("getComputedStyle(document.querySelector('.agent-task-list')).display"),'none')
 assert.equal(await js("document.querySelectorAll('.agent-project-item.selected').length"),0,'collapse does not change workspace')
 await click('.agent-project-group .agent-project-item')
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[cancelledFolder]});await click('.agent-workspace-picker')
 await until(()=>js("!document.querySelector('.agent-workspace-picker').disabled"),'directory project');dialog.showOpenDialog=originalDialog
 await submit('整理独立目录');await until(()=>js("!!document.querySelector('.agent-result')&&!document.querySelector('.agent-approval')"),'standalone task')
 assert.equal(await js("document.querySelector('.agent-project-item.selected strong').textContent"),'cancelled')
 assert.equal(await js("document.querySelector('.agent-task-item.selected').closest('.agent-project-group').querySelector('.agent-project-item strong').textContent"),'cancelled')
 assert.equal(await js("document.querySelectorAll('.agent-project-group[data-project-id=\"\"]').length"),0,'directory tasks are not unclassified')
 assert.equal(await js("document.querySelectorAll('.agent-task-item').length"),4,'each task appears exactly once')
 await screenshot('agent-project-groups')
 await js("[...document.querySelectorAll('.agent-project-item')].find(el=>el.querySelector('strong').textContent==='加法工具项目').closest('.agent-project-group').querySelector('.agent-task-item').click()")
 assert.equal(await js("document.querySelector('.agent-project-item.selected').closest('.agent-project-group').querySelectorAll('.agent-task-item').length"),2)
 assert.equal(await js("document.querySelector('.agent-workspace-picker').title"),project.workspace)
 await js(`document.querySelector('.agent-project-item.selected').closest('.agent-project-group').querySelectorAll('.agent-task-item')[1].click()`);await until(()=>js("document.querySelectorAll('.agent-result-files button').length===2"),'original project task')
 for(const [width,height] of [[520,640],[760,720],[1280,900]]){
  window.setContentSize(width,height);await delay(250)
  const bounds=await js("(()=>{const main=document.querySelector('.agent-workspace').getBoundingClientRect(),prompt=document.querySelector('.agent-prompt').getBoundingClientRect(),scroll=document.querySelector('.agent-scroll').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,fit:main.right<=innerWidth+1,prompt:prompt.bottom<=document.querySelector('.status-bar').getBoundingClientRect().top+1,scroll:scroll.height>50}})()")
  assert.deepEqual(bounds,{overflow:false,fit:true,prompt:true,scroll:true});if(width===520){await click('.agent-history-toggle');await screenshot('agent-project-narrow');assert.equal(await js("document.querySelector('.agent-create-project').getBoundingClientRect().right<=innerWidth"),true);await click('.agent-history-close');assert.equal(await js("document.querySelector('.agent-history').classList.contains('expanded')"),false);await screenshot('agent-narrow')}
 }
 await click('[aria-label="设置"]');await js("(()=>{const select=[...document.querySelectorAll('.settings-page select')].find(el=>[...el.options].some(option=>option.value==='dark'));select.value='dark';select.dispatchEvent(new Event('change',{bubbles:true}))})()");await click('[aria-label="工作台"]');await screenshot('agent-dark')
 const legacyFolder=path.join(root,'web');fs.mkdirSync(legacyFolder)
 const legacyId=randomUUID(),legacyTime=new Date().toISOString()
 fs.writeFileSync(path.join(root,'data','local-ai-agent-tasks',legacyId+'.json'),JSON.stringify({id:legacyId,title:'旧版 web 任务',workspace:fs.realpathSync(legacyFolder),mode:'coding',model:'agent-fixture',status:'failed',steps:1,maxSteps:10,plan:[],events:[],artifacts:[],messages:[],error:'TimeoutError',createdAt:legacyTime,updatedAt:legacyTime}))
 await js("window.myplane.localAiStudio('agentTasks')");await window.reload()
 await until(()=>js("[...document.querySelectorAll('.agent-project-item strong')].some(el=>el.textContent==='web')&&!document.querySelector('.agent-create-project').disabled"),'legacy workspace project migration')
 await js("[...document.querySelectorAll('.agent-task-item')].find(el=>el.querySelector('strong').textContent==='旧版 web 任务').click()")
 await until(()=>js("document.querySelector('.workspace-heading>strong')?.textContent==='旧版 web 任务'"),'legacy web task opened')
 assert.equal(await js("document.querySelector('.agent-workspace-picker span').textContent"),'web')
 assert.equal(await js("document.querySelector('.agent-task-item.selected').closest('.agent-project-group').querySelector('.agent-project-item strong').textContent"),'web')
 assert.equal(await js("document.querySelectorAll('.agent-project-group[data-project-id=\"\"]').length"),0)
 await screenshot('agent-legacy-web-project')
 legacyProjectApi=true;await window.reload();await until(()=>js("!!document.querySelector('.agent-error')"),'older backend notice')
 assert.match(await js("document.querySelector('.agent-error p').textContent"),/完全退出 MyPlane/)
 assert.equal(await js("document.querySelector('.agent-error details').open"),false)
 await screenshot('agent-update-notice')
 assert.equal(errors.length,0,errors.join('\n'))
 console.log(JSON.stringify({ok:true,requests,checks:['authenticated IPC and native workspace grant','project creation and folder deduplication','project persistence and empty project restore','new task inherits saved project folder','task history grouped by project with counts','collapse groups without changing workspace','directory tasks automatically join projects without duplicates','streamed thinking progress','multi-step model loop','file diff approval','command approval and test output','Word artifact','tab navigation','task restore','520/760/1280px layouts and visible welcome cards','model settings and Escape dismissal','friendly old-backend notice','dark theme'],screenshots:root}))
}catch(error){console.error(error);process.exitCode=1}finally{dialog.showOpenDialog=originalDialog;window?.destroy();service?.dispose();if(server){server.closeAllConnections();server.close()}app.exit(process.exitCode||0)}}
void main()
