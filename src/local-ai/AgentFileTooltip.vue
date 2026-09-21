<script setup lang="ts">
import {computed,nextTick,ref,watch} from 'vue'
import type {AgentFilePreview} from '../../electron/shared/local-ai-agent'
import {highlightCode,syntaxLanguage} from './syntax-highlight'

type Anchor={x:number;y:number}
const props=defineProps<{open:boolean;preview?:AgentFilePreview;loading?:boolean;error?:string;line?:number;anchor?:Anchor}>()
defineEmits<{enter:[];leave:[]}>()
const editor=ref<HTMLElement>()
const lines=computed(()=>(props.preview?.content||'').replace(/\r\n?/g,'\n').split('\n').slice(0,5000))
const language=computed(()=>syntaxLanguage(props.preview?.language||props.preview?.path||'text'))
const highlight=(line:string)=>highlightCode(line||' ',language.value)
const position=computed(()=>{
 const width=Math.min(748,Math.max(280,Math.round((window.innerWidth-24)*2/3))),height=Math.min(360,Math.max(220,window.innerHeight-24)),anchor=props.anchor
 if(!anchor)return {left:'12px',top:'12px',width:`${width}px`,height:`${height}px`}
 const left=Math.max(12,Math.min(anchor.x-width/2,window.innerWidth-width-12)),spaceBelow=window.innerHeight-anchor.y,top=spaceBelow>=height+18?anchor.y+14:Math.max(12,anchor.y-height-14)
 return {left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`}
})
async function locate(){await nextTick();const host=editor.value,target=host?.querySelector<HTMLElement>(`[data-line="${Math.max(1,props.line||1)}"]`);if(host&&target)host.scrollTop=Math.max(0,target.offsetTop-host.clientHeight/3)}
watch([()=>props.open,()=>props.preview?.path,()=>props.line],()=>{if(props.open)void locate()},{immediate:true})
</script>

<template>
 <Teleport to="body"><aside v-if="open" class="file-tooltip" :style="position" role="tooltip" @mouseenter="$emit('enter')" @mouseleave="$emit('leave')">
  <header><strong>{{preview?.path||'文件内容'}}</strong><span v-if="preview" class="file-tooltip-language">{{language}}</span><span v-if="line">修改自第 {{line}} 行</span></header>
  <div v-if="loading" class="file-tooltip-state">正在读取文件…</div><div v-else-if="error" class="file-tooltip-state error">{{error}}</div>
  <div v-else ref="editor" class="file-tooltip-code"><div v-for="(text,index) in lines" :key="index" :data-line="index+1" :class="{changed:index+1===line}"><span>{{index+1}}</span><code v-html="highlight(text)"></code></div></div>
 </aside></Teleport>
</template>

<style scoped>
.file-tooltip{position:fixed;z-index:5000;display:flex;flex-direction:column;overflow:hidden;border:1px solid #35443b;border-radius:10px;background:#101713;color:#dce8e0;box-shadow:0 16px 48px #0008}.file-tooltip>header{display:flex;align-items:center;gap:10px;min-height:40px;padding:7px 12px;border-bottom:1px solid #29352f;background:#151e19}.file-tooltip>header strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.file-tooltip>header span{color:#8ea096;font-size:10px;white-space:nowrap}.file-tooltip>header .file-tooltip-language{padding:2px 5px;border-radius:4px;background:#26322b;text-transform:uppercase;font:9px/1.3 'SFMono-Regular',Consolas,monospace}.file-tooltip-code{flex:1;min-height:0;overflow:auto;padding:7px 0 14px;background:#0d1410;font:11.5px/1.65 'SFMono-Regular',Consolas,'Microsoft YaHei UI',monospace}.file-tooltip-code>div{display:grid;grid-template-columns:48px minmax(max-content,1fr);min-height:19px}.file-tooltip-code>div.changed{background:#31452f}.file-tooltip-code span{position:sticky;left:0;padding-right:9px;border-right:1px solid #26322b;background:#0d1410;color:#586b60;text-align:right}.file-tooltip-code>div.changed span{background:#31452f;color:#b8d5bd}.file-tooltip-code code{display:block;padding:0 11px;white-space:pre;color:#cdd8d1}.file-tooltip-code :deep(.tok-comment){color:#6f8879;font-style:italic}.file-tooltip-code :deep(.tok-string){color:#b9cf8b}.file-tooltip-code :deep(.tok-number){color:#d7a86e}.file-tooltip-code :deep(.tok-keyword){color:#c69be5}.file-tooltip-code :deep(.tok-property),.file-tooltip-code :deep(.tok-attr){color:#83bdd5}.file-tooltip-code :deep(.tok-tag){color:#e18b88}.file-tooltip-code :deep(.tok-function){color:#82c8b5}.file-tooltip-code :deep(.tok-type){color:#e2c27f}.file-tooltip-code :deep(.tok-variable){color:#8db7e8}.file-tooltip-code :deep(.tok-operator){color:#d1a4bf}.file-tooltip-code :deep(.tok-meta){color:#91a49a}.file-tooltip-code :deep(.tok-inserted){color:#8fd1a7}.file-tooltip-code :deep(.tok-deleted){color:#ee9999}.file-tooltip-state{display:grid;place-items:center;flex:1;color:#8ea096;font-size:12px}.file-tooltip-state.error{color:#ee8585}
</style>
