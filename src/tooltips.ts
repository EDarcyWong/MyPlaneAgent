const css=`.myplane-tooltip{position:fixed;z-index:2147483647;max-width:min(340px,calc(100vw - 20px));box-sizing:border-box;padding:9px 12px;border:1px solid #d5deeb;border-radius:8px;background:#fff;color:#34445b;box-shadow:0 6px 22px #172b4d24;font:12px/1.65 'Segoe UI',system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;max-height:calc(100vh - 20px);overflow:auto;user-select:text;-webkit-app-region:no-drag}.myplane-tooltip[data-dark=true]{background:#303b4b;border-color:#526178;color:#e6edf7;box-shadow:0 6px 24px #0005}.myplane-tooltip[hidden]{display:none}`
// Native title bubbles cannot be styled. Delegate them to one accessible popup per document.
export function installTooltips(doc:Document=document,themeRoot:Document=doc):()=>void{
 const win=doc.defaultView;if(!win)return ()=>{}
 const style=doc.createElement('style');style.textContent=css;doc.head.append(style)
 const tip=doc.createElement('div');tip.className='myplane-tooltip';tip.id='myplane-tooltip-'+Math.random().toString(36).slice(2);tip.setAttribute('role','tooltip');tip.hidden=true;(doc.body||doc.documentElement).append(tip)
 let owner:Element|null=null,title='',showTimer:ReturnType<typeof setTimeout>|undefined,hideTimer:ReturnType<typeof setTimeout>|undefined
 const frames=new Map<Element,()=>void>()
 const clearTimers=()=>{clearTimeout(showTimer);clearTimeout(hideTimer)}
 function close(){clearTimers();observeTitle.disconnect();if(owner){if(owner.getAttribute('title')==='')owner.setAttribute('title',title);const ids=(owner.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tip.id);if(ids.length)owner.setAttribute('aria-describedby',ids.join(' '));else owner.removeAttribute('aria-describedby')}owner=null;tip.hidden=true}
 function position(){if(!owner?.isConnected){close();return}const r=owner.getBoundingClientRect(),box=tip.getBoundingClientRect(),right=!!owner.closest('.primary-sidebar');let x=right?r.right+10:r.left+(r.width-box.width)/2,y=right?r.top+(r.height-box.height)/2:r.bottom+8;if(!right&&y+box.height>win!.innerHeight-10)y=r.top-box.height-8;if(right&&x+box.width>win!.innerWidth-10)x=r.left-box.width-10;tip.style.left=Math.max(10,Math.min(x,win!.innerWidth-box.width-10))+'px';tip.style.top=Math.max(10,Math.min(y,win!.innerHeight-box.height-10))+'px'}
 function reveal(){
  if(!owner?.isConnected)return close()
  tip.textContent=title
  const surface=(owner.closest('.local-ai-studio,.workflow-editor-window')||themeRoot.querySelector('.local-ai-studio,.workflow-editor-window')) as HTMLElement|null
  const colors=surface?.ownerDocument.defaultView?.getComputedStyle(surface)
  const token=(primary:string,fallback:string)=>colors?.getPropertyValue(primary).trim()||colors?.getPropertyValue(fallback).trim()||''
  tip.dataset.dark=String(colors?.colorScheme==='dark'||themeRoot.documentElement.classList.contains('dark'))
  tip.style.backgroundColor=token('--s-panel','--wf-panel')
  tip.style.color=token('--s-text','--wf-text')
  tip.style.borderColor=token('--s-border','--wf-line')
  tip.hidden=false
  const ids=(owner.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean)
  if(!ids.includes(tip.id))ids.push(tip.id)
  owner.setAttribute('aria-describedby',ids.join(' '))
  position()
 }
 const observeTitle=new MutationObserver(()=>{const next=owner?.getAttribute('title');if(next){title=next;owner!.setAttribute('title','');if(!tip.hidden)reveal()}})
 function enter(event:Event){const target=event.target as Element|null;if(!target?.closest)return;if(tip.contains(target)){clearTimeout(hideTimer);return}const element=target.closest('[title]');if(element===owner){clearTimeout(hideTimer);return}if(!element?.getAttribute('title')||element.tagName==='IFRAME')return;close();owner=element;title=element.getAttribute('title')!;element.setAttribute('title','');observeTitle.observe(element,{attributes:true,attributeFilter:['title']});showTimer=setTimeout(reveal,event.type==='focusin'?150:380)}
 function leave(event:Event){const related=(event as MouseEvent).relatedTarget as Node|null;if(related&&(owner?.contains(related)||tip.contains(related)))return;clearTimeout(showTimer);hideTimer=setTimeout(close,120)}
 function dismiss(event:Event){if(event.type==='scroll'&&tip.hidden)return;if(!tip.contains(event.target as Node))close()}
 function key(event:KeyboardEvent){if(event.key==='Escape')close()}
 function loadFrame(event:Event){const frame=event.target as HTMLIFrameElement;if(frame?.tagName!=='IFRAME')return;frames.get(frame)?.();frames.delete(frame);try{const inner=frame.contentDocument;if(inner?.head)frames.set(frame,installTooltips(inner,themeRoot))}catch{/* Opaque plugin frames keep their own isolated UI. */}}
 const removed=new MutationObserver(records=>{if(records.some(r=>r.removedNodes.length)){if(owner&&!owner.isConnected)close();for(const [frame,dispose] of frames)if(!frame.isConnected){dispose();frames.delete(frame)}}})
 removed.observe(doc.documentElement,{childList:true,subtree:true})
 doc.addEventListener('pointerover',enter,true);doc.addEventListener('focusin',enter,true);doc.addEventListener('pointerout',leave,true);doc.addEventListener('focusout',leave,true);doc.addEventListener('keydown',key,true);doc.addEventListener('pointerdown',dismiss,true);doc.addEventListener('scroll',dismiss,true);win.addEventListener('resize',close);win.addEventListener('blur',close);doc.addEventListener('load',loadFrame,true)
 for(const frame of doc.querySelectorAll('iframe'))loadFrame({target:frame} as unknown as Event)
 return ()=>{close();removed.disconnect();for(const dispose of frames.values())dispose();frames.clear();doc.removeEventListener('pointerover',enter,true);doc.removeEventListener('focusin',enter,true);doc.removeEventListener('pointerout',leave,true);doc.removeEventListener('focusout',leave,true);doc.removeEventListener('keydown',key,true);doc.removeEventListener('pointerdown',dismiss,true);doc.removeEventListener('scroll',dismiss,true);win.removeEventListener('resize',close);win.removeEventListener('blur',close);doc.removeEventListener('load',loadFrame,true);tip.remove();style.remove()}
}
