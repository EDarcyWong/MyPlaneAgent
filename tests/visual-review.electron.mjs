import {app,BrowserWindow} from 'electron'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'myplane-visual-card-')))
app.disableHardwareAcceleration()
const item={id:'glass',title:'核对整体任务结果',acceptance:'对照用户原始目标核对结果并执行必要的集成验证',completionReview:{status:'needs_input',reason:'当前模型不能识图',nextStep:'请用户查看已保存截图',missingEvidence:['画面渲染正确性的视觉证据','性能验收证据']},status:'blocked',outcome:'needs_input',evidenceIds:['shot'],attempts:1,summary:''}
const picture='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="260"><rect width="800" height="260" fill="#e9edef"/><rect x="210" y="25" width="380" height="200" fill="#bcdce2" stroke="#444" stroke-width="6"/><path d="M400 25V225M210 90H590" stroke="#444" stroke-width="6"/><text x="25" y="245" font-size="16">Visual review test fixture</text></svg>').toString('base64')
const messages=[{role:'assistant',toolActivity:[{id:'shot',capability:'browser.screenshot',status:'complete',args:{},output:JSON.stringify({url:'http://127.0.0.1:51479/',imageHash:'a'.repeat(64),capturedAt:'2026-09-27T12:00:00Z'}),images:[{name:'fixture',dataUrl:picture}]}]}]
async function main(){
let server,win
const timeout=setTimeout(()=>{console.error('Visual card smoke timed out');app.exit(1)},60000)
try{
 await app.whenReady()
 server=await createServer({configFile:false,root:process.cwd(),plugins:[vue(),{name:'visual-card-fixture',configureServer(server){server.middlewares.use('/visual-card-test.html',(_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><body><div id="app"></div><script type="module" src="/@visual-card-fixture.js"></script></body></html>')})},resolveId(id){if(id==='/@visual-card-fixture.js')return id},load(id){if(id==='/@visual-card-fixture.js')return `import {createApp,reactive,h} from '/node_modules/.vite/deps/vue.js';import Card from '/src/local-ai/VisualReviewCard.vue';import '/node_modules/element-plus/dist/index.css';window.choices=[];window.state=reactive({item:${JSON.stringify(item)},messages:${JSON.stringify(messages)},disabled:false});document.body.style.cssText='margin:24px;background:#f5f6f7;--s-panel:white;--s-bg:white;--s-text:#20252a;--s-dim:#667079;--s-border:#d8dce0;--s-muted:#f1f3f5;--s-accent:#2869bd;--s-on-accent:white;font-family:Arial';createApp({render:()=>h(Card,{...window.state,onDecide:value=>window.choices.push(value)})}).mount('#app');`}}],server:{host:'127.0.0.1',port:0},optimizeDeps:{include:['vue','element-plus']}})
 await server.listen()
 win=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{contextIsolation:true,sandbox:true}})
 await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/visual-card-test.html`)
 const js=code=>win.webContents.executeJavaScript(code)
 for(let i=0;i<150;i++){if(await js("!!document.querySelector('.visual-review footer')"))break;await new Promise(resolve=>setTimeout(resolve,100))}
 assert.equal(await js("!!document.querySelector('.visual-review img')"),true)
 assert.equal(await js("document.querySelector('.preview').getBoundingClientRect().width<=280"),true)
 assert.equal(await js("document.querySelector('.preview').getBoundingClientRect().height<=158"),true)
 assert.equal(await js("document.querySelector('.visual-review .links details').open"),false)
 await js("document.querySelector('.preview').click()")
 await new Promise(resolve=>setTimeout(resolve,300))
 assert.equal(await js("!!document.querySelector('.el-dialog .enlarged')"),true)
 await js("document.querySelector('.el-dialog__headerbtn').click()")
 await js("document.querySelector('.feedback').open=true;document.querySelector('textarea').value='门头仍为实墙';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));")
 await js("document.querySelectorAll('.visual-review footer button')[1].click()")
 assert.deepEqual(await js('window.choices[0]'),{itemId:'glass',activityId:'shot',imageHash:'a'.repeat(64),decision:'reject',note:'门头仍为实墙'})
 await js('window.state.disabled=true');await new Promise(resolve=>setTimeout(resolve,30))
 assert.equal(await js("[...document.querySelectorAll('.visual-review footer button')].every(button=>button.disabled)"),true)
 await js('window.state.disabled=false');await new Promise(resolve=>setTimeout(resolve,30))
 await js("document.querySelectorAll('.visual-review footer button')[0].click();document.querySelectorAll('.visual-review footer button')[2].click()")
 assert.deepEqual(await js('window.choices.map(value=>value.decision)'),['reject','accept','recapture'])
 await js("document.querySelector('.feedback').open=false");await new Promise(resolve=>setTimeout(resolve,30))
 assert.equal(await js("document.querySelector('.visual-review footer').getBoundingClientRect().bottom<=window.innerHeight"),true)
 fs.writeFileSync(path.resolve('tests/artifacts/visual-review-card.png'),(await win.webContents.capturePage()).toPNG())
 console.log('PASS: visual card screenshot, enlarge, structured buttons, note, busy state and collapsed details')
}catch(error){console.error(error);process.exitCode=1}finally{clearTimeout(timeout);win?.destroy();await server?.close();app.exit(process.exitCode||0)}

}
void main()
