import {browserPointerScript} from './browser-pointer.js'
import {randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {app} from 'electron'
import {BrowserWindow,WebContentsView,session,shell,type WebContents} from 'electron'
import path from 'node:path'
import {browserUrl,type BrowserAction,type BrowserState} from '../shared/browser.js'
import {trackAuthWindow} from './auth.js'
async function browserOperation<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
 signal.throwIfAborted()
 let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{}
 try{return await Promise.race([work(),new Promise<never>((_resolve,reject)=>{
  abort=()=>reject(signal.reason||new Error('操作已取消'));signal.addEventListener('abort',abort,{once:true})
  if(signal.aborted)abort()
  timer=setTimeout(()=>reject(new Error('浏览器操作超时，结果未确认；请重新读取网页核验，不要重复提交。')),30000)
 })])}finally{clearTimeout(timer);signal.removeEventListener('abort',abort)}
}
export class InternalBrowser{
 private window?:BrowserWindow
 private view?:WebContentsView
 private requestedUrl=''
 private automationEnabled=false
 private snapshotToken=''
 private snapshotUrl=''
 private readonly pluginFile=path.join(app.getPath('userData'),'browser-plugin.json')
 private error=''
 private ready?:Promise<void>
 constructor(private directory:string,private developmentUrl?:string){try{this.automationEnabled=JSON.parse(readFileSync(this.pluginFile,'utf8')).enabled===true}catch{/* Disabled by default. */}}
 isAutomationEnabled(){return this.automationEnabled}
 snapshot():BrowserState{
  const wc=this.view?.webContents
  return {automationEnabled:this.automationEnabled,url:wc&&!wc.isDestroyed()?((this.error||wc.isLoading()?this.requestedUrl:'')||wc.getURL().replace(/^about:blank$/,'')):'',title:wc&&!wc.isDestroyed()?wc.getTitle():'',loading:wc&&!wc.isDestroyed()?wc.isLoading():false,canGoBack:!!wc&&!wc.isDestroyed()&&wc.navigationHistory.canGoBack(),canGoForward:!!wc&&!wc.isDestroyed()&&wc.navigationHistory.canGoForward(),error:this.error}
 }
 private publish(){if(this.window&&!this.window.isDestroyed())this.window.webContents.send('browser:state',this.snapshot())}
 async open(value?:unknown){
  const url=value===undefined||value===''?'':browserUrl(value)
  if(!this.window||this.window.isDestroyed()){
   const window=new BrowserWindow({title:'内置浏览器 · MyPlaneAgent',width:1180,height:820,minWidth:520,minHeight:420,show:false,webPreferences:{preload:path.join(this.directory,'../preload/index.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}})
   this.window=window;this.error='';this.requestedUrl=''
   trackAuthWindow(window.webContents,true,this.developmentUrl)
   window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
   window.webContents.on('will-navigate',event=>event.preventDefault())
   window.webContents.on('will-attach-webview',event=>event.preventDefault())
   const isolated=session.fromPartition('persist:internal-browser')
   isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
   isolated.setPermissionCheckHandler(()=>false)
   const view=new WebContentsView({webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}})
   this.view=view;window.contentView.addChildView(view);view.setVisible(false)
   const resize=()=>{if(window.isDestroyed())return;const [width,height]=window.getContentSize();view.setBounds({x:0,y:92,width,height:Math.max(0,height-92)})}
   window.on('resize',resize);resize()
   const wc=view.webContents
   const guard=(event:Electron.Event,target:string)=>{try{browserUrl(target)}catch{event.preventDefault()}}
   wc.on('will-navigate',guard);wc.on('will-redirect',guard)
   wc.setWindowOpenHandler(({url})=>{try{void this.navigate(browserUrl(url))}catch{/* Block non-web popups. */}return {action:'deny'}})
   wc.on('will-attach-webview',event=>event.preventDefault())
   wc.on('did-start-loading',()=>{this.snapshotToken='';this.error='';view.setVisible(true);this.publish()})
   wc.on('did-stop-loading',()=>this.publish());wc.on('did-navigate',()=>{this.requestedUrl=wc.getURL();this.publish()});wc.on('did-navigate-in-page',()=>this.publish());wc.on('page-title-updated',()=>this.publish())
   wc.on('before-input-event',(event,input)=>{if((input.control||input.meta)&&input.key.toLowerCase()==='l'){event.preventDefault();window.webContents.focus();void window.webContents.executeJavaScript("document.querySelector('input')?.focus();document.querySelector('input')?.select()").catch(()=>{})}})
   wc.on('did-fail-load',(_event,code,description,_url,mainFrame)=>{if(!mainFrame||code===-3)return;this.error='网页加载失败：'+description;view.setVisible(false);this.publish()})
   wc.on('render-process-gone',()=>{this.error='网页进程已停止，请刷新重试。';view.setVisible(false);this.publish()})
   window.on('closed',()=>{if(!wc.isDestroyed())wc.close();if(this.window===window){this.window=undefined;this.view=undefined;this.ready=undefined}})
   this.ready=(async()=>{
    if(this.developmentUrl){const target=new URL(this.developmentUrl);target.searchParams.set('surface','browser');await window.loadURL(target.href)}
    else await window.loadFile(path.join(this.directory,'../../dist/index.html'),{query:{surface:'browser'}})
   })()
  }
  try{await this.ready}catch(error){this.window?.destroy();throw error}
  if(this.window?.isMinimized())this.window.restore()
  this.window?.show();this.window?.focus()
  if(url)void this.navigate(url)
  return this.snapshot()
 }
 private async navigate(url:string){
  const wc=this.view?.webContents;if(!wc||wc.isDestroyed())return
  this.error='';this.requestedUrl=url
  try{await wc.loadURL(url)}catch(error){if(!wc.isDestroyed()&&!String(error).includes('ERR_ABORTED')){this.error=String(error);this.view?.setVisible(false);this.publish()}}
 }
 async automate(operation:string,args:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{
  signal.throwIfAborted()
  if(!this.automationEnabled)throw new Error('浏览器自动化插件未启用')
  if(operation==='open'){
   const url=browserUrl(args.url);await this.open();signal.throwIfAborted()
   if(!this.automationEnabled)throw new Error('插件已停用')
   await browserOperation(signal,()=>this.navigate(url));signal.throwIfAborted();return this.snapshot()
  }
  const wc=this.view?.webContents
  if(!wc||wc.isDestroyed()||!wc.getURL()||this.error)throw new Error('请先在内置浏览器打开网页')
  browserUrl(wc.getURL())
  if(operation==='inspect'){
   if(args.url!==wc.getURL())throw new Error('页面已变化，请重新读取')
   if(typeof args.selector!=='string'||!args.selector.trim()||args.selector.length>500)throw new Error('CSS 选择器无效')
   const url=wc.getURL()
   const result=await browserOperation(signal,()=>wc.executeJavaScriptInIsolatedWorld(999,[{code:`(()=>{try{
    const nodes=[...document.querySelectorAll(${JSON.stringify(args.selector)})];
    const properties=['display','visibility','position','width','height','min-width','max-width','box-sizing','padding','border-width','font-size','line-height','white-space','overflow','overflow-x','overflow-y','text-overflow','color','background-color'];
    return {url:location.href,count:nodes.length,elements:nodes.slice(0,20).map(el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el);return {
     tag:el.tagName.toLowerCase(),text:(el.innerText||'').slice(0,1000),disabled:el.matches(':disabled'),
     bounds:{x:r.x,y:r.y,width:r.width,height:r.height},clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,
     styles:Object.fromEntries(properties.map(key=>[key,style.getPropertyValue(key)]))
    }})};
   }catch(error){return {automationError:String(error.message||error)}}})()`}]))
   signal.throwIfAborted()
   if(!this.automationEnabled||wc.getURL()!==url)throw new Error('页面或插件状态已变化，请重新读取')
   if(result?.automationError)throw new Error(result.automationError)
   return result
  }
  if(operation==='read_page'){
   if(wc.isLoading())throw new Error('网页仍在加载，请稍后读取')
   const token=randomUUID(),url=wc.getURL();this.snapshotToken=token;this.snapshotUrl=url
   const result=await browserOperation(signal,()=>wc.executeJavaScriptInIsolatedWorld(999,[{code:`(()=>{
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const label=el=>(el.getAttribute('aria-label')||el.labels?.[0]?.innerText||el.innerText||el.getAttribute('placeholder')||el.getAttribute('name')||(el.tagName==='CANVAS'?(el.id||'canvas'):'')).trim().slice(0,160);
    const nodes=[...document.querySelectorAll('a[href],button,input:not([type=password]):not([type=hidden]):not([type=file]),textarea,select,canvas,[role=button]')].filter(el=>visible(el)&&!el.disabled).slice(0,150);
    globalThis.__myplaneSnapshot={token:${JSON.stringify(token)},nodes,sizes:nodes.map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height}}),labels:nodes.map(label),fingerprints:nodes.map(el=>JSON.stringify([el.tagName,el.type,el.getAttribute('href'),el.getAttribute('formaction'),el.form?.action,el.getAttribute('name'),el.tagName==='SELECT'?[...el.options].map(o=>[o.value,o.label,o.disabled,o.parentElement?.disabled]):null]))};
    return {url:location.href,title:document.title,text:document.body?.innerText.slice(0,18000)||'',elements:nodes.map((el,index)=>({ref:index,label:label(el),tag:el.tagName.toLowerCase(),type:el.getAttribute('type')||'',value:'value' in el?el.value:undefined,checked:'checked' in el?el.checked:undefined,bounds:(()=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),canvas:el.tagName==='CANVAS'?{width:el.width,height:el.height}:undefined,options:el.tagName==='SELECT'?[...el.options].slice(0,150).map(o=>({value:o.value,label:o.label,selected:o.selected,disabled:o.disabled||!!o.parentElement?.disabled})):undefined}))};
   })()`}]))
   signal.throwIfAborted()
   if(!this.automationEnabled||wc.getURL()!==url||this.snapshotToken!==token)throw new Error('页面已变化，请重新读取')
   return {snapshot:token,...result}
  }
  if(!['click','fill','select_option'].includes(operation))throw new Error('不支持的浏览器操作')
  if(typeof args.snapshot!=='string'||args.snapshot!==this.snapshotToken||!this.snapshotToken||wc.getURL()!==this.snapshotUrl||args.url!==this.snapshotUrl)throw new Error('网页快照已失效，请重新读取网页')
  if(typeof args.label!=='string')throw new Error('缺少目标元素说明，请重新读取网页')
  if(!Number.isInteger(args.ref)||Number(args.ref)<0||Number(args.ref)>149)throw new Error('元素编号无效')
  if(operation==='fill'&&(typeof args.text!=='string'||args.text.length>10000))throw new Error('填写内容无效或过长')
  if(operation==='select_option'&&(typeof args.value!=='string'||args.value.length>10000))throw new Error('选项值无效')
  const positioned=operation==='click'&&(args.x!==undefined||args.y!==undefined)
  if(positioned&&(!Number.isFinite(args.x)||!Number.isFinite(args.y)||Number(args.x)<0||Number(args.y)<0))throw new Error('坐标必须同时提供有效的非负 x 和 y')
  // Models may double-escape multiline labels when copying JSON tool results.
  // Only tolerate that representation difference; live labels still must match the snapshot exactly.
  const decodedLabel=args.label.replace(/\\([nrt])/g,(_match,code:string)=>({n:'\n',r:'\r',t:'\t'}[code]||''))
  const token=this.snapshotToken;this.snapshotToken=''
  signal.throwIfAborted()
  const result=await browserOperation(signal,()=>wc.executeJavaScriptInIsolatedWorld(999,[{code:`(async()=>{try{
   const saved=globalThis.__myplaneSnapshot;if(!saved||saved.token!==${JSON.stringify(token)})throw Error('快照已失效');
   const el=saved.nodes[${Number(args.ref)}];if(!el?.isConnected||el.disabled)throw Error('元素已变化，请重新读取');
   const label=(el.getAttribute('aria-label')||el.labels?.[0]?.innerText||el.innerText||el.getAttribute('placeholder')||el.getAttribute('name')||(el.tagName==='CANVAS'?(el.id||'canvas'):'')).trim().slice(0,160);
   const r=el.getBoundingClientRect(),s=getComputedStyle(el);if(label!==saved.labels[${Number(args.ref)}])throw Error('元素已变化，请重新读取');
   if(label!==${JSON.stringify(args.label)}&&label!==${JSON.stringify(decodedLabel)})throw Error('目标 label 与快照不一致，请原样使用 read_page 返回的 label：'+JSON.stringify(saved.labels[${Number(args.ref)}]));
   if(label!==saved.labels[${Number(args.ref)}]||JSON.stringify([el.tagName,el.type,el.getAttribute('href'),el.getAttribute('formaction'),el.form?.action,el.getAttribute('name'),el.tagName==='SELECT'?[...el.options].map(o=>[o.value,o.label,o.disabled,o.parentElement?.disabled]):null])!==saved.fingerprints[${Number(args.ref)}]||!r.width||!r.height||s.visibility==='hidden'||s.display==='none')throw Error('元素已变化，请重新读取');
   if(${JSON.stringify(operation)}==='fill'){
    if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement)||el.readOnly||['password','file','hidden','submit','button','checkbox','radio'].includes(el.type))throw Error('此元素不支持文本填写');
    const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(args.text||'')});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
   }else if(${JSON.stringify(operation)}==='select_option'){
    if(!(el instanceof HTMLSelectElement)||el.multiple)throw Error('此元素不是单选下拉框');
    const option=[...el.options].find(o=>o.value===${JSON.stringify(args.value??'')});
    if(!option||option.disabled||option.parentElement?.disabled)throw Error('选项不存在或已禁用，请重新读取');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,option.value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
   }else{
    if(${positioned}&&(Math.abs(r.width-saved.sizes[${Number(args.ref)}].width)>0.5||Math.abs(r.height-saved.sizes[${Number(args.ref)}].height)>0.5))throw Error('元素尺寸已变化，请重新读取');
    el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(!el.isConnected||el.matches(':disabled'))throw Error('元素已变化，请重新读取');
    const box=el.getBoundingClientRect();
    const px=${JSON.stringify(args.x??null)},py=${JSON.stringify(args.y??null)};
    if(${positioned}&&(px>=box.width||py>=box.height))throw Error('坐标超出元素范围');
    const x=Math.floor(${positioned}?box.left+px:(Math.max(0,box.left)+Math.min(innerWidth,box.right))/2),y=Math.floor(${positioned}?box.top+py:(Math.max(0,box.top)+Math.min(innerHeight,box.bottom))/2);
    if(x<0||y<0||x>=innerWidth||y>=innerHeight)throw Error('目标坐标不在可见区域内');
    const hit=document.elementFromPoint(x,y);if(!hit||(hit!==el&&!el.contains(hit)))throw Error('目标元素被遮挡，请关闭遮挡内容后重新读取网页');
    globalThis.__myplaneSnapshot=undefined;return {point:{x,y}};
   }
   globalThis.__myplaneSnapshot=undefined;return {performed:true,note:'操作已发送，请重新读取网页核验结果。'};
  }catch(error){return {automationError:String(error.message||error)}}})()`}],true))
  signal.throwIfAborted();if(result?.automationError)throw new Error(result.automationError)
  if(result?.point){
   if(!this.automationEnabled||wc.isDestroyed()||wc.getURL()!==args.url)throw new Error('页面或插件状态已变化，请重新读取')
   const {x,y}=result.point
   // Display in the remote view: toolbar HTML is behind the native web surface.
   try{await browserOperation(signal,()=>wc.executeJavaScriptInIsolatedWorld(999,[{code:browserPointerScript({x,y})}]))}catch{/* Visual feedback must not prevent an otherwise valid click. */}
   if(signal.aborted||!this.automationEnabled||wc.isDestroyed()||wc.getURL()!==args.url){
    if(!wc.isDestroyed())void wc.executeJavaScriptInIsolatedWorld(999,[{code:browserPointerScript()}]).catch(()=>{})
    signal.throwIfAborted();throw new Error('页面或插件状态已变化，请重新读取')
   }
   wc.focus()
   wc.sendInputEvent({type:'mouseMove',x,y})
   wc.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1})
   wc.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1})
   return {performed:true,note:'点击已发送，请重新读取网页核验结果。'}
  }
  return result
 }
 async action(sender:WebContents,action:BrowserAction,value?:unknown){
  if(action==='plugin-state')return this.snapshot()
  if(action==='enable-automation'){
   if(typeof value!=='boolean')throw new Error('插件开关无效')
   writeFileSync(this.pluginFile,JSON.stringify({enabled:value}),'utf8')
   this.automationEnabled=value;this.snapshotToken=''
   const contents=this.view?.webContents
   if(!value&&contents&&!contents.isDestroyed())await contents.executeJavaScriptInIsolatedWorld(999,[{code:browserPointerScript()}]).catch(()=>{})
   this.publish();return this.snapshot()
  }
  if(action==='open')return this.open(value)
  if(sender!==this.window?.webContents)throw new Error('只能在内置浏览器中控制网页')
  const wc=this.view?.webContents
  if(!wc||wc.isDestroyed())throw new Error('浏览器已关闭')
  switch(action){
   case 'navigate':void this.navigate(browserUrl(value));break
   case 'back':if(wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();break
   case 'forward':if(wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();break
   case 'reload':if(this.error&&this.requestedUrl)void this.navigate(this.requestedUrl);else if(wc.getURL())wc.reload();break
   case 'stop':wc.stop();break
   case 'external':await shell.openExternal(browserUrl(wc.getURL()));break
   case 'state':break
   default:throw new Error('不支持的浏览器操作')
  }
  return this.snapshot()
 }
}
