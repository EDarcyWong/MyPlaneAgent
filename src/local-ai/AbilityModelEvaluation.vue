<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ModelEvaluation } from '../../electron/shared/ability-model-evaluation'
const reports=ref<ModelEvaluation[]>([]), selected=ref(''), baseline=ref(''), busy=ref(false), error=ref('')
const current=computed(()=>reports.value.find(r=>r.id===selected.value)), previous=computed(()=>reports.value.find(r=>r.id===baseline.value))
const passed=(r:ModelEvaluation)=>r.cases.filter(c=>c.passed).length
const tokens=(r:ModelEvaluation)=>r.cases.every(c=>c.usage?.totalTokens!==undefined)&&r.cases.length?r.cases.reduce((sum,c)=>sum+c.usage!.totalTokens!,0):'未完整返回'
const comparable=computed(()=>current.value?.status==='complete'&&previous.value?.status==='complete'&&current.value.suiteHash===previous.value.suiteHash&&current.value.maxTokens===previous.value.maxTokens&&current.value.contextLength===previous.value.contextLength)
const armStats=(arm:'raw'|'assisted')=>{const cases=current.value?.cases.filter(c=>(c.arm||'raw')===arm)||[];return {count:cases.length,passed:cases.filter(c=>c.passed).length,ms:cases.reduce((n,c)=>n+c.elapsedMs,0),tokens:cases.length&&cases.every(c=>c.usage?.totalTokens!==undefined)?cases.reduce((n,c)=>n+c.usage!.totalTokens!,0):'未知'}}
const pairs=computed(()=>{const cases=current.value?.cases||[];return cases.filter(c=>c.arm==='raw').flatMap(raw=>{const assisted=cases.find(c=>c.id===raw.id&&c.arm==='assisted');return assisted?[{raw,assisted}]:[]})})
async function refresh(){reports.value=await window.myplane.localAiStudio('abilityModelEvaluationHistory');if(!reports.value.some(r=>r.id===selected.value))selected.value=reports.value[0]?.id||'';if(!baseline.value)baseline.value=reports.value[1]?.id||'';busy.value=reports.value.some(r=>r.status==='running')}
async function run(paired=false){busy.value=true;error.value='';try{const report=await window.myplane.localAiStudio(paired?'abilityModelComparisonRun':'abilityModelEvaluationRun');selected.value=report.id;await refresh()}catch(cause){error.value=String(cause)}finally{busy.value=false}}
async function cancel(){try{await window.myplane.localAiStudio('abilityModelEvaluationCancel')}catch(cause){error.value=String(cause)}}
let timer:ReturnType<typeof setInterval>|undefined
onMounted(()=>{void refresh().catch(cause=>{error.value=String(cause)});timer=setInterval(()=>{if(busy.value)void refresh().catch(cause=>{error.value=String(cause)})},2000)})
onUnmounted(()=>{if(timer)clearInterval(timer)})
</script>
<template>
  <section class="model-evaluation" aria-label="真实模型场景评测">
    <header><h2>真实模型场景评测</h2><button :disabled="busy" @click="run(false)">{{ busy?'评测中…':'评测当前模型' }}</button><button class="paired-run" :disabled="busy" @click="run(true)">同题对照评测</button><button v-if="busy" @click="cancel">停止评测</button></header>
    <p>调用当前选中的模型，运行六类固定题目，可能产生 API 费用。每题输出最多 512 tokens、限时 45 秒，不执行工具。结果衡量模型答题表现，不代表实际任务执行成功率，也不用于自动发布模块。</p>
    <p>同题对照运行两组，共 12 次题目请求，交替组别顺序。增强组实际运行上下文选择、目标约束提取、意图识别、规划和记忆五个模块，加入其输出作为参考；覆盖辅助理解，不包含工具执行、完成验证或版本发布链路。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="current">
      <label>结果 <select v-model="selected"><option v-for="r in reports" :key="r.id" :value="r.id">{{ r.model }} · {{ new Date(r.createdAt).toLocaleString() }}</option></select></label>
      <label>基线 <select v-model="baseline"><option value="">不对比</option><option v-for="r in reports.filter(r=>r.id!==selected)" :key="r.id" :value="r.id">{{ r.model }} · {{ new Date(r.createdAt).toLocaleString() }}</option></select></label>
      <p role="status">{{ {running:'运行中',complete:'已完成',cancelled:'已停止',interrupted:'运行中断'}[current.status] }} · {{ current.mode==='paired'?'同题对照':'原始模型' }} · 通过 {{ passed(current) }} / {{ current.cases.length }} 题（计划 {{ current.mode==='paired'?12:6 }} 题） · {{ (current.elapsedMs/1000).toFixed(1) }} 秒 · Token：{{ tokens(current) }}；费用未计算。</p>
      <div v-if="current.mode==='paired'" class="paired-results">
        <p v-for="arm in (['raw','assisted'] as const)" :key="arm">{{ arm==='raw'?'原始模型':'启用五个模块' }}：通过 {{ armStats(arm).passed }}/{{ armStats(arm).count }} · {{ armStats(arm).ms }} ms · Token {{ armStats(arm).tokens }}</p>
        <p>已配对 {{ pairs.length }}/6 题 · 改善 {{ pairs.filter(p=>!p.raw.passed&&p.assisted.passed).length }} · 退步 {{ pairs.filter(p=>p.raw.passed&&!p.assisted.passed).length }}。{{ current.status!=='complete'?'本次未完成，不作为完整对照结论。':'单次结果存在模型波动，建议重复评测。' }}</p>
        <details><summary>本次固定的模块版本</summary><p v-for="version in current.moduleVersions" :key="version.moduleId">{{ version.moduleId }} · {{ version.versionId }} · {{ version.hash }}</p></details>
      </div>
      <p v-if="previous&&previous.id!==current.id">{{ comparable?`同题同输出预算，基线 ${passed(previous)}/${previous.cases.length}，通过题数变化 ${passed(current)-passed(previous)}`:'题集、预算或完成状态不同，不直接比较分数。' }}</p>
      <details v-for="item in current.cases" :key="item.id+(item.arm||'raw')"><summary>{{ item.arm==='assisted'?'增强组':'原始组' }} · {{ item.passed?'通过':'失败' }} · {{ item.name }} · {{ item.elapsedMs }} ms</summary><p>{{ item.error }}</p><pre>预期：{{ JSON.stringify(item.expected) }}
回答：{{ item.answer }}</pre></details>
    </template>
    <p v-else>尚无模型评测记录。</p>
  </section>
</template>
<style scoped>
.model-evaluation{border:1px solid var(--s-border);border-radius:12px;padding:18px;margin:20px 0}header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}h2{font-size:17px;margin:0;flex:1}p{color:var(--s-dim);line-height:1.7}button,select{font:inherit;color:inherit;background:var(--s-panel);border:1px solid var(--s-border);border-radius:7px;padding:8px;max-width:100%}button{cursor:pointer}button:disabled{opacity:.5}label{display:inline-block;margin:8px 12px 8px 0}details{padding:10px 0;border-top:1px solid var(--s-border)}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}[role=alert]{color:var(--s-danger)}
</style>
