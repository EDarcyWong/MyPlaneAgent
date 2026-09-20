<script setup lang="ts">
import {onBeforeUnmount,ref,watch} from 'vue'
import type {AgentModelProfile} from '../../electron/shared/local-ai-agent'
const props=defineProps<{model:string;disabled:boolean}>(),emit=defineEmits<{busy:[value:boolean]}>()
const profile=ref<AgentModelProfile|null>(null),running=ref<'tools'|'image'|''>(''),notice=ref(''),stopping=ref(false)
let revision=0,disposed=false
watch(()=>props.model,async model=>{const current=++revision;profile.value=null;notice.value='';if(!model)return;try{const result=await window.myplane.localAiStudio('agentModelProfile',{model});if(current===revision&&!disposed)profile.value=result}catch(e){if(current===revision)notice.value=String(e)}},{immediate:true})
async function test(kind:'tools'|'image'){
 if(props.disabled||running.value||!props.model)return
 revision++;running.value=kind;notice.value='';stopping.value=false;emit('busy',true)
 try{const result=await window.myplane.localAiStudio('agentProbeModel',{model:props.model,kind});if(!disposed)profile.value=result}catch(e){if(!disposed)notice.value=stopping.value?'检测已停止，保留上次结果。':String(e)}finally{running.value='';stopping.value=false;emit('busy',false)}
}
async function stop(){stopping.value=true;try{await window.myplane.localAiStudio('agentStopModelProbe')}catch(e){notice.value=String(e);stopping.value=false}}
onBeforeUnmount(()=>{disposed=true;revision++;if(running.value)void window.myplane.localAiStudio('agentStopModelProbe').catch(()=>{})})
</script>
<template>
 <section class="model-capabilities" aria-label="模型能力检测">
  <div class="capability-actions"><button type="button" class="agent-secondary" :disabled="disabled||!!running||!model" @click="test('tools')">测试模型工具调用</button><button type="button" class="agent-secondary" :disabled="disabled||!!running||!model" @click="test('image')">测试图片识别</button></div>
  <p v-if="running" role="status">{{running==='image'?'正在识别两张随机测试图片…':'正在验证工具调用格式…'}}<button type="button" class="agent-secondary" :disabled="stopping" @click="stop">{{stopping?'停止中…':'停止检测'}}</button></p>
  <div v-if="profile" class="capability-results" role="status">
   <p>{{profile.tools===undefined?'工具调用尚未检测':profile.tools?'工具调用测试通过。':'工具调用测试未通过。'}}</p>
   <p>{{profile.image==='not-tested'?'图片识别尚未检测':profile.image==='passed'?'图片基础测试通过（2 / 2）。':`图片基础测试未通过（${profile.imagePassed||0} / 2）。`}}</p>
   <small v-if="profile.tools!==undefined">工具：{{new Date(profile.toolsTestedAt||profile.testedAt).toLocaleString()}}</small><small v-if="profile.imageTestedAt">图片：{{new Date(profile.imageTestedAt).toLocaleString()}}</small>
   <p v-if="profile.error" class="capability-error">{{profile.error}}</p>
   <small>上次检测：{{profile.lastUsage?profile.lastUsage.totalReports?profile.lastUsage.totalTokens+' Token'+(profile.lastUsage.totalReports<profile.lastUsage.requests?'（部分回报）':''):'未返回 Token 用量':profile.usage?.totalTokens!==undefined?profile.usage.totalTokens+' Token':'未返回 Token 用量'}}<template v-if="profile.elapsedMs!==undefined"> · {{(profile.elapsedMs/1000).toFixed(1)}} 秒</template></small>
  </div>
  <p v-if="notice" role="status">{{notice}}</p>
  <small>结果按服务地址和模型保存。图片检测仅发送生成的色块图，不读取项目文件；基础测试不代表 OCR 或文档理解质量。上下文容量仍以服务配置为准。</small>
 </section>
</template>
<style scoped>
.model-capabilities{padding:10px 0;border-bottom:1px solid var(--s-border)}.capability-actions{display:flex;flex-wrap:wrap;gap:6px}.model-capabilities p{margin:7px 0!important;line-height:1.6}.model-capabilities small{display:block;color:var(--s-dim);font-size:10px;line-height:1.7;overflow-wrap:anywhere}.capability-results{padding:8px;margin-top:8px;border-radius:7px;background:var(--s-muted)}.capability-error{color:var(--s-danger)}.model-capabilities p>button{margin-left:8px}
</style>
<style scoped>
.model-capabilities{font-size:12px}.model-capabilities button{font:inherit;font-size:11px;line-height:1.5;padding:6px 9px;border:1px solid var(--s-border);border-radius:7px;background:var(--s-panel);color:var(--s-text);cursor:pointer}.model-capabilities button:hover:not(:disabled){background:var(--s-muted)}.model-capabilities button:disabled{opacity:.45;cursor:default}.model-capabilities button:focus-visible{outline:2px solid var(--s-text);outline-offset:2px}
</style>
