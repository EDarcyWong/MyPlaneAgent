import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch,type Ref} from 'vue'

type Pane='history'|'inspector'
const storageKey='myplane.local-ai.layout.v1'
export function useStudioLayout(parameters:Ref<boolean>,tab:Ref<string>,downloads:Ref<boolean>){
 let saved:Record<string,unknown>={}
 try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{}}catch{}
 const bounded=(value:unknown,min:number,max:number,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback
 const studioRoot=ref<HTMLElement>(),width=ref(window.innerWidth)
 const historyWidth=ref(bounded(saved.historyWidth,190,330,232)),inspectorWidth=ref(bounded(saved.inspectorWidth,250,360,280))
 const historyExpanded=ref(saved.historyExpanded!==false),historyOpen=ref(false),detailsOpen=ref(false),resizing=ref(false)
 const narrow=computed(()=>width.value<980),compact=computed(()=>width.value<680),floatingInspector=computed(()=>width.value<1180)
 parameters.value=width.value>=1180&&saved.inspectorOpen===true
 const historyVisible=computed(()=>narrow.value?historyOpen.value:historyExpanded.value)
 const overlay=computed(()=>downloads.value?'studio-downloads':tab.value==='chat'&&narrow.value&&historyOpen.value?'studio-history':tab.value==='chat'&&floatingInspector.value&&parameters.value?'studio-parameters':tab.value==='discover'&&narrow.value&&detailsOpen.value?'studio-details':'')
 const layoutStyle=computed(()=>({'--history-width':`${historyWidth.value}px`,'--inspector-width':`${inspectorWidth.value}px`}))
 let observer:ResizeObserver|undefined,stopDrag:(()=>void)|undefined,previousFocus:HTMLElement|null=null
 function save(){try{localStorage.setItem(storageKey,JSON.stringify({historyWidth:historyWidth.value,inspectorWidth:inspectorWidth.value,historyExpanded:historyExpanded.value,inspectorOpen:!floatingInspector.value&&parameters.value}))}catch{}}
 function toggleHistory(){if(narrow.value){historyOpen.value=!historyOpen.value;if(historyOpen.value)parameters.value=false}else{historyExpanded.value=!historyExpanded.value;save()}}
 function closeOverlay(){if(downloads.value)downloads.value=false;else if(tab.value==='discover')detailsOpen.value=false;else{historyOpen.value=false;if(floatingInspector.value)parameters.value=false}}
 function setWidth(pane:Pane,value:number){if(pane==='history')historyWidth.value=Math.max(190,Math.min(330,value));else inspectorWidth.value=Math.max(250,Math.min(360,value))}
 function beginResize(pane:Pane,event:PointerEvent){
  if(event.button!==0)return
  event.preventDefault();stopDrag?.();const start=event.clientX,initial=pane==='history'?historyWidth.value:inspectorWidth.value
  const handle=event.currentTarget as HTMLElement;handle.setPointerCapture(event.pointerId);resizing.value=true
  const move=(next:PointerEvent)=>setWidth(pane,initial+(next.clientX-start)*(pane==='history'?1:-1))
  const stop=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);handle.removeEventListener('lostpointercapture',stop);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);resizing.value=false;stopDrag=undefined;save()}
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);stopDrag=stop
 }
 function resizeKey(pane:Pane,event:KeyboardEvent){
  const current=pane==='history'?historyWidth.value:inspectorWidth.value
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
  event.preventDefault();setWidth(pane,event.key==='Home'?(pane==='history'?232:280):event.key==='End'?(pane==='history'?330:360):current+(event.key==='ArrowRight'?16:-16)*(pane==='history'?1:-1));save()
 }
 function layoutKey(event:KeyboardEvent){
  if(!overlay.value)return
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeOverlay();return}
  if(event.key!=='Tab')return
  const panel=studioRoot.value?.querySelector<HTMLElement>(`#${overlay.value}`)
  const controls=Array.from(panel?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,a[href],[tabindex="0"]')||[]).filter(item=>item.getClientRects().length>0)
  const first=controls[0],last=controls.at(-1)
  if(!first){event.preventDefault();panel?.focus();return}
  if(event.shiftKey&&(!panel?.contains(document.activeElement)||document.activeElement===first)){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&(!panel?.contains(document.activeElement)||document.activeElement===last)){event.preventDefault();first.focus()}
 }
 watch(parameters,value=>{if(value)historyOpen.value=false;save()})
 watch(tab,()=>{historyOpen.value=false;detailsOpen.value=false;stopDrag?.()})
 watch(narrow,()=>{historyOpen.value=false;detailsOpen.value=false;stopDrag?.()})
 watch(floatingInspector,()=>{parameters.value=false;stopDrag?.()})
 watch(overlay,async(value,old)=>{if(value&&!old)previousFocus=document.activeElement as HTMLElement;await nextTick();if(value){const panel=studioRoot.value?.querySelector<HTMLElement>(`#${value}`);panel?.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]')?.focus()}else if(previousFocus?.isConnected){previousFocus.focus();previousFocus=null}})
 onMounted(()=>{if(!studioRoot.value)return;observer=new ResizeObserver(entries=>{width.value=entries[0].contentRect.width});observer.observe(studioRoot.value)})
 onBeforeUnmount(()=>{observer?.disconnect();stopDrag?.()})
 return {studioRoot,narrow,compact,floatingInspector,historyVisible,historyOpen,detailsOpen,resizing,historyWidth,inspectorWidth,layoutStyle,toggleHistory,closeOverlay,beginResize,resizeKey,layoutKey}
}
