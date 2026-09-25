<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import type {StudioMessage} from '../../electron/shared/local-ai-studio'
const props=defineProps<{messages:StudioMessage[];scroller?:HTMLElement;sessionId?:string}>()
const entries=computed(()=>props.messages.filter(message=>message.role==='user').map((message,index)=>({id:message.id,label:message.content.replace(/\s+/g,' ').trim().slice(0,160)||(message.images?.length?'图片消息':'空消息'),number:index+1})))
const active=ref(''),hovered=ref(''),previewTop=ref(0),rail=ref<HTMLElement>()
const preview=computed(()=>entries.value.find(entry=>entry.id===hovered.value))
let cleanup=()=>{},frame=0
function nodes(){return [...(props.scroller?.querySelectorAll<HTMLElement>('.message.user[data-message-id]')||[])]}
function update(){
 frame=0
 const host=props.scroller;if(!host)return
 const items=nodes();if(!items.length){active.value='';return}
 const top=host.getBoundingClientRect().top+Math.min(100,host.clientHeight*.2)
 let current=items[0]
 for(const item of items){if(item.getBoundingClientRect().top<=top)current=item;else break}
 if(host.scrollHeight-host.scrollTop-host.clientHeight<24)current=items.at(-1)!
 active.value=current.dataset.messageId||''
 const marker=rail.value?.querySelector<HTMLElement>('[aria-current="location"]')
 if(marker&&rail.value&&!rail.value.contains(document.activeElement)&&!hovered.value){
  const bounds=rail.value.getBoundingClientRect(),rect=marker.getBoundingClientRect()
  if(rect.top<bounds.top||rect.bottom>bounds.bottom)rail.value.scrollTop+=rect.top-bounds.top-rail.value.clientHeight/2
 }
}
function schedule(){if(!frame)frame=requestAnimationFrame(update)}
function jump(id:string){
 const host=props.scroller,target=nodes().find(node=>node.dataset.messageId===id)
 if(!host||!target)return
 host.scrollTo({top:host.scrollTop+target.getBoundingClientRect().top-host.getBoundingClientRect().top-20,behavior:'instant'})
 active.value=id
}
function show(id:string,event:Event){
 hovered.value=id
 const target=event.currentTarget as HTMLElement,root=rail.value?.parentElement
 if(root)previewTop.value=Math.max(0,Math.min(root.clientHeight-90,target.getBoundingClientRect().top-root.getBoundingClientRect().top-20))
}
function keyboard(event:KeyboardEvent){
 if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
 const buttons=[...(rail.value?.querySelectorAll<HTMLButtonElement>('button')||[])],index=buttons.indexOf(event.target as HTMLButtonElement)
 const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)))
 event.preventDefault();buttons[next]?.focus()
}
watch([()=>props.scroller,()=>props.sessionId,()=>entries.value.map(entry=>entry.id).join('|')],async(_value,_old,onCleanup)=>{
 let cancelled=false;onCleanup(()=>{cancelled=true;cleanup()})
 await nextTick();if(cancelled)return
 const host=props.scroller;if(!host)return
 const observer=new ResizeObserver(schedule);observer.observe(host)
 const content=host.querySelector('.messages');if(content)observer.observe(content)
 host.addEventListener('scroll',schedule,{passive:true})
 cleanup=()=>{observer.disconnect();host.removeEventListener('scroll',schedule)}
 hovered.value='';schedule()
},{immediate:true})
onBeforeUnmount(()=>{cleanup();cancelAnimationFrame(frame)})
</script>
<template>
 <nav v-if="entries.length>1" class="conversation-outline" aria-label="当前会话消息导航" @mouseleave="hovered=''" @focusout="hovered=''" @keydown.esc="hovered=''">
  <div ref="rail" class="outline-rail" @keydown="keyboard"><button v-for="entry in entries" :key="entry.id" type="button" :aria-label="'跳转到第 '+entry.number+' 轮：'+entry.label" :aria-current="active===entry.id?'location':undefined" @click="jump(entry.id)" @mouseenter="show(entry.id,$event)" @focus="show(entry.id,$event)"><span></span></button></div>
  <div v-if="preview" class="outline-preview" :style="{top:previewTop+'px'}"><small>第 {{preview.number}} 轮</small><p>{{preview.label}}</p></div>
 </nav>
</template>
<style scoped>
.conversation-outline{position:absolute;left:7px;top:64px;bottom:calc(var(--composer-height,180px) + 20px);width:36px;z-index:5;display:flex;align-items:center;pointer-events:none}.outline-rail{width:36px;max-height:100%;overflow:auto;scrollbar-width:none;pointer-events:auto;padding:4px 0}.outline-rail::-webkit-scrollbar{display:none}.outline-rail button{display:flex;align-items:center;justify-content:flex-start;width:100%;height:14px;padding:0 6px;border:0;background:transparent;cursor:pointer}.outline-rail button>span{display:block;width:8px;height:2px;border-radius:1px;background:var(--s-dim);opacity:.32;transition:width .15s,opacity .15s}.outline-rail button:hover>span,.outline-rail button:focus-visible>span{opacity:.75;width:26px!important}.outline-rail button[aria-current]>span{height:3px;opacity:1;background:var(--s-text)}.outline-rail button:focus-visible{outline:1px solid var(--s-accent);outline-offset:-2px;border-radius:4px}.outline-preview{position:absolute;left:44px;width:240px;max-width:calc(100vw - 80px);padding:10px 12px;border:1px solid var(--s-border);border-radius:9px;background:var(--s-panel);color:var(--s-text);box-shadow:0 4px 20px #0002;font-size:12px;line-height:1.6;pointer-events:none}.outline-preview small{color:var(--s-dim);font-size:10px}.outline-preview p{margin:4px 0 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}@container studio (max-width:650px){.conversation-outline{left:2px;width:24px}.outline-rail{width:24px}.outline-rail button{padding:0 4px}.outline-rail button>span{max-width:16px}.outline-preview{left:30px}}@media(prefers-reduced-motion:reduce){.outline-rail button>span{transition:none}}
</style>
