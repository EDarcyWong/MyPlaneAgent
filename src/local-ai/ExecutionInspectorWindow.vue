<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref} from 'vue'
import ExecutionInspector from './ExecutionInspector.vue'
import type {InspectorWindowContext} from '../../electron/shared/execution-inspector'
const context=ref<InspectorWindowContext>({requestId:'',content:'',reasoning:'',theme:'system'}),error=ref('')
let disposed=false,timer:ReturnType<typeof setTimeout>|undefined
async function poll(){try{const next=await window.myplane.inspectorSnapshot();if(!disposed){context.value=next;error.value=''}}catch(cause){if(!disposed)error.value=String(cause)}finally{if(!disposed)timer=setTimeout(poll,500)}}
async function stop(){if(context.value.requestId)try{await window.myplane.localAiStudio('stopChat',{requestId:context.value.requestId})}catch(cause){error.value=String(cause)}}
onMounted(()=>void poll());onBeforeUnmount(()=>{disposed=true;clearTimeout(timer)})
</script>
<template><main class="inspector-window" :data-theme="context.theme"><p v-if="error" role="alert">{{ error }}</p><ExecutionInspector detached enabled :request-id="context.requestId" :history-request-id="context.historyRequestId" :session-id="context.sessionId" :message="{content:context.content,reasoning:context.reasoning}" @stop="stop"/></main></template>
<style scoped>
.inspector-window{--s-bg:#f7f9fc;--s-panel:#fff;--s-muted:#eef2f6;--s-border:#dce3eb;--s-text:#243044;--s-dim:#6a7a90;--s-accent:#3478c6;--s-accent-soft:#eef2f6;--s-on-accent:#fff;height:100%;width:100%;min-height:0;display:flex;flex-direction:column;background:var(--s-panel);color:var(--s-text)}.inspector-window>p{padding:8px 14px;color:#bd4040;font-size:12px;margin:0}.inspector-window :deep(.execution-inspector){flex:1;min-height:0}.inspector-window[data-theme=dark]{--s-bg:#202020;--s-panel:#272727;--s-muted:#333;--s-border:#444;--s-text:#ececec;--s-dim:#adadad;--s-accent:#82b6ee;--s-accent-soft:#333;--s-on-accent:#202020;color-scheme:dark}@media(prefers-color-scheme:dark){.inspector-window[data-theme=system]{--s-bg:#202020;--s-panel:#272727;--s-muted:#333;--s-border:#444;--s-text:#ececec;--s-dim:#adadad;--s-accent:#82b6ee;--s-accent-soft:#333;--s-on-accent:#202020;color-scheme:dark}}
</style>
