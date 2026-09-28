<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { abilityModeLabels, type AbilityCatalog, type AbilityModuleDetails, type AbilityModuleMode, type AbilityStageId } from '../../electron/shared/ability-catalog'
import AbilityModuleVersions from './AbilityModuleVersions.vue'
import AbilitySnapshots from './AbilitySnapshots.vue'
import AbilitySourceViewer from './AbilitySourceViewer.vue'
import AbilityAcceptance from './AbilityAcceptance.vue'
import AbilityModelEvaluation from './AbilityModelEvaluation.vue'

const catalog = ref<AbilityCatalog>(), detail = ref<AbilityModuleDetails>()
const stageId = ref<AbilityStageId | 'all'>('all'), mode = ref<AbilityModuleMode | 'all'>('all'), query = ref('')
const busy = ref(false), error = ref(''), dirty = ref(false)
const versions = ref<InstanceType<typeof AbilityModuleVersions>>()
const content = ref<HTMLElement>()
const selectedSource = ref('')
const managedCodeDock = ref<HTMLElement>(), managedCodeOpen = ref(false)
watch(() => detail.value?.module.id, () => { selectedSource.value = ''; managedCodeOpen.value = false })
const currentStage = computed(() => catalog.value?.stages.find(stage => stage.id === detail.value?.module.stageId))
const navigationGroups = computed(() => (catalog.value?.stages || []).map(stage => ({
  ...stage, modules: (catalog.value?.modules || []).filter(module => module.stageId === stage.id && (mode.value === 'all' || module.mode === mode.value) &&
    query.value.trim().toLowerCase().split(/\s+/).every(word => `${module.name} ${module.description} ${module.id} ${stage.name} ${abilityModeLabels[module.mode]}`.toLowerCase().includes(word))),
})).filter(stage => stage.modules.length))
const groups = computed(() => navigationGroups.value.filter(stage => stageId.value === 'all' || stage.id === stageId.value))
const counts = computed(() => Object.fromEntries(Object.keys(abilityModeLabels).map(key => [key, catalog.value?.modules.filter(module => module.mode === key).length || 0])))
const compactModeLabels = { managed: '独立', builtin: '内置', shared: '共用', planned: '待实现' }
const moduleName = (id: string) => catalog.value?.modules.find(module => module.id === id)?.name || id
async function refresh() {
  busy.value = true; error.value = ''
  try { catalog.value = await window.myplane.localAiStudio('abilityCatalog') } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
async function openModule(id: string) {
  if (dirty.value || busy.value) return
  busy.value = true; error.value = ''
  try { detail.value = await window.myplane.localAiStudio('abilityModuleDetails', { moduleId: id }); dirty.value = false; await nextTick(); content.value?.scrollTo(0, 0) }
  catch (cause) { error.value = String(cause) } finally { busy.value = false }
}
async function back(stage: AbilityStageId | 'all' = 'all') {
  if (dirty.value || busy.value) return
  detail.value = undefined; stageId.value = stage; await nextTick(); content.value?.scrollTo(0, 0); await refresh()
}
async function checkKernel() {
  if (!detail.value || busy.value) return
  busy.value = true; error.value = ''
  try { await window.myplane.localAiStudio('abilityKernelCheck',{moduleId:detail.value.module.id}); detail.value = await window.myplane.localAiStudio('abilityModuleDetails',{moduleId:detail.value.module.id}) }
  catch (cause) { error.value = String(cause) } finally { busy.value = false }
}
onMounted(refresh)
</script>

<template>
  <section class="ability-catalog" aria-label="能力模块管理">
    <aside class="ability-sidebar" aria-label="能力模块二级菜单">
      <div class="sidebar-heading"><strong>能力模块</strong><small>六阶段核心能力</small></div>
      <div class="sidebar-filters">
        <input v-model="query" type="search" placeholder="搜索模块…" aria-label="搜索能力模块" />
        <select v-model="mode" aria-label="筛选模块接入方式"><option value="all">全部接入方式</option><option v-for="(label,key) in abilityModeLabels" :key="key" :value="key">{{ label }}</option></select>
        <button v-if="query||mode!=='all'" @click="mode='all';query=''">清除筛选</button>
      </div>
      <nav class="ability-navigation" aria-label="六阶段能力分类">
        <button class="overview-link" :class="{active:!detail&&stageId==='all'}" :aria-current="!detail&&stageId==='all'?'page':undefined" :disabled="dirty||busy" @click="back()">全部模块 <small>{{ catalog?.modules.length || 0 }}</small></button>
        <section v-for="stage in navigationGroups" :key="stage.id" class="navigation-stage">
          <button class="stage-link" :class="{active:!detail&&stageId===stage.id}" :data-stage="stage.id" :disabled="dirty||busy" @click="back(stage.id)"><span>0{{ stage.order }}</span>{{ stage.name }}<small>{{ stage.modules.length }}</small></button>
          <button v-for="module in stage.modules" :key="module.id" class="ability-module-link" :title="`${module.name} · ${abilityModeLabels[module.mode]}`" :class="{active:detail?.module.id===module.id}" :aria-current="detail?.module.id===module.id?'page':undefined" :data-module="module.id" :disabled="dirty||busy" @click="openModule(module.id)"><span>{{ module.name }}</span><small>{{ compactModeLabels[module.mode] }}</small></button>
        </section>
        <p v-if="catalog&&!navigationGroups.length" class="sidebar-empty" role="status">没有匹配的模块</p>
      </nav>
      <p v-if="dirty" class="sidebar-notice">请先保存或放弃右侧修改，再切换模块。</p>
    </aside>
    <main ref="content" class="ability-content" aria-label="能力模块内容" :aria-busy="busy">
    <header v-if="!detail" class="catalog-heading"><div><h1>能力总览</h1><p>六阶段能力 · 版本、实现与评测</p></div><button :disabled="busy" @click="refresh">刷新目录</button></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="catalog">
      <template v-if="!detail">

        <div class="catalog-summary"><strong>{{ catalog.stages.length }} 个阶段 · {{ catalog.modules.length }} 个核心模块</strong><span v-for="(label,key) in abilityModeLabels" :key="key" :class="['mode-badge',key]">{{ label }} {{ counts[key] }}</span></div>
        <section v-for="stage in groups" :key="stage.id" class="stage-group" :aria-label="stage.name"><header><span class="stage-number">0{{ stage.order }}</span><div><h2>{{ stage.name }}</h2><p>{{ stage.description }}</p></div></header><div class="module-grid"><button v-for="module in stage.modules" :key="module.id" :disabled="busy" class="module-card" :data-overview-module="module.id" @click="openModule(module.id)"><div class="card-top"><span :class="['mode-badge',module.mode]">{{ abilityModeLabels[module.mode] }}</span><span v-if="module.protected" class="protected">内核保护</span><span v-else-if="module.runningJob" class="protected">正在优化</span></div><h3>{{ module.name }}</h3><p>{{ module.description }}</p><footer><span v-if="module.mode==='managed'">{{ module.versionCount }} 个版本 · {{ module.problemCount }} 个问题</span><span v-else-if="module.mode==='shared'">版本归属：{{ moduleName(module.ownerModuleId!) }}</span><span v-else>{{ module.mode==='planned'?'尚无独立实现':'随应用更新' }}</span><span aria-hidden="true">→</span></footer></button></div></section>
        <p v-if="!groups.length" class="empty" role="status">没有匹配的模块。请调整阶段、关键词或接入方式。</p>
        <details class="evaluation-tools"><summary>评测与验收</summary><AbilityAcceptance /><AbilityModelEvaluation /></details>
        <p class="catalog-note">“应用内置”表示功能已存在，但尚不支持独立版本替换；“共用实现”的版本由所属模块统一管理。“待实现”不会显示为已启用。</p>
      </template>

      <template v-else>
        <nav class="breadcrumbs" aria-label="模块位置"><button :disabled="dirty||busy" @click="back()">全部模块</button><span>/</span><button :disabled="dirty||busy" @click="back(detail.module.stageId)">{{ currentStage?.name }}</button><span>/</span><strong>{{ detail.module.name }}</strong></nav>
        <p v-if="dirty" class="draft-notice" role="status">有未保存的代码或策略，请先保存或放弃修改再切换模块。<button @click="versions?.discard()">放弃未保存修改</button></p>
        <article class="module-detail-heading"><div class="module-title-row"><h2>{{ detail.module.name }}</h2><span :class="['mode-badge',detail.module.mode]">{{ abilityModeLabels[detail.module.mode] }}</span><span v-if="detail.module.protected" class="protected">内核保护</span></div><p>{{ detail.module.description }}</p></article>
        <details :key="detail.module.id" class="module-specification"><summary>接口与依赖 <small>{{ detail.module.dependencies.length }} 项依赖</small></summary><div class="module-contract"><section><h3>输入</h3><ul><li v-for="item in detail.module.inputs" :key="item">{{ item }}</li></ul></section><section><h3>输出</h3><ul><li v-for="item in detail.module.outputs" :key="item">{{ item }}</li></ul></section><section><h3>依赖模块</h3><div v-if="detail.module.dependencies.length" class="dependency-links"><button v-for="id in detail.module.dependencies" :key="id" :disabled="dirty||busy" @click="openModule(id)">{{ moduleName(id) }}</button></div><p v-else>无前置模块依赖</p></section></div>
        <p class="integration-note">{{ detail.module.integrationNote }}</p><small class="module-id">{{ detail.module.id }}</small></details>
        <AbilityModuleVersions v-if="detail.module.mode==='managed'" :key="detail.module.id" ref="versions" :module-id="detail.module.id" :editor-target="managedCodeDock" @preview="managedCodeOpen=$event" @dirty="dirty=$event"/>
        <section v-else-if="detail.module.mode==='shared'" class="shared-owner"><h3>统一管理共用版本</h3><p>该能力与 {{ moduleName(detail.module.ownerModuleId!) }} 使用同一份代码。切换所属模块的版本也会影响这项能力。</p><button :disabled="busy" @click="openModule(detail.module.ownerModuleId!)">管理 {{ moduleName(detail.module.ownerModuleId!) }}</button></section>
        <section v-else-if="detail.module.mode==='planned'" class="planned-note"><h3>尚待实现与接入</h3><p>该模块已纳入分类目录，目前没有独立的运行代码、版本或评分。实现并注册接口及验收集后，才能启用版本管理。</p></section>
        <section v-if="detail.module.mode!=='managed'  && detail.module.mode!=='planned'" class="implementation"><header><h3>实现文件 <small>{{ detail.sources.length }} · 只读</small></h3><code v-if="detail.implementationVersion">{{ detail.implementationVersion }}</code></header><p v-if="detail.missingSources.length" class="error">以下实现文件不可读取：{{ detail.missingSources.join('、') }}</p><nav class="source-list" aria-label="当前实现文件"><button v-for="source in detail.sources" :key="source.path" :aria-pressed="selectedSource===source.path" :title="source.path" @click="selectedSource=source.path"><span>{{ source.path.split('/').pop() }}</span><small>{{ source.path.substring(0,source.path.lastIndexOf('/')) }}</small><span class="file-arrow" aria-hidden="true">↗</span></button></nav><p v-if="!detail.sources.length">没有可预览的实现文件。</p></section>
        <section v-if="detail.kernelReports" class="kernel-management">
          <header class="section-heading"><div><h3>内核检查</h3><small v-if="detail.kernelReports.length" :class="{error:!detail.kernelReports[0].passed}">{{ detail.kernelReports[0].passed ? '最近检查通过' : '最近检查未通过' }} · {{ new Date(detail.kernelReports[0].createdAt).toLocaleString() }}</small><small v-else>尚未运行检查</small></div><button :disabled="busy" @click="checkKernel">运行检查</button></header>
          <details v-if="detail.kernelReports.length" class="check-history"><summary>检查记录 <small>{{ detail.kernelReports.length }}</small></summary><details v-for="report in detail.kernelReports" :key="report.id"><summary>{{ report.passed?'通过':'未通过' }} · {{ new Date(report.createdAt).toLocaleString() }} · {{ report.tests.length }} 项</summary><ul><li v-for="test in report.tests" :key="test.name" :class="{error:!test.passed}">{{ test.passed?'通过':'失败' }} · {{ test.name }} {{ test.error }}</li></ul></details></details>
          <AbilitySnapshots :key="detail.module.id" :module-id="detail.module.id" :archives="detail.archives || []" :current-id="catalog.storage?.snapshotId" />
        </section>

      </template>
    <details v-if="catalog?.storage" class="storage-info"><summary>已保存到本机 · 升级与重装后继续使用</summary><p>保存位置：<code>{{ catalog.storage.directory }}</code></p><p>保留模块目录、内置实现快照，以及已接入模块的代码版本、评分、评测、问题和优化记录。同一电脑、同一用户沿用此目录即可恢复；使用自定义目录时，重装后需继续指定原目录。</p><p>备份时请先退出应用，再复制整个目录。手动删除用户数据、重装系统或磁盘损坏仍需从备份恢复。</p></details>
    </template>
    <p v-else-if="!error" role="status">正在读取能力模块目录…</p>
    </main>
    <div v-show="managedCodeOpen" ref="managedCodeDock" class="managed-code-dock" aria-label="模块代码侧栏" />
    <AbilitySourceViewer v-if="detail && selectedSource" :key="detail.module.id" :sources="detail.sources" :selected-path="selectedSource" @select="selectedSource=$event" @close="selectedSource=''" />
  </section>
</template>

<style scoped>
.ability-catalog{padding:28px;overflow:auto;min-width:0;height:100%;box-sizing:border-box;color:var(--s-text);font-size:13px}.catalog-heading{display:flex;align-items:center;justify-content:space-between;gap:20px}.eyebrow{font-size:11px;letter-spacing:1px;color:var(--s-dim)}h1{font-size:25px;margin:8px 0}h2{font-size:17px;margin:0 0 6px}h3{font-size:14px;margin:0 0 10px}p{line-height:1.7;color:var(--s-dim);margin:8px 0}small{color:var(--s-dim)}button,input,select{font:inherit;color:inherit;background:var(--s-panel);border:1px solid var(--s-border);border-radius:7px;padding:9px;min-width:0;box-sizing:border-box}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--s-accent);outline-offset:3px}.catalog-summary{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:24px 0 18px}.catalog-summary>strong{margin-right:10px}.mode-badge{display:inline-block;border-radius:5px;font-size:11px;font-weight:500;padding:4px 7px;background:var(--s-muted);color:var(--s-dim);white-space:nowrap}.mode-badge.managed{color:var(--s-accent);background:var(--s-accent-soft)}.mode-badge.planned{border:1px dashed var(--s-border);background:none}.stage-number{flex-shrink:0;white-space:nowrap;font-family:Consolas,monospace;font-size:18px;color:var(--s-dim)}.stage-group{margin:28px 0}.stage-group>header{display:flex;gap:14px;align-items:flex-start;margin-bottom:14px}.stage-group>header p{margin:0}.module-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.module-card{display:flex;flex-direction:column;text-align:left;padding:18px;border-radius:12px;min-width:0;transition:border-color .15s}.module-card:hover{border-color:var(--s-accent)}.card-top{display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap}.protected{font-size:11px;color:var(--s-dim);margin-left:5px}.module-card h3{font-size:15px;line-height:1.5;margin:0}.module-card p{flex:1;font-size:12px;margin:8px 0 18px}.module-card footer{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--s-dim);border-top:1px solid var(--s-border);padding-top:12px}.catalog-note,.integration-note,.draft-notice{padding:14px 16px;border-radius:8px;background:var(--s-muted)}.empty{padding:50px;text-align:center}.breadcrumbs{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:24px 0}.breadcrumbs button{border:0;background:none;padding:2px;color:var(--s-dim)}.module-detail-heading{padding:20px;border:1px solid var(--s-border);border-radius:12px;background:var(--s-panel)}.module-detail-heading h2{font-size:22px;margin:14px 0 8px}.module-contract{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin:24px 0}.module-contract section{min-width:0}.module-contract ul{padding-left:18px;color:var(--s-dim);line-height:1.9}.dependency-links{display:flex;flex-wrap:wrap;gap:7px}.dependency-links button{font-size:12px;padding:6px 9px}.shared-owner,.planned-note,.implementation{margin-top:20px;padding:20px;border:1px solid var(--s-border);border-radius:12px}.implementation header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.implementation code{font-size:12px;color:var(--s-dim)}.implementation details{margin-top:14px}.implementation summary{cursor:pointer;overflow-wrap:anywhere;line-height:1.7}.implementation pre{max-height:440px;overflow:auto;padding:16px;background:var(--s-bg);font-size:12px;line-height:1.7;border-radius:8px}.draft-notice{display:flex;justify-content:space-between;gap:12px;align-items:center}.error{color:var(--s-danger)}:deep(.ability-manager){padding:20px 0 0;overflow:visible;height:auto}@media(max-width:1150px){.module-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:750px){.ability-catalog{padding:16px}.module-grid,.module-contract{grid-template-columns:1fr}.catalog-heading{align-items:flex-start}.catalog-summary{gap:6px}.catalog-summary>strong{width:100%;margin-bottom:6px}}
.catalog-heading>button{flex-shrink:0;white-space:nowrap}
.kernel-management{margin-top:20px;padding:20px;border:1px solid var(--s-border);border-radius:12px}.kernel-management details{margin:12px 0}.kernel-management summary{cursor:pointer}.kernel-management li{line-height:1.8}.kernel-management h3{margin-top:16px}.storage-info{margin-top:16px;padding:12px 14px;border:1px solid var(--s-border);border-radius:8px;color:var(--s-dim);font-size:12px}.storage-info summary{cursor:pointer}.storage-info code{user-select:text;overflow-wrap:anywhere}

