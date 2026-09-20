import {ipcMain,type IpcMainInvokeEvent,type WebContents} from 'electron'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const rendererFile=pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../dist/index.html')).href
const trustedWindows=new Map<number,(url:string)=>boolean>()

// This standalone application uses the OS user session. Only its registered
// top-level renderer may call privileged IPC; remote pages and frames cannot.
export function trackAuthWindow(contents:WebContents,enabled=false,developmentOrigin?:string){
 if(!enabled)return
 const origin=developmentOrigin?new URL(developmentOrigin).origin:undefined
 trustedWindows.set(contents.id,url=>{
  try{const parsed=new URL(url);return origin?parsed.origin===origin:parsed.protocol==='file:'&&parsed.href.split(/[?#]/)[0]===rendererFile}catch{return false}
 })
 contents.once('destroyed',()=>trustedWindows.delete(contents.id))
}
export function protectedHandle(channel:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>any,_outsideResourceBoundary=false){
 ipcMain.handle(channel,(event,...args)=>{
  const trusted=trustedWindows.get(event.sender.id)
  if(!trusted||event.senderFrame!==event.sender.mainFrame||!trusted(event.senderFrame.url))throw new Error('此窗口无权访问本地 AI 服务')
  return handler(event,...args)
 })
}
