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
  <header><div><strong>能力检测</strong><small>验证当前服务对 Agent 功能的支持</small></div></header>
  <div class="capability-actions"><button type="button" class="agent-secondary" :disabled="disabled||!!running||!model" @click="test('tools')">测试模型工具调用</button><button type="button" class="agent-secondary" :disabled="disabled||!!running||!model" @click="test('image')">测试图片识别</button></div>
  <p v-if="running" class="capability-running" role="status"><span>{{running==='image'?'正在识别两张随机测试图片…':'正在验证工具调用格式…'}}</span><button type="button" class="agent-secondary" :disabled="stopping" @click="stop">{{stopping?'停止中…':'停止检测'}}</button></p>
  <div v-if="profile" class="capability-results" role="status">
   <div><i :class="{passed:profile.tools===true,failed:profile.tools===false}"></i><span><strong>{{profile.tools===undefined?'工具调用尚未检测':profile.tools?'工具调用测试通过。':'工具调用测试未通过。'}}</strong><small v-if="profile.tools!==undefined">{{new Date(profile.toolsTestedAt||profile.testedAt).toLocaleString()}}</small></span></div>
   <div><i :class="{passed:profile.image==='passed',failed:profile.image==='failed'}"></i><span><strong>{{profile.image==='not-tested'?'图片识别尚未检测':profile.image==='passed'?'图片基础测试通过（2 / 2）。':`图片基础测试未通过（${profile.imagePassed||0} / 2）。`}}</strong><small v-if="profile.imageTestedAt">{{new Date(profile.imageTestedAt).toLocaleString()}}</small></span></div>
   <p v-if="profile.error" class="capability-error">{{profile.error}}</p>
   <small class="capability-usage">上次检测：{{profile.lastUsage?profile.lastUsage.totalReports?profile.lastUsage.totalTokens+' Token'+(profile.lastUsage.totalReports<profile.lastUsage.requests?'（部分回报）':''):'未返回 Token 用量':profile.usage?.totalTokens!==undefined?profile.usage.totalTokens+' Token':'未返回 Token 用量'}}<template v-if="profile.elapsedMs!==undefined"> · {{(profile.elapsedMs/1000).toFixed(1)}} 秒</template></small>
  </div>
  <p v-if="notice" class="capability-error" role="status">{{notice}}</p>
  <small class="capability-help">结果按服务与模型保存。图片检测只发送生成的色块图，不读取项目文件。</small>
 </section>
</template>
<style scoped>
.model-capabilities{padding:11px 12px;border:1px solid var(--s-border);border-radius:10px;background:var(--s-muted);font-size:12px}.model-capabilities>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.model-capabilities>header div{display:flex;flex-direction:column;gap:2px}.model-capabilities>header strong{font-size:12px;font-weight:650}.model-capabilities small{display:block;color:var(--s-dim);font-size:10px;line-height:1.5;overflow-wrap:anywhere}.capability-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.model-capabilities button{font:inherit;font-size:11px;line-height:1.4;padding:6px 9px;border:1px solid var(--s-border);border-radius:7px;background:var(--s-panel);color:var(--s-text);cursor:pointer}.model-capabilities button:hover:not(:disabled){border-color:var(--s-dim);background:var(--s-panel)}.model-capabilities button:disabled{opacity:.45;cursor:default}.model-capabilities button:focus-visible{outline:2px solid var(--s-text);outline-offset:2px}.capability-running{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:7px 0 0!important;color:var(--s-dim);line-height:1.5}.capability-results{margin-top:8px;border:1px solid var(--s-border);border-radius:8px;background:var(--s-panel);overflow:hidden}.capability-results>div{display:flex;align-items:center;gap:8px;min-height:34px;padding:5px 9px;border-bottom:1px solid var(--s-border)}.capability-results>div:nth-child(2){border-bottom:0}.capability-results i{width:7px;height:7px;border-radius:50%;background:var(--s-dim);flex:none}.capability-results i.passed{background:var(--s-accent)}.capability-results i.failed{background:var(--s-danger)}.capability-results span{min-width:0}.capability-results strong{display:block;font-size:11px;font-weight:550}.capability-error{margin:7px 0 0!important;color:var(--s-danger);line-height:1.5}.capability-usage{padding:6px 9px;border-top:1px solid var(--s-border)}.capability-help{margin-top:7px}
@media(max-width:520px){.capability-actions{grid-template-columns:1fr}}
</style>
