import {app,BrowserWindow,dialog,Menu,nativeTheme,shell} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {LocalAiStudioService,registerLocalAiStudio} from './local-ai-studio.js'
import {protectedHandle,trackAuthWindow} from './auth.js'

const directory=path.dirname(fileURLToPath(import.meta.url))
app.setName('MyPlaneAgent')
const dataDirectory=process.env.MYPLANE_AGENT_DATA_DIR?path.resolve(process.env.MYPLANE_AGENT_DATA_DIR):path.join(app.getPath('appData'),'myplane-agent')
fs.mkdirSync(dataDirectory,{recursive:true})
app.setPath('userData',dataDirectory)
const developmentUrl=!app.isPackaged?process.env.VITE_DEV_SERVER_URL:undefined
const appIcon=path.join(directory,developmentUrl?'../../public/myplane-icon.png':'../../dist/myplane-icon.png')
let window:BrowserWindow|undefined
let service:LocalAiStudioService|undefined
function focus(){if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus()}}
async function createWindow(){
 if(window&&!window.isDestroyed()){focus();return}
 const next=new BrowserWindow({title:'MyPlaneAgent',width:1380,height:900,minWidth:520,minHeight:540,show:false,backgroundColor:nativeTheme.shouldUseDarkColors?'#181b1a':'#f5f8f6',icon:appIcon,webPreferences:{preload:path.join(directory,'../preload/index.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
 window=next
 next.on('closed',()=>{if(window===next)window=undefined})
 next.webContents.setWindowOpenHandler(()=>({action:'deny'}))
 next.webContents.on('will-navigate',event=>event.preventDefault())
 next.webContents.on('will-attach-webview',event=>event.preventDefault())
 trackAuthWindow(next.webContents,true,developmentUrl)
 if(developmentUrl)await next.loadURL(developmentUrl)
 else await next.loadFile(path.join(directory,'../../dist/index.html'))
 next.show()
}

if(!app.requestSingleInstanceLock())app.quit()
else{
 app.on('second-instance',()=>{if(window)focus();else void createWindow()})
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()})
 app.whenReady().then(async()=>{
  if(process.platform==='darwin')app.dock?.setIcon(appIcon)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   ...(process.platform==='darwin'?[{role:'appMenu' as const}]:[]),
   {role:'fileMenu'},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'},
  ]))
  service=new LocalAiStudioService(dataDirectory)
  registerLocalAiStudio(()=>service!,()=>service?.dispose())
  protectedHandle('ai:open-link',async(_event,value:unknown)=>{
   if(typeof value!=='string'||value.length>8000)throw new Error('链接无效')
   const url=new URL(value)
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持无认证信息的 HTTP / HTTPS 链接')
   await shell.openExternal(url.href)
  })
  await createWindow()
  app.on('activate',()=>{void createWindow()})
 }).catch(error=>{console.error(error);dialog.showErrorBox('MyPlaneAgent 启动失败',String(error));app.quit()})
}
