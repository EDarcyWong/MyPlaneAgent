<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue'
import type {ChatArtifact} from '../../electron/shared/chat-presentation'
import {fileDiff} from '../../electron/shared/file-diff'
import {highlightCode} from './syntax-highlight'
import {highlightSource,sourceLanguage} from './code-highlighter'

const id=useId(),artifact=ref<ChatArtifact>(),anchor=ref<HTMLElement>(),popup=ref<HTMLElement>(),style=ref<Record<string,string>>({})
const beforeHtml=ref<string[]>([]),afterHtml=ref<string[]>([])
let showTimer:ReturnType<typeof setTimeout>|undefined,hideTimer:ReturnType<typeof setTimeout>|undefined
const snippet=computed(()=>{
 const item=artifact.value
 if(!item)return {lines:[],more:false}
 const diff=fileDiff(item.kind==='diff'?item.before||'':item.after||'',item.after||'')
 const first=diff.lines.findIndex(line=>line.kind!=='same'),start=Math.max(0,first-2)
 return {lines:diff.lines.slice(start,start+12),more:start>0||diff.lines.length>start+12||diff.truncated}
})
watch(artifact,async(item,_old,onCleanup)=>{
 let stale=false;onCleanup(()=>{stale=true})
 if(!item)return
 const before=(item.before||'').slice(0,60000).replace(/\r\n/g,'\n'),after=(item.after||'').slice(0,60000).replace(/\r\n/g,'\n'),language=sourceLanguage(before+'\n'+after,item.path,item.scope==='fragment')
 beforeHtml.value=highlightCode(before,language).split('\n');afterHtml.value=highlightCode(after,language).split('\n')
 const [oldHtml,newHtml]=await Promise.all([highlightSource(before,language),highlightSource(after,language)])
 if(!stale){beforeHtml.value=oldHtml.split('\n');afterHtml.value=newHtml.split('\n')}
})
function hide(){clearTimeout(showTimer);clearTimeout(hideTimer);anchor.value?.removeAttribute('aria-describedby');artifact.value=undefined;anchor.value=undefined}
function keepOpen(){clearTimeout(hideTimer)}
function scheduleHide(event?:MouseEvent|FocusEvent){
 clearTimeout(showTimer);clearTimeout(hideTimer)
 const next=event?.relatedTarget
 if(next instanceof Node&&(popup.value?.contains(next)||anchor.value?.contains(next)))return
 if(popup.value?.matches(':hover')||anchor.value?.matches(':hover'))return
 hideTimer=setTimeout(()=>{if(!popup.value?.matches(':hover')&&!anchor.value?.matches(':hover'))hide()},400)
}
function show(item:ChatArtifact,event:MouseEvent|FocusEvent){
 const target=event.currentTarget as HTMLElement
 if(anchor.value===target&&artifact.value?.id===item.id){keepOpen();return}
 hide()
 showTimer=setTimeout(()=>{
  if(!target.isConnected)return
  const rect=target.getBoundingClientRect(),width=Math.min(560,window.innerWidth-24),below=window.innerHeight-rect.bottom-12,above=rect.top-12
  const placeBelow=below>=362||below>=above,height=Math.max(0,Math.min(356,(placeBelow?below:above)-6))
  const pointerLeft=event instanceof MouseEvent?Math.max(rect.left,event.clientX-width+32):rect.left
  const left=Math.max(12,Math.min(pointerLeft,window.innerWidth-width-12)),theme=getComputedStyle(target)
  // Anchor the nearest edge, so short previews never leave a large gap above a row.
  // Padding belongs to the hover target and bridges the visual six-pixel gap.
  style.value={left:left+'px',width:width+'px','--preview-max-height':height+'px',...(placeBelow?{top:rect.bottom+'px',paddingTop:'6px'}:{bottom:(window.innerHeight-rect.top)+'px',paddingBottom:'6px'}),colorScheme:theme.colorScheme,...Object.fromEntries(['--s-panel','--s-muted','--s-text','--s-dim','--s-border','--s-accent'].map(name=>[name,theme.getPropertyValue(name)]))}
  anchor.value=target;artifact.value=item;target.setAttribute('aria-describedby',id)
 },250)
}
function onScroll(event:Event){if(!popup.value?.contains(event.target as Node))hide()}
function onKey(event:KeyboardEvent){if(event.key==='Escape')hide()}
onMounted(()=>{window.addEventListener('scroll',onScroll,true);window.addEventListener('resize',hide);window.addEventListener('keydown',onKey)})
onBeforeUnmount(()=>{hide();window.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',hide);window.removeEventListener('keydown',onKey)})
defineExpose({show,scheduleHide,hide})
</script>
<template>
 <Teleport to="body">
  <div v-if="artifact" ref="popup" class="artifact-hover-position" :style="style" @mouseenter="keepOpen" @mouseleave="scheduleHide($event)">
  <aside :id="id" role="tooltip" class="artifact-hover syntax-colored">
   <header><strong>{{artifact.path}}</strong><span>{{artifact.kind==='diff'?'变更片段':'内容片段'}}</span></header>
   <div v-if="snippet.lines.length" class="snippet-code"><div class="snippet-table">
    <div v-for="(line,index) in snippet.lines" :key="index" class="snippet-line" :class="line.kind"><span class="line-number">{{line.kind==='removed'?line.before:line.after}}</span><span class="sign">{{line.kind==='added'?'+':line.kind==='removed'?'−':' '}}</span><code v-html="(line.kind==='removed'?beforeHtml[(line.before||1)-1]:afterHtml[(line.after||1)-1])||' '"></code></div>
   </div></div>
   <p v-else class="empty">暂无可展示的文本内容</p>
   <footer><span v-if="artifact.scope==='fragment'">片段内行号 · </span>{{snippet.more?'仅显示部分内容 · ':''}}点击文件查看完整预览</footer>
  </aside>
  </div>
 </Teleport>
</template>
<style scoped src="./code-token-colors.css"></style>
<style scoped>
.artifact-hover-position{position:fixed;z-index:5000;box-sizing:border-box}.artifact-hover{display:flex;flex-direction:column;max-height:var(--preview-max-height);box-sizing:border-box;border:1px solid var(--s-border,#ddd);border-radius:12px;background:var(--s-panel,#fff);color:var(--s-text,#222);box-shadow:0 10px 35px #0002;overflow:hidden;font:12px/1.5 'Segoe UI','Microsoft YaHei',sans-serif}
header{display:flex;align-items:center;gap:12px;padding:10px 13px;border-bottom:1px solid var(--s-border,#ddd);flex:none}header strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:550}header span{flex:none;font-size:10px;color:var(--s-dim,#777)}
.snippet-code{overflow:auto;min-height:0}.snippet-table{width:max-content;min-width:100%;padding:6px 0}.snippet-line{display:flex;min-height:21px;font:11px/21px ui-monospace,Consolas,monospace}.snippet-line.added{background:light-dark(#edf9f0,#163226)}.snippet-line.removed{background:light-dark(#fff0f0,#3c2225)}.line-number{flex:none;width:38px;text-align:right;padding-right:7px;color:var(--s-dim,#777);user-select:none}.sign{width:20px;flex:none;text-align:center;user-select:none}.added .sign{color:light-dark(#167349,#81cf9e)}.removed .sign{color:light-dark(#b64242,#eda0a0)}code{font:inherit;white-space:pre;tab-size:2;padding-right:14px}footer{padding:8px 13px;border-top:1px solid var(--s-border,#ddd);color:var(--s-dim,#777);font-size:10px;background:var(--s-muted,#f6f6f6);flex:none}.empty{padding:12px;color:var(--s-dim,#777)}
</style>
