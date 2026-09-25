import {configureBrowserPlugin} from './browser-plugin.js'
import {InternalBrowser} from './internal-browser.js'
import {app,BrowserWindow,dialog,Menu,nativeTheme,shell,Tray,type MenuItemConstructorOptions} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {LocalAiStudioService,registerLocalAiStudio} from './local-ai-studio.js'
import {protectedHandle,trackAuthWindow} from './auth.js'
import {ApplicationLogger} from './application-logger.js'

const directory=path.dirname(fileURLToPath(import.meta.url))
app.setName('MyPlaneAgent')
const dataDirectory=process.env.MYPLANE_AGENT_DATA_DIR?path.resolve(process.env.MYPLANE_AGENT_DATA_DIR):path.join(app.getPath('appData'),'myplane-agent')
fs.mkdirSync(dataDirectory,{recursive:true})
app.setPath('userData',dataDirectory)
const logger=new ApplicationLogger(dataDirectory)
const developmentUrl=!app.isPackaged?process.env.VITE_DEV_SERVER_URL:undefined
const appIcon=path.join(directory,developmentUrl?'../../public/myplane-icon.png':'../../dist/myplane-icon.png')
const browser=new InternalBrowser(directory,developmentUrl)
configureBrowserPlugin(browser)
let window:BrowserWindow|undefined
let workflowEditorWindow:BrowserWindow|undefined
let helpWindow:BrowserWindow|undefined
let service:LocalAiStudioService|undefined
let tray:Tray|undefined
function focus(){if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus()}}
function installApplicationMenu(){
 const template:MenuItemConstructorOptions[]=[
  ...(process.platform==='darwin'?[{
   label:app.name,
   submenu:[
    {label:`关于 ${app.name}`,click:()=>showAbout()},
    {type:'separator' as const},
    {role:'services' as const},
    {type:'separator' as const},
    {label:`隐藏 ${app.name}`,role:'hide' as const},{label:'隐藏其他',role:'hideOthers' as const},{label:'全部显示',role:'unhide' as const},
    {type:'separator' as const},
    {label:`退出 ${app.name}`,role:'quit' as const},
   ],
  }]:[]),
  {label:'文件',submenu:[
   {label:'关闭窗体',role:'close',accelerator:'CmdOrCtrl+W'},
   {type:'separator'},
   {label:'退出',role:'quit',accelerator:process.platform==='darwin'?'Cmd+Q':'Alt+F4'},
  ]},
  {label:'编辑',submenu:[
   {label:'撤销',role:'undo',accelerator:'CmdOrCtrl+Z'},{label:'重做',role:'redo',accelerator:process.platform==='darwin'?'Shift+Cmd+Z':'Ctrl+Y'},
   {type:'separator'},
   {label:'剪切',role:'cut',accelerator:'CmdOrCtrl+X'},{label:'复制',role:'copy',accelerator:'CmdOrCtrl+C'},{label:'粘贴',role:'paste',accelerator:'CmdOrCtrl+V'},
   {type:'separator'},
   {label:'全选',role:'selectAll',accelerator:'CmdOrCtrl+A'},
  ]},
  {label:'视图',submenu:[
   {label:'内置浏览器',click:()=>void browser.open().catch(error=>logger.error('browser','无法打开浏览器',error))},
   {label:'重新加载',role:'reload',accelerator:'CmdOrCtrl+R'},{label:'强制重新加载',role:'forceReload',accelerator:'CmdOrCtrl+Shift+R'},
   ...(!app.isPackaged?[{label:'开发者工具',role:'toggleDevTools' as const,accelerator:process.platform==='darwin'?'Alt+Cmd+I':'Ctrl+Shift+I'}]:[]),
   {type:'separator'},
   {id:'toggle-log-output',label:'日志输出',accelerator:'CmdOrCtrl+Shift+L',click:()=>window?.webContents.send('app:toggle-log-output')},
   {type:'separator'},
   {label:'实际大小',role:'resetZoom',accelerator:'CmdOrCtrl+0'},{label:'放大',role:'zoomIn',accelerator:'CmdOrCtrl+Plus'},{label:'缩小',role:'zoomOut',accelerator:'CmdOrCtrl+-'},
   {type:'separator'},
   {label:'切换全屏',role:'togglefullscreen',accelerator:process.platform==='darwin'?'Ctrl+Cmd+F':'F11'},
  ]},
  {label:'窗体',submenu:[
   {label:'最小化',role:'minimize',accelerator:'CmdOrCtrl+M'},{label:'缩放',role:'zoom'},
   ...(process.platform==='darwin'?[{type:'separator' as const},{label:'前置全部窗体',role:'front' as const}]:[]),
  ]},
  {label:'帮助',submenu:[
   {label:'工作流使用指南',click:()=>void openHelpDocument().catch(error=>logger.error('help','打开帮助失败',error))},
   {type:'separator'},
   {label:'打开日志目录',click:async()=>{const error=await shell.openPath(logger.directory);if(error)logger.warn('menu','无法打开日志目录',error)}},
   {type:'separator'},
   {label:`关于 ${app.name}`,click:()=>showAbout()},
  ]},
 ]
 Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
function showAbout(){
 const options={type:'info' as const,title:`关于 ${app.name}`,message:app.name,detail:`版本 ${app.getVersion()}\n本地 AI 与 Agent 桌面工作区。`,buttons:['确定']}
 const activeWindow=BrowserWindow.getFocusedWindow()
 if(activeWindow)void dialog.showMessageBox(activeWindow,options)
 else void dialog.showMessageBox(options)
}
async function createWindow(){
 if(window&&!window.isDestroyed()){focus();return}
 const next=new BrowserWindow({title:'MyPlaneAgent',width:1380,height:900,minWidth:520,minHeight:540,show:false,backgroundColor:nativeTheme.shouldUseDarkColors?'#181b1a':'#f5f8f6',icon:appIcon,webPreferences:{preload:path.join(directory,'../preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
 window=next
 logger.info('window','创建主窗体')
 next.on('closed',()=>{logger.info('window','主窗体已关闭');if(window===next)window=undefined})
 next.on('unresponsive',()=>logger.warn('window','主窗体无响应'))
 next.webContents.setWindowOpenHandler(()=>({action:'deny'}))
 next.webContents.on('will-navigate',event=>event.preventDefault())
 next.webContents.on('will-attach-webview',event=>event.preventDefault())
 next.webContents.on('console-message',event=>{if(event.level==='error')logger.error('renderer',event.message,{source:event.sourceId,line:event.lineNumber});else if(event.level==='warning')logger.warn('renderer',event.message,{source:event.sourceId,line:event.lineNumber})})
 next.webContents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{if(isMainFrame)logger.error('renderer','页面加载失败',{code,description,url})})
 next.webContents.on('render-process-gone',(_event,details)=>logger.error('renderer','渲染进程已退出',details))
 trackAuthWindow(next.webContents,true,developmentUrl)
 if(developmentUrl)await next.loadURL(developmentUrl)
 else await next.loadFile(path.join(directory,'../../dist/index.html'))
 next.show()
}
async function openWorkflowEditor(workflowId=''){
 if(workflowId.length>200)throw new Error('工作流标识无效')
 if(workflowEditorWindow&&!workflowEditorWindow.isDestroyed()){
  workflowEditorWindow.show();workflowEditorWindow.focus()
  const currentId=new URL(workflowEditorWindow.webContents.getURL()).searchParams.get('workflowId')||''
  if(currentId===workflowId)return
  workflowEditorWindow.close()
 }
 const editor=new BrowserWindow({title:workflowId?'编辑工作流':'新建工作流',width:1320,height:850,minWidth:960,minHeight:640,show:false,backgroundColor:'#eef3f0',icon:appIcon,webPreferences:{preload:path.join(directory,'../preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
 workflowEditorWindow=editor
 logger.info('window',workflowId?'打开工作流编辑窗体':'打开新建工作流窗体',{workflowId})
 editor.on('closed',()=>{if(workflowEditorWindow===editor)workflowEditorWindow=undefined;window?.webContents.send('workflow:saved')})
 editor.webContents.setWindowOpenHandler(()=>({action:'deny'}))
 editor.webContents.on('will-navigate',event=>event.preventDefault())
 editor.webContents.on('will-attach-webview',event=>event.preventDefault())
 editor.webContents.on('console-message',event=>{if(event.level==='error')logger.error('workflow-editor',event.message,{source:event.sourceId,line:event.lineNumber});else if(event.level==='warning')logger.warn('workflow-editor',event.message,{source:event.sourceId,line:event.lineNumber})})
 editor.webContents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{if(isMainFrame)logger.error('workflow-editor','页面加载失败',{code,description,url})})
 editor.webContents.on('render-process-gone',(_event,details)=>logger.error('workflow-editor','渲染进程已退出',details))
 trackAuthWindow(editor.webContents,true,developmentUrl)
 if(developmentUrl){const url=new URL(developmentUrl);url.searchParams.set('surface','workflow-editor');if(workflowId)url.searchParams.set('workflowId',workflowId);await editor.loadURL(url.href)}
 else await editor.loadFile(path.join(directory,'../../dist/index.html'),{query:{surface:'workflow-editor',...(workflowId?{workflowId}:{})}})
 editor.show();editor.focus()
}

async function openHelpDocument(documentId='workflow'){
 if(documentId!=='workflow')throw new Error('帮助文档不存在')
 if(helpWindow&&!helpWindow.isDestroyed()){
  if(helpWindow.isMinimized())helpWindow.restore()
  helpWindow.show();helpWindow.focus();return
 }
 const next=new BrowserWindow({title:'工作流使用指南 · MyPlaneAgent',width:1160,height:840,minWidth:760,minHeight:560,show:false,backgroundColor:'#f7faf8',icon:appIcon,webPreferences:{preload:path.join(directory,'../preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
 helpWindow=next
 next.on('closed',()=>{if(helpWindow===next)helpWindow=undefined})
 next.webContents.setWindowOpenHandler(()=>({action:'deny'}))
 next.webContents.on('will-navigate',event=>event.preventDefault())
 next.webContents.on('will-attach-webview',event=>event.preventDefault())
 next.webContents.on('console-message',event=>{if(event.level==='error')logger.error('help',event.message)})
 trackAuthWindow(next.webContents,true,developmentUrl)
 try{
  if(developmentUrl){const url=new URL(developmentUrl);url.searchParams.set('surface','help');url.searchParams.set('document',documentId);await next.loadURL(url.href)}
  else await next.loadFile(path.join(directory,'../../dist/index.html'),{query:{surface:'help',document:documentId}})
  next.show();next.focus()
 }catch(error){if(!next.isDestroyed())next.destroy();throw error}
}

process.on('uncaughtExceptionMonitor',error=>logger.error('process','未捕获异常',error))
process.on('unhandledRejection',reason=>logger.error('process','未处理的 Promise 拒绝',reason))
logger.info('app','应用启动',{version:app.getVersion(),platform:process.platform,arch:process.arch,packaged:app.isPackaged})
if(process.env.MYPLANE_AGENT_TEST_MODE!=='1'&&!app.requestSingleInstanceLock()){logger.info('app','已有实例正在运行，当前实例退出');app.quit()}
else{
 app.on('second-instance',()=>{logger.info('app','收到第二实例启动请求');if(window)focus();else void createWindow()})
 app.on('window-all-closed',()=>{if(process.platform!=='darwin'&&!service?.hasEnabledAutomations())app.quit()})
 app.on('before-quit',()=>logger.info('app','应用准备退出'))
 app.whenReady().then(async()=>{
  if(process.platform==='darwin')app.dock?.setIcon(appIcon)
  installApplicationMenu()
  service=new LocalAiStudioService(dataDirectory,(level,scope,message)=>logger[level](scope,message))
  if(process.platform!=='darwin'){
   tray=new Tray(appIcon);tray.setToolTip(app.name);tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 MyPlaneAgent',click:()=>void createWindow()},{type:'separator'},{label:'退出',role:'quit'}]));tray.on('click',()=>void createWindow())
  }
  registerLocalAiStudio(()=>service!,()=>service?.dispose())
  protectedHandle('browser:action',(event,action,value)=>browser.action(event.sender,action,value))
  protectedHandle('ai:open-link',async(_event,value:unknown)=>{
   if(typeof value!=='string'||value.length>8000)throw new Error('链接无效')
   const url=new URL(value)
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持无认证信息的 HTTP / HTTPS 链接')
   await browser.open(url.href)
  })
  protectedHandle('workflow:open-editor',async(_event,value:unknown)=>{
   if(value!==undefined&&typeof value!=='string')throw new Error('工作流标识无效')
   await openWorkflowEditor(typeof value==='string'?value:'')
  })
  protectedHandle('help:open-document',async(_event,value:unknown)=>{
   if(value!==undefined&&value!=='workflow')throw new Error('帮助文档不存在')
   await openHelpDocument('workflow')
  })
  protectedHandle('workflow:editor-close',async event=>{const owner=BrowserWindow.fromWebContents(event.sender);if(owner&&owner===workflowEditorWindow)setTimeout(()=>{if(!owner.isDestroyed())owner.close()},0)})
  protectedHandle('workflow:editor-saved',async(_event,value:unknown)=>{
   if(typeof value!=='string'||value.length>200)throw new Error('工作流标识无效')
   window?.webContents.send('workflow:saved',value)
  })
  protectedHandle('app:logs',async(_event,action:unknown,input:unknown)=>{
   if(action==='read')return {entries:logger.entries(typeof input==='number'?input:1000),directory:logger.directory}
   if(action==='clear'){logger.clear();logger.info('logs','应用日志已清空');return {entries:logger.entries(),directory:logger.directory}}
   if(action==='openDirectory'){const error=await shell.openPath(logger.directory);if(error)throw new Error(error);return {entries:[],directory:logger.directory}}
   throw new Error('不支持的日志操作')
  })
  await createWindow()
  app.on('activate',()=>{void createWindow()})
 }).catch(error=>{logger.error('app','应用启动失败',error);console.error(error);dialog.showErrorBox('MyPlaneAgent 启动失败',String(error));app.quit()})
}
