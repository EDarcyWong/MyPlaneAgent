import {app,BrowserWindow,Menu} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {windowChrome,registerTitleMenu} from '../dist-electron/main/window-chrome.js'
import {trackAuthWindow,protectedHandle} from '../dist-electron/main/auth.js'
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'myplane-titlebar-')))
app.disableHardwareAcceleration()
async function main(){
await app.whenReady()
const deadline=setTimeout(()=>{console.error('titlebar smoke timed out');app.exit(1)},30000)
console.log('titlebar app ready')
let win
try{
 Menu.setApplicationMenu(Menu.buildFromTemplate(['文件','编辑','视图','窗体','帮助'].map(label=>({label,submenu:[{label:'测试菜单项'}]}))))
 registerTitleMenu()
 protectedHandle('browser:action',()=>({automationEnabled:false,url:'',title:'',loading:false,canGoBack:false,canGoForward:false,error:''}))
 win=new BrowserWindow({...windowChrome(),width:1100,height:750,webPreferences:{preload:path.resolve('dist-electron/preload/index.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}})
 trackAuthWindow(win.webContents,true)
 await win.loadFile(path.resolve('dist/index.html'),{query:{surface:'browser'}})
 console.log('titlebar loaded')
 for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript("!!document.querySelector('.internal-browser')"))break;await new Promise(r=>setTimeout(r,30))}
 assert.deepEqual(await win.webContents.executeJavaScript("[...document.querySelectorAll('.desktop-titlebar button')].map(b=>b.textContent)"),['文件','编辑','视图','窗体','帮助'])
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('.desktop-titlebar').getBoundingClientRect().top"),0)
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('.internal-browser').getBoundingClientRect().top"),36)
 const menu=Menu.getApplicationMenu().items[0].submenu
 console.log('titlebar bounds passed')
  setTimeout(()=>menu.closePopup(win),200)
 await win.webContents.executeJavaScript("document.querySelector('.desktop-titlebar button').click()")
 menu.closePopup(win)
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('.desktop-titlebar [role=alert]')?.textContent||''"),'')
 await assert.rejects(win.webContents.executeJavaScript("window.myplane.showTitleMenu('unknown',0)"))
 fs.writeFileSync(path.resolve('tests/artifacts/titlebar.png'),(await win.webContents.capturePage()).toPNG())
 console.log('PASS: integrated title menu, native popup and content bounds')
}catch(error){console.error(error);process.exitCode=1}finally{clearTimeout(deadline);win?.destroy();app.exit(process.exitCode||0)}
}
void main()