.ability-catalog{position:relative;display:flex;padding:0;overflow:hidden;min-height:0}
.ability-sidebar{width:238px;flex:0 0 238px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--s-border);background:var(--s-panel)}
.sidebar-heading{display:grid;gap:6px;padding:24px 18px 16px}.sidebar-heading strong{font-size:17px}
.sidebar-filters{display:grid;gap:8px;padding:0 14px 14px}.sidebar-filters input,.sidebar-filters select{width:100%}
.ability-navigation{overflow-y:auto;min-height:0;flex:1;padding:4px 10px 20px;scrollbar-gutter:stable}
.ability-navigation button{width:100%;border:0;background:transparent;text-align:left}
.overview-link{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.navigation-stage{margin-bottom:8px}.stage-link{display:flex;align-items:center;gap:7px;font-weight:600;font-size:12px;line-height:1.6}.stage-link>span{font-size:11px;color:var(--s-dim)}.stage-link>small{margin-left:auto}
.ability-module-link{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;padding:6px 8px 6px 18px;margin:0;line-height:1.5;font-size:12px}.ability-module-link>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ability-module-link small{white-space:nowrap}.ability-module-link small{font-size:10px}
.ability-navigation button:hover:not(:disabled){background:var(--s-muted)}.ability-navigation button.active{color:var(--s-accent);background:var(--s-accent-soft)}.ability-module-link.active small{color:inherit}
.sidebar-empty,.sidebar-notice{padding:10px 16px;font-size:12px}.sidebar-notice{border-top:1px solid var(--s-border);margin:0}
.ability-content{flex:1;min-width:0;overflow:auto;padding:28px;container-type:inline-size;scrollbar-gutter:stable;overflow-wrap:anywhere}
@container(max-width:850px){.module-grid{grid-template-columns:repeat(2,minmax(0,1fr))}:deep(.versions-layout){grid-template-columns:1fr}:deep(.page-heading),:deep(.module-overview),:deep(.job-strip),:deep(.version-detail>header){align-items:flex-start;flex-wrap:wrap}:deep(.code-grid.comparison){grid-template-columns:1fr}:deep(.save-row),:deep(.rating-row){flex-wrap:wrap}}
@container(max-width:540px){.module-grid,.module-contract{grid-template-columns:1fr}.catalog-heading{flex-wrap:wrap}.catalog-summary>strong{width:100%}.draft-notice{align-items:flex-start;flex-direction:column}.module-detail-heading,.shared-owner,.planned-note,.implementation{padding:14px}:deep(.policy-grid){grid-template-columns:1fr}:deep(.tabs){flex-wrap:wrap;gap:10px}:deep(.code-toolbar){flex-wrap:wrap;gap:8px}}
@media(max-width:1100px){.ability-sidebar{width:206px;flex-basis:206px}.ability-content{padding:20px}}
@media(max-width:750px){.ability-sidebar{width:166px;flex-basis:166px}.ability-content{padding:14px}.sidebar-heading{padding:18px 12px 14px}.sidebar-filters{padding:0 10px 10px}.ability-navigation{padding:4px 6px 14px}.stage-link{flex-wrap:wrap;gap:4px}.stage-link>small{display:none}.ability-module-link{padding-left:10px}.ability-module-link small{display:none}}
.source-list{display:flex;flex-direction:column;gap:0;min-width:0}.source-list button{text-align:left;padding:7px 8px;border:0;background:transparent;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-list button:hover{background:var(--s-muted)}.source-list button[aria-pressed=true]{color:var(--s-accent);background:var(--s-accent-soft)}

/* Compact content hierarchy: actions first, supporting information on demand. */
.ability-content{padding:24px;min-height:0}.catalog-heading{gap:12px;margin-bottom:20px}.catalog-heading h1{font-size:22px;margin:0}.catalog-heading p{font-size:12px;margin:5px 0 0}.catalog-heading>button{font-size:12px;padding:6px 10px}
.breadcrumbs{font-size:11px;gap:8px;margin:0 0 18px}.breadcrumbs strong{font-weight:500}.module-detail-heading{padding:0 0 16px;border:0;border-bottom:1px solid var(--s-border);border-radius:0;background:transparent}.module-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.module-detail-heading h2{font-size:21px;margin:0 4px 0 0;line-height:1.4}.module-detail-heading p{font-size:12px;margin:8px 0 0;max-width:760px}.protected{margin:0}
.module-specification{padding:12px 0;border-bottom:1px solid var(--s-border);font-size:12px}.module-specification>summary,.evaluation-tools>summary{cursor:pointer;color:var(--s-dim);font-size:12px}.module-specification summary small{margin-left:8px;font-size:11px}.module-contract{gap:16px;margin:16px 0}.module-contract h3{font-size:12px;margin:0}.module-contract ul{margin:6px 0}.integration-note{background:var(--s-muted);font-size:12px;padding:10px 12px}.module-id{font-family:monospace;font-size:11px}
.implementation,.kernel-management,.shared-owner,.planned-note{margin-top:18px;padding:16px;border-radius:10px;background:var(--s-panel)}.implementation header{align-items:center;gap:8px}.implementation h3,.kernel-management h3{margin:0;font-size:13px}.implementation h3 small{font-size:11px;font-weight:400;margin-left:6px}.implementation header code{font-size:10px;overflow-wrap:anywhere}.source-list{margin-top:6px}.source-list button{display:flex;align-items:center;gap:8px;border-radius:4px;padding:4px 8px;line-height:18px;min-height:26px;height:26px;margin:0}.source-list button>span:first-child{flex-shrink:0}.source-list small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.file-arrow{margin-left:auto;color:var(--s-dim);flex:none}
.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.section-heading>div{display:grid;gap:5px}.section-heading small{font-size:11px}.section-heading button{font-size:12px;padding:6px 10px;white-space:nowrap}.check-history{font-size:12px}.check-history>summary{color:var(--s-dim)}.storage-info{border:0;border-top:1px solid var(--s-border);border-radius:0;padding:12px 0;margin-top:24px;font-size:11px}.evaluation-tools{margin:20px 0;padding:14px;border:1px solid var(--s-border);border-radius:10px}.catalog-summary{margin:0 0 18px;gap:8px;font-size:12px}.stage-group{margin:22px 0}.module-card{padding:14px;border-radius:10px}.module-card p{margin-bottom:12px}.catalog-note{font-size:11px;padding:10px 12px}
@container(max-width:540px){.module-title-row h2{font-size:18px}.implementation,.kernel-management,.shared-owner,.planned-note{padding:12px}.source-list small{display:none}.module-contract{grid-template-columns:1fr}.implementation header code{max-width:100%}}
.managed-code-dock{flex:0 0 48%;width:48%;height:100%;min-width:0;min-height:0;overflow:hidden;border-left:1px solid var(--s-border);background:var(--s-panel);box-sizing:border-box}
@media(max-width:900px){.managed-code-dock{position:absolute;inset:0 0 0 auto;width:75%;z-index:10;box-shadow:-8px 0 24px #0002}}
</style>
