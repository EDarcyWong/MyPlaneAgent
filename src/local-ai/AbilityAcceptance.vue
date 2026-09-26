<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { abilityStages, type AbilityAcceptanceReport } from '../../electron/shared/ability-catalog'
const reports = ref<AbilityAcceptanceReport[]>([]), selected = ref(''), baseline = ref(''), busy = ref(false), error = ref('')
const current = computed(() => reports.value.find(r => r.id === selected.value))
const previous = computed(() => reports.value.find(r => r.id === baseline.value))
const total = (r?: AbilityAcceptanceReport) => r?.modules.flatMap(m => m.tests) || []
const passed = (r?: AbilityAcceptanceReport) => total(r).filter(t => t.passed).length
const comparable = computed(() => !!current.value && !!previous.value && current.value.catalogId === previous.value.catalogId && current.value.modules.length === previous.value.modules.length && current.value.modules.every(m => previous.value!.modules.some(p => p.moduleId === m.moduleId && p.suiteHash === m.suiteHash)))
async function refresh() {
  reports.value = await window.myplane.localAiStudio('abilityAcceptanceHistory')
  selected.value = reports.value[0]?.id || ''; baseline.value = reports.value[1]?.id || ''
}
async function run() {
  busy.value = true; error.value = ''
  try { await window.myplane.localAiStudio('abilityAcceptanceRun'); await refresh() }
  catch (cause) { error.value = String(cause) } finally { busy.value = false }
}
onMounted(() => refresh().catch(cause => { error.value = String(cause) }))
</script>
<template>
  <section class="acceptance" aria-label="六阶段验收">
    <header><h2>六阶段验收与对比</h2><button :disabled="busy" @click="run">{{ busy ? '正在评测…' : '一键评测' }}</button></header>
    <p>本地回归使用模块验收案例、已记录的问题和内核检查，不调用模型或真实业务工具。通过率不代表真实模型任务成功率。报告永久保存在本机。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!reports.length">尚无评测记录，运行后可查看六阶段结果和失败原因。</p>
    <template v-if="current">
      <div class="selectors"><label>本次结果 <select v-model="selected"><option v-for="r in reports" :key="r.id" :value="r.id">{{ new Date(r.createdAt).toLocaleString() }}</option></select></label><label>对比基线 <select v-model="baseline"><option value="">不对比</option><option v-for="r in reports.filter(r=>r.id!==selected)" :key="r.id" :value="r.id">{{ new Date(r.createdAt).toLocaleString() }}</option></select></label></div>
      <p role="status">通过 {{ passed(current) }} / {{ total(current).length }} 项 · 耗时 {{ (current.elapsedMs/1000).toFixed(1) }} 秒</p>
      <p v-if="previous && previous.id!==current.id">基线通过 {{ passed(previous) }} / {{ total(previous).length }} 项。{{ comparable ? `相同评测集，通过项变化：${passed(current)-passed(previous)}` : '评测集或应用实现已变化，分数不可直接比较。' }}</p>
      <details v-for="stage in abilityStages" :key="stage.id"><summary>{{ stage.name }} · {{ current.modules.filter(m=>m.stageId===stage.id).flatMap(m=>m.tests).filter(t=>t.passed).length }} / {{ current.modules.filter(m=>m.stageId===stage.id).flatMap(m=>m.tests).length }} 通过</summary>
        <div v-for="module in current.modules.filter(m=>m.stageId===stage.id)" :key="module.moduleId"><strong>{{ module.moduleId }}</strong><small> · 版本 {{ module.version }}</small><ul><li v-for="(test,index) in module.tests" :key="index" :class="{failed:!test.passed}">{{ test.passed?'通过':'失败' }} · {{ test.name }} <span v-if="test.error">{{ test.error }}</span></li></ul></div>
      </details>
    </template>
  </section>
</template>
<style scoped>
.acceptance{margin:20px 0;padding:18px;border:1px solid var(--s-border);border-radius:12px}.acceptance header,.selectors{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}h2{font-size:17px;margin:0}p,small{color:var(--s-dim);line-height:1.7}button,select{font:inherit;color:inherit;background:var(--s-panel);border:1px solid var(--s-border);border-radius:7px;padding:8px}button{cursor:pointer}button:disabled{opacity:.5}details{border-top:1px solid var(--s-border);padding:12px 0}summary{cursor:pointer}details>div{padding:12px 0;overflow-wrap:anywhere}li{line-height:1.8}.failed,[role=alert]{color:var(--s-danger)}
</style>
