<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { formatCodePreview } from './formatCodePreview'
import { Refresh, FullScreen, ScaleToOriginal, Close, MoreFilled, Check } from '@element-plus/icons-vue'
import type { AbilityModuleCommands, ConversationIntent, RouterInput, RouteAction, ModulePolicy, ModuleSnapshot, ModuleVersion, ModuleReport } from '../../electron/shared/ability-modules'

const CodeEditor = defineAsyncComponent(() => import('./SkillCodeEditor.vue'))
const editorOpen = ref(false)
const toolsOpen = ref(false), toolsRoot = ref<HTMLElement>(), toolsButton = ref<HTMLButtonElement>()
const toolsId = useId()
function closeTools(focus = false) { toolsOpen.value = false; if (focus) toolsButton.value?.focus() }
function outsideTools(event: PointerEvent) { if (event.target instanceof Node && !toolsRoot.value?.contains(event.target)) closeTools() }
function codeTool(action: 'format' | 'wrap' | 'compare') {
  closeTools(true)
  if (action === 'format') void formatCode()
  else if (action === 'wrap') wrapLines.value = !wrapLines.value
  else comparison.value = !comparison.value
}
const editorExpanded = ref(false), wrapLines = ref(false), formatting = ref(false), formatError = ref('')
const codeEditor = ref<InstanceType<typeof CodeEditor>>()
async function formatCode() {
 if (busy.value || formatting.value) return
 formatting.value = true; formatError.value = ''
 try { await codeEditor.value?.formatCode() } catch (cause) { formatError.value = `格式化失败，请检查语法：${cause instanceof Error ? cause.message : String(cause)}` }
 finally { formatting.value = false }
}
const props = defineProps<{ moduleId: string; editorTarget?: HTMLElement }>()
const emit = defineEmits<{ dirty: [value: boolean]; preview: [value: boolean] }>()
function closeEditor() { closeTools(); editorOpen.value = false; editorExpanded.value = false }
watch(editorOpen, value => emit('preview', value))
function moduleCall<K extends keyof AbilityModuleCommands>(action: K, payload?: AbilityModuleCommands[K]['input']): Promise<AbilityModuleCommands[K]['output']> {
  return window.myplane.localAiStudio(action, { ...payload, moduleId: props.moduleId } as AbilityModuleCommands[K]['input'])
}

const snapshot = ref<ModuleSnapshot>(), selected = ref<ModuleVersion>(), parent = ref<ModuleVersion>()
const codeBaseline = ref(''), parentCode = ref('')
let selectionRequest = 0
const busy = ref(false), error = ref(''), notice = ref(''), code = ref(''), reason = ref('')
const section = ref<'versions' | 'problems' | 'policy'>('versions'), comparison = ref(false)
watch(section, closeEditor)
const policy = ref<ModulePolicy>()
const feedbackInput = ref(''), feedbackExpected = ref('')
const genericFeedback = computed(() => !!snapshot.value?.feedbackExample)
const description = ref(''), sample = ref(props.moduleId === 'task-message-router' ? '继续' : '整理今天的数据\n改成昨天'), expectedIntent = ref<ConversationIntent>(props.moduleId === 'task-message-router' ? 'continue' : 'correction')
const isRouter = computed(() => props.moduleId === 'task-message-router')
const taskStatus = ref<RouterInput['taskStatus']>('paused'), hasAttachments = ref(false), expectedAction = ref<RouteAction>('continue')
const routeLabels: Record<RouteAction, string> = { new_task: '建立新任务', continue: '继续任务', amend: '补充或纠正', progress: '查询进度', cancel: '暂停后续执行', clarify: '澄清目标', respond: '普通回答' }
const taskLabels: Record<RouterInput['taskStatus'], string> = { none: '没有任务', ready: '待继续', paused: '已暂停', complete: '上轮报告完成', blocked: '上轮受阻', needs_input: '等待信息' }
const isSelection = computed(() => props.moduleId === 'state-context-selection')
const requiredLines = ref('1'), expectedLines = ref('1,2'), maxMessages = ref(80), maxCharacters = ref(60000)
const rating = ref(5), ratingNote = ref('')
const reports = ref<ModuleReport[]>([])
const intents: Record<ConversationIntent, string> = { new_task: '新任务', supplement: '补充要求', correction: '纠正信息', progress: '查询进度', continue: '继续', cancel: '取消', question: '普通问答' }
const versionView = computed(() => snapshot.value?.versions.find(version => version.id === selected.value?.id))
const activeJob = computed(() => snapshot.value?.jobs.find(job => ['queued', 'analyzing', 'testing'].includes(job.phase)))
const changed = computed(() => !!selected.value && code.value !== codeBaseline.value)
watch(() => changed.value || (!!policy.value && !!snapshot.value && JSON.stringify(policy.value) !== JSON.stringify(snapshot.value.policy)), value => emit('dirty', value))
const label = (id?: string) => id === 'bundled-v1' ? '内置基线' : id?.slice(0, 8) || '—'
const date = (value: string) => new Date(value).toLocaleString()
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false

async function openVersion(id: string) {
 if (busy.value || (changed.value && selected.value?.id !== id)) return
 await run(async () => { if (selected.value?.id !== id) await select(id); editorOpen.value = true })
}
async function select(id: string) {
  const request = ++selectionRequest
  const version = await moduleCall('abilityModuleVersion', { id })
  const [formatted, parentVersion] = await Promise.all([
    formatCodePreview(version.code),
    version.parentId ? moduleCall('abilityModuleVersion', { id: version.parentId }) : Promise.resolve(undefined),
  ])
  const formattedParent = parentVersion ? await formatCodePreview(parentVersion.code) : ''
  if (disposed || request !== selectionRequest) return
  selected.value = version; parent.value = parentVersion
  codeBaseline.value = formatted; code.value = formatted; parentCode.value = formattedParent
  reason.value = ''; comparison.value = false; formatError.value = ''
}
async function refresh() {
  const next = await moduleCall('abilityModules')
  const policyWasClean = !policy.value || !snapshot.value || JSON.stringify(policy.value) === JSON.stringify(snapshot.value.policy)
  snapshot.value = next
  if (next.feedbackExample && !feedbackInput.value) { feedbackInput.value = JSON.stringify(next.feedbackExample.input,null,2); feedbackExpected.value = JSON.stringify(next.feedbackExample.expected,null,2) }
  if (policyWasClean) policy.value = { ...next.policy }
  if (!selected.value) await select(snapshot.value.activeId)
  if (selected.value) reports.value = await moduleCall('abilityModuleReports', { id: selected.value.id })
}
async function run(work: () => Promise<unknown>, message = '') {
  busy.value = true; error.value = ''; notice.value = ''
  try { await work(); await refresh(); notice.value = message } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
function saveDraft() { if (!busy.value && changed.value && reason.value.trim()) void run(save, '新版本已保存，请运行测试') }
async function save() {
  if (!selected.value) return
  const version = await moduleCall('abilityModuleSave', { parentId: selected.value.id, code: code.value, reason: reason.value })
  await select(version.id)
}
async function report() {
  const messages = sample.value.split('\n').filter(line => line.trim())
  if (genericFeedback.value) {
    await moduleCall('abilityModuleFeedback', {description:description.value,input:JSON.parse(feedbackInput.value),expected:JSON.parse(feedbackExpected.value)})
  } else if (isRouter.value) {
    await moduleCall('abilityModuleRouterProblem', { description: description.value, input: { messages: [{id:'current',text:sample.value.trim()}], intent: expectedIntent.value, taskStatus: taskStatus.value, hasAttachments: hasAttachments.value }, expected: {action:expectedAction.value} })
  } else if (isSelection.value) {
    const ids = (text: string) => text.trim() ? text.split(/[,，\s]+/).map(value => {
      const line = Number(value)
      if (!Number.isInteger(line) || line < 1 || line > messages.length) throw new Error('消息编号必须是样例中存在的行号')
      return `m${line}`
    }) : []
    await moduleCall('abilityModuleSelectionProblem', { description: description.value,
      input: { messages: messages.map((text, index) => ({ id: `m${index + 1}`, text })), requiredIds: [...new Set([...ids(requiredLines.value), `m${messages.length}`])], maxMessages: maxMessages.value, maxCharacters: maxCharacters.value },
      expected: { selectedMessageIds: ids(expectedLines.value) } })
  } else await moduleCall('abilityModuleProblem', { description: description.value, messages, expectedIntent: expectedIntent.value })
  description.value = ''
}
async function poll() {
  try { if (!busy.value) await refresh() } catch (cause) { error.value = String(cause) }
  if (!disposed) timer = setTimeout(poll, 4000)
}
onMounted(() => { document.addEventListener('pointerdown', outsideTools); void poll() })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outsideTools); emit('preview', false); disposed = true; if (timer) clearTimeout(timer) })
defineExpose({ discard() { if (selected.value) code.value = codeBaseline.value; if (snapshot.value) policy.value = { ...snapshot.value.policy }; reason.value = '' } })
</script>

<template>
  <section class="ability-manager" aria-label="能力模块管理">
    <header class="page-heading"><div class="module-current"><span v-if="snapshot" class="pill">使用中 · {{ label(snapshot.activeId) }}</span><small>切换版本后，下一轮对话生效</small></div><button :disabled="busy" class="refresh-module" aria-label="刷新模块" title="刷新模块" @click="run(refresh)"><Refresh aria-hidden="true"/></button></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <template v-if="snapshot">

      <div class="job-strip"><details :open="!!activeJob"><summary><strong>{{ activeJob ? '正在优化' : '自动改进' }}</strong><span>{{ activeJob ? activeJob.message : snapshot.policy.autoOptimize ? '已开启' : '已关闭' }}</span></summary><p>{{ activeJob?.message || snapshot.optimization?.reason || (snapshot.policy.autoOptimize ? '达到问题阈值后分析，自动切换取决于发布策略。' : '可手动分析已记录的问题。') }}</p><small>每天最多 {{ snapshot.policy.maxAttemptsPerDay }} 次 · 单次 {{ snapshot.policy.timeoutSeconds }} 秒 · 每组问题最多自动尝试 3 次<span v-if="snapshot.optimization?.nextRetryAt"> · 下次重试 {{date(snapshot.optimization.nextRetryAt)}}</span></small></details><button v-if="activeJob" :disabled="busy" @click="run(()=>moduleCall('abilityModuleCancel'),'已请求停止优化')">停止优化</button><button v-else :disabled="busy || !snapshot.problems.length" @click="run(()=>moduleCall('abilityModuleOptimize'),'优化已启动，可以继续使用应用')">分析问题</button></div>
      <nav class="tabs" aria-label="模块管理页面"><button v-for="item in [{id:'versions',label:'代码与版本'},{id:'problems',label:'问题记录'},{id:'policy',label:'改进策略'}] as const" :key="item.id" :class="{active:section===item.id}" :aria-current="section===item.id?'page':undefined" @click="section=item.id">{{ item.label }}</button></nav>

      <div v-if="section==='versions'" class="versions-layout">
        <aside class="version-list" aria-label="历史版本"><div class="version-list-heading">版本文件 <small>{{ snapshot.versions.length }}</small></div><button v-for="version in snapshot.versions" :key="version.id" :disabled="busy || (changed && selected?.id!==version.id)" :class="{selected:editorOpen && selected?.id===version.id}" :aria-pressed="editorOpen && selected?.id===version.id" :title="version.reason" @click="openVersion(version.id)"><strong>{{ label(version.id) }}.js</strong><b v-if="version.id===snapshot.activeId">使用中</b><b v-else-if="version.quarantined" class="error">运行异常</b><small>{{ date(version.createdAt) }}</small><span class="version-score">{{ version.report ? `${version.report.score} 分` : '未测试' }}</span><span class="version-arrow" aria-hidden="true">↗</span></button></aside>
            <details v-if="selected" class="version-options version-detail"><summary>版本 {{ label(selected.id) }} · 评测与管理</summary>
          <header><div><h2>版本 {{ label(selected.id) }}</h2><small>父版本 {{ label(selected.parentId) }} · API {{ selected.apiVersion }}</small></div><div class="actions"><button :disabled="busy || changed" @click="run(()=>moduleCall('abilityModuleTest',{id:selected!.id}),'评测完成，报告已保留')">运行测试</button><button :disabled="busy || changed || selected.id===snapshot.activeId" @click="run(()=>moduleCall('abilityModuleActivate',{id:selected!.id}),'已通过重新评测并切换版本')">测试并使用</button></div></header>

          <details v-if="versionView?.report" class="report"><summary><strong>{{ versionView.report.score }} <small>/ 100</small></strong><span>{{ versionView.report.tests.filter(test=>test.passed).length }} / {{ versionView.report.tests.length }} 项通过</span><span class="report-time">{{ versionView.report.elapsedMs }} ms</span><span>测试报告</span></summary><ul><li v-for="test in versionView.report.tests" :key="test.name" :class="{error:!test.passed}">{{ test.passed?'通过':'失败' }} · {{ test.name }} <span v-if="test.error">— {{ test.error }}</span></li></ul><small>{{ date(versionView.report.createdAt) }}</small></details>
          <details class="code-contract"><summary>运行接口与约束</summary><p>{{ snapshot.contract }} 代码在受限沙箱运行，没有文件、网络或进程接口。</p><p>切换版本必须通过当前全部回归案例，用户评分不替代测试。</p></details>

          <details class="rating-details"><summary>体验评分 <small>{{ versionView?.ratings.length || 0 }} 条记录</small></summary><div class="rating-row"><label>体验评分<select v-model.number="rating"><option v-for="n in 5" :key="n" :value="n">{{ n }} 星</option></select></label><input v-model="ratingNote" maxlength="2000" aria-label="评分备注" placeholder="在哪些场景表现更好？"/><button :disabled="busy" @click="run(()=>moduleCall('abilityModuleRate',{id:selected!.id,score:rating,note:ratingNote}),'评分已保存')">记录评分</button></div>
          <ul v-if="versionView?.ratings.length" class="ratings"><li v-for="item in versionView.ratings" :key="item.id">{{ item.score }} 星 · {{ item.note || '无备注' }} · {{ date(item.createdAt) }}</li></ul></details>
          <details v-if="reports.length"><summary>全部历史评测 · {{ reports.length }} 次</summary><details v-for="report in reports" :key="report.id"><summary>{{ date(report.createdAt) }} · {{ report.score }} 分 · {{ report.tests.length }} 项</summary><ul><li v-for="test in report.tests" :key="test.name" :class="{error:!test.passed}">{{ test.passed?'通过':'失败' }} · {{ test.name }} {{ test.error }}</li></ul></details></details>
</details>

          <Teleport v-if="editorOpen && selected" :to="editorTarget || 'body'" :disabled="!editorTarget">
          <section class="code-workspace docked" :class="{ expanded: editorExpanded }" aria-label="模块代码编辑区" @keydown.esc="editorExpanded ? editorExpanded=false : closeEditor()">
            <header class="managed-panel-heading"><strong>模块代码 <small>{{ changed ? '未保存' : '可编辑' }}</small></strong><div><span v-if="editorExpanded" class="fullscreen-hint" role="status">按 <kbd>Esc</kbd> 退出全屏</span><div ref="toolsRoot" class="code-tools" @keydown.esc.stop="closeTools(true)"><button ref="toolsButton" class="icon-button" aria-label="代码工具" title="代码工具" :aria-expanded="toolsOpen" :aria-controls="toolsId" @click="toolsOpen=!toolsOpen"><MoreFilled aria-hidden="true"/></button><div v-if="toolsOpen" :id="toolsId" class="code-tools-menu" role="group" aria-label="代码工具"><button :disabled="busy || formatting" @click="codeTool('format')"><span>{{ formatting?'格式化中…':'格式化代码' }}</span></button><button :aria-pressed="wrapLines" @click="codeTool('wrap')"><span>自动换行</span><Check v-if="wrapLines" aria-hidden="true"/></button><button v-if="parent" :disabled="busy" :aria-pressed="comparison" @click="codeTool('compare')"><span>对照父版本</span><Check v-if="comparison" aria-hidden="true"/></button></div></div><button class="icon-button" :title="editorExpanded?'退出全屏（Esc）':'放大'" :aria-label="editorExpanded?'退出代码全屏':'放大代码编辑区'" :aria-pressed="editorExpanded" @click="editorExpanded=!editorExpanded"><ScaleToOriginal v-if="editorExpanded" aria-hidden="true"/><FullScreen v-else aria-hidden="true"/></button><button class="icon-button" title="关闭" aria-label="关闭代码编辑区" @click="closeEditor"><Close aria-hidden="true"/></button></div></header>
            <div class="managed-panel-file"><select :value="selected.id" :disabled="busy || changed" aria-label="切换代码版本" @change="openVersion(($event.target as HTMLSelectElement).value)"><option v-for="version in snapshot.versions" :key="version.id" :value="version.id">{{ moduleId }}.js · {{ label(version.id) }}{{ version.id===snapshot.activeId ? ' · 使用中' : '' }}</option></select></div>
            <p v-if="error" class="format-error error" role="alert">{{ error }}</p>
            <p v-if="formatError" class="format-error error" role="alert">{{ formatError }}</p>
            <div class="code-panes" :class="{ comparison }">
              <div v-if="comparison && parent" class="editor-pane parent-pane"><div class="pane-caption">父版本 · {{ label(parent.id) }} <small>只读</small></div><CodeEditor :key="parent.id" :model-value="parentCode" :filename="`${moduleId}-parent.js`" :wrap-lines="wrapLines" readonly /></div>
              <div class="editor-pane"><div v-if="comparison" class="pane-caption">当前编辑 · {{ label(selected.id) }}</div><CodeEditor :key="selected.id" ref="codeEditor" v-model="code" class="managed-code-editor" :filename="`${moduleId}.js`" :readonly="busy" :wrap-lines="wrapLines" @save="saveDraft" /></div>
            </div>
            <div v-if="changed || reason.trim()" class="save-row"><input v-model="reason" :disabled="busy" maxlength="2000" placeholder="填写修改原因，另存为新版本" aria-label="修改原因"/><button v-if="changed" :disabled="busy" @click="code=codeBaseline">撤销编辑</button><button class="save-version" :disabled="busy || !changed || !reason.trim()" @click="saveDraft">保存新版本</button></div>
          </section>
          </Teleport>
      </div>

      <div v-else-if="section==='problems'" class="records">
        <article v-if="snapshot.observations?.length"><h2>任务失败归因</h2><p>没有独立预期结果的失败仅作为诊断，不自动修改模块。</p><p v-for="item in snapshot.observations" :key="item.id">{{date(item.createdAt)}} · {{item.message}}</p></article>
        <article v-if="genericFeedback" class="generic-feedback"><h2>添加专属回归案例</h2><p>以接口示例为起点填写输入和预期结果。来源、权限与容量校验不能由反馈绕过。</p><label>问题说明<input v-model="description" maxlength="2000"/></label><label>输入 JSON<textarea v-model="feedbackInput" rows="8" spellcheck="false" aria-label="策略反馈输入"/></label><label>预期输出 JSON<textarea v-model="feedbackExpected" rows="6" spellcheck="false" aria-label="策略反馈预期"/></label><button :disabled="busy||!description.trim()" @click="run(report,'专属案例已保存')">记录问题</button></article><article v-else><h2>添加可复现问题</h2><p>{{ isRouter ? '填写当前用户消息、已识别意图、任务状态和预期动作。' : '每行填写一条用户消息。' }}{{ isRouter ? '' : isSelection ? '填写预期保留的消息行号，最新消息自动设为必保留。' : '选择最后一条消息的预期意图。' }}案例会加入后续所有版本的回归测试。</p><label>问题说明<input v-model="description" maxlength="2000" placeholder="例如：问进度时丢失了原始目标"/></label><label>{{ isRouter ? '当前用户消息' : '用户消息（按时间顺序，每行一条）' }}<textarea v-model="sample" rows="4" maxlength="60000"/></label><div v-if="isRouter" class="router-feedback"><label>现有任务状态<select v-model="taskStatus" aria-label="路由任务状态"><option v-for="(name,id) in taskLabels" :key="id" :value="id">{{ name }}</option></select></label><label>预期路由动作<select v-model="expectedAction" aria-label="预期路由动作"><option v-for="(name,id) in routeLabels" :key="id" :value="id">{{ name }}</option></select></label><label class="check"><input v-model="hasAttachments" type="checkbox"/>消息包含图片附件</label></div><div v-if="isSelection" class="selection-feedback"><label>必须保留的行号（逗号分隔）<input v-model="requiredLines" aria-label="必保留消息行号"/></label><label>预期保留的行号（按时间排序，逗号分隔）<input v-model="expectedLines" aria-label="预期保留消息行号"/></label><label>最多保留消息数<input v-model.number="maxMessages" type="number" min="1" max="80"/></label><label>字符容量<input v-model.number="maxCharacters" type="number" min="100" max="60000"/></label></div><div class="actions"><label v-if="!isSelection">{{ isRouter ? '已识别的意图（输入）' : '最后一条的预期意图' }}<select v-model="expectedIntent"><option v-for="(name,id) in intents" :key="id" :value="id">{{ name }}</option></select></label><button :disabled="busy || !description.trim() || !sample.trim()" @click="run(report,'问题已记录并加入回归测试')">记录问题</button></div></article>
        <article><h2>优化记录</h2><p v-if="!snapshot.jobs.length">尚无优化任务。记录问题后可开始分析。</p><details v-for="job in snapshot.jobs" :key="job.id"><summary>{{ ({queued:'等待',analyzing:'分析中',testing:'测试中',complete:'已结束',failed:'失败',cancelled:'已停止'})[job.phase] }} · {{ date(job.createdAt) }}</summary><p>{{ job.message }}</p><p v-if="job.diagnosis">原因：{{ job.diagnosis }}</p><small>模型 {{ job.model || '尚未选择' }} · 父版本 {{ label(job.parentId) }} · 候选 {{ label(job.candidateId) }}</small></details></article>
        <article><h2>问题案例 · {{ snapshot.problems.length }}</h2><p v-if="!snapshot.problems.length">模块运行异常会自动记录；语义判断错误可在上方补充样例。</p><details v-for="problem in snapshot.problems" :key="problem.id"><summary>{{ problem.automatic?'自动发现':problem.kind==='runtime'?'运行异常':'用户反馈' }} · {{ problem.description }}</summary><small>{{ date(problem.createdAt) }} · 版本 {{ label(problem.versionId) }}</small><pre>{{ JSON.stringify({input:problem.input,expected:problem.expected},null,2) }}</pre></details></article>
        <article v-if="snapshot.jobs.some(job=>job.shadow)"><h2>历史对话副本验证</h2><p>使用已保存的用户消息回放，不执行工具。结果发生变化不等同于质量提高。</p><p v-for="job in snapshot.jobs.filter(job=>job.shadow)" :key="job.id">候选 {{ label(job.candidateId) }} · {{ job.shadow!.samples }} 个样例 · {{ job.shadow!.changed }} 个结果变化 · {{ job.shadow!.failed }} 个运行失败</p></article>
        <article><h2>切换记录</h2><p v-if="!snapshot.switches.length">当前仍使用初始版本。</p><p v-for="item in snapshot.switches" :key="item.id">{{ label(item.from) }} → {{ label(item.to) }} · {{ item.reason }} · {{ date(item.createdAt) }}</p></article>
      </div>

      <article v-else-if="policy" class="policy-form"><h2>自动改进策略</h2><p>优化使用当前配置的模型服务。开启自动优化后，问题样例与模块代码会发送至该服务；使用已配置的模型连接，不向模型提示词提供连接密钥。</p><label class="check"><input v-model="policy.autoOptimize" type="checkbox"/>达到阈值后自动分析并生成候选</label><label class="check"><input v-model="policy.autoPromote" type="checkbox"/>全部回归通过且优于当前版本时自动切换</label><div class="policy-grid"><label>触发问题数<input v-model.number="policy.failureThreshold" type="number" min="1" max="10"/></label><label>每日最多优化次数（UTC）<input v-model.number="policy.maxAttemptsPerDay" type="number" min="1" max="20"/></label><label>单次生成输出 Token 上限<input v-model.number="policy.maxOutputTokens" type="number" min="512" max="16384"/></label><label>单次总时限（秒）<input v-model.number="policy.timeoutSeconds" type="number" min="15" max="600"/></label></div><button :disabled="busy" @click="run(()=>moduleCall('abilityModulePolicy',JSON.parse(JSON.stringify(policy))),'策略已保存')">保存策略</button><p class="muted">每次优化生成一个候选版本。达到次数或时间预算会停止；候选未通过、得分相同或当前版本已变更时不会自动替换。</p></article>
    </template>
    <p v-else-if="!error">正在读取能力模块…</p>
  </section>
</template>

<style scoped>
.fullscreen-hint{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--s-dim);white-space:nowrap}.fullscreen-hint kbd{font:inherit;padding:1px 4px;border:1px solid var(--s-border);border-radius:4px;background:var(--s-muted)}
.ability-manager{padding:28px;overflow:auto;min-width:0;color:var(--s-text);font-size:13px;height:100%;box-sizing:border-box}.page-heading,.module-overview,.job-strip,.version-detail>header{display:flex;justify-content:space-between;gap:20px;align-items:center}.eyebrow{font-size:11px;letter-spacing:1px;color:var(--s-dim)}h1{font-size:25px;margin:7px 0}h2{font-size:16px;margin:0 0 8px}p{line-height:1.7;margin:8px 0;color:var(--s-dim)}small,.muted{color:var(--s-dim)}button,input,textarea,select{font:inherit;color:inherit;background:var(--s-panel);border:1px solid var(--s-border);border-radius:7px;padding:9px;box-sizing:border-box;min-width:0}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--s-accent);outline-offset:2px}.module-overview,.job-strip,.records>article,.policy-form{padding:20px;border:1px solid var(--s-border);border-radius:12px;background:var(--s-panel);margin-top:18px}.module-current{display:grid;gap:10px;flex-shrink:0}.pill{background:var(--s-accent-soft);color:var(--s-accent);padding:8px 12px;border-radius:30px;text-align:center}.job-strip{background:var(--s-muted);margin-top:12px}.job-strip button{flex-shrink:0}.tabs{display:flex;gap:20px;border-bottom:1px solid var(--s-border);margin:24px 0 20px}.tabs button{background:none;border:0;border-radius:0;padding:12px 2px;color:var(--s-dim)}.tabs .active{border-bottom:2px solid var(--s-accent);color:var(--s-text)}.versions-layout{display:grid;grid-template-columns:245px minmax(0,1fr);gap:22px}.version-list{display:flex;flex-direction:column;gap:10px}.version-list button{text-align:left;padding:14px;background:var(--s-panel)}.version-list button.selected{border-color:var(--s-accent);background:var(--s-accent-soft)}.version-list button>span{display:flex;justify-content:space-between;gap:8px}.version-list p{max-height:66px;overflow:hidden}.version-list b{font-size:11px;font-weight:500;color:var(--s-accent)}.score{margin-top:10px;font-size:12px}.version-detail{min-width:0}.actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.report{padding:14px;background:var(--s-muted);border-radius:8px;margin:16px 0}.report>strong{font-size:22px;margin-right:15px}.report li{padding:5px;overflow-wrap:anywhere}details{margin-top:12px}summary{cursor:pointer;line-height:1.7;overflow-wrap:anywhere}.code-toolbar{display:flex;justify-content:space-between;align-items:center;margin:16px 0 10px}.code-grid{display:grid;min-width:0}.code-grid.comparison{grid-template-columns:1fr 1fr;gap:10px}.code-editor,.code-grid pre{height:350px;resize:vertical;font-family:Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre;overflow:auto;tab-size:2;padding:15px;background:var(--s-bg);border:1px solid var(--s-border);border-radius:8px;margin:0}.save-row,.rating-row{display:flex;gap:10px;align-items:center;margin:16px 0}.save-row>input,.rating-row>input{flex:1}.rating-row{border-top:1px solid var(--s-border);padding-top:18px}.rating-row label{display:flex;align-items:center;gap:8px}.ratings{padding-left:18px;color:var(--s-dim);line-height:1.8}.records{max-width:1100px}.records label,.policy-grid label{display:flex;flex-direction:column;gap:8px;margin:14px 0}.records pre{max-height:300px;overflow:auto;background:var(--s-bg);padding:12px;font-size:12px}.policy-form{max-width:800px}.check{display:flex;gap:10px;align-items:center;margin:18px 0}.policy-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.error{color:var(--s-danger)!important}.notice{color:var(--s-accent);padding:10px;background:var(--s-accent-soft);border-radius:8px}@media(max-width:1000px){.versions-layout{grid-template-columns:1fr}.version-list{flex-direction:row;overflow:auto}.version-list button{min-width:220px}.page-heading,.module-overview,.job-strip,.version-detail>header{align-items:flex-start;flex-wrap:wrap}.code-grid.comparison{grid-template-columns:1fr}.save-row,.rating-row{flex-wrap:wrap}}@media(max-width:650px){.ability-manager{padding:16px}.policy-grid{grid-template-columns:1fr}.tabs{gap:12px}}

.page-heading{gap:12px;margin:0 0 10px}.module-current{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:1}.module-current small{font-size:11px}.pill{font-size:11px;padding:4px 8px;border-radius:5px}.refresh-module{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:5px;border:0;background:transparent}.refresh-module svg{width:16px;height:16px}
.job-strip{padding:8px 10px;margin:0;border:0;border-radius:7px;gap:10px;align-items:flex-start}.job-strip>details{flex:1;min-width:0;margin:0}.job-strip summary{font-size:12px;line-height:26px}.job-strip summary strong{font-weight:500;margin-right:10px}.job-strip summary span{font-size:11px;color:var(--s-dim);overflow-wrap:anywhere}.job-strip p{font-size:12px;margin:6px 0}.job-strip small{font-size:11px}.job-strip>button{font-size:11px;padding:4px 8px}
.tabs{gap:18px;margin:12px 0 16px}.tabs button{font-size:12px;padding:9px 0}
.versions-layout{grid-template-columns:172px minmax(0,1fr);gap:16px}.version-list{gap:4px;max-height:560px;overflow:auto;align-self:start;padding-right:4px}.version-list-heading{display:flex;justify-content:space-between;padding:2px 8px 8px;font-size:11px;color:var(--s-dim)}.version-list button{padding:8px;border-color:transparent;border-radius:6px;min-width:0;flex:none}.version-list button:hover{background:var(--s-muted)}.version-list button.selected{border-color:transparent;background:var(--s-accent-soft)}.version-list button strong{font-size:12px;font-weight:500}.version-list p{font-size:11px;margin:4px 0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.version-list small{font-size:10px}.version-list .score{font-size:10px;margin-top:4px}.version-list b{font-size:10px}
.version-detail{border:1px solid var(--s-border);border-radius:10px;padding:14px;background:var(--s-panel)}.version-detail>header{align-items:center;gap:10px;flex-wrap:wrap}.version-detail h2{font-size:14px;margin:0 0 4px}.version-detail header small{font-size:10px}.actions button,.save-row button{font-size:12px;padding:6px 9px}.report{padding:10px 12px;margin:12px 0;font-size:11px}.report>strong{font-size:18px}.report details{margin-top:6px}.code-toolbar{margin:14px 0 8px;font-size:12px;gap:8px}.code-toolbar button{font-size:11px;padding:4px 8px}.code-editor,.code-grid pre{height:360px;padding:10px;border-radius:6px}.code-contract,.rating-details{font-size:11px;color:var(--s-dim)}.code-contract p{font-size:12px}.save-row{gap:6px;margin:12px 0}.save-row input{font-size:12px;padding:7px 9px}.save-row button{flex-shrink:0}.rating-details{border-top:1px solid var(--s-border);padding-top:10px}.rating-details summary small{margin-left:6px}.rating-row{border:0;padding:0;margin:10px 0;font-size:12px}.rating-row input,.rating-row select,.rating-row button{padding:6px 8px}.version-detail>details:last-child{font-size:11px;color:var(--s-dim)}
.records>article,.policy-form{padding:16px;border-radius:10px;margin-top:12px}.records h2,.policy-form h2{font-size:14px}.records p,.policy-form p{font-size:12px}.records label,.policy-grid label{font-size:12px;gap:6px;margin:10px 0}.records input,.records textarea,.records select,.policy-form input,.policy-form select{padding:7px 9px}.check{font-size:12px;margin:12px 0}.policy-grid{gap:0 14px}.policy-form{max-width:none}.records{max-width:none}
@container(max-width:850px){.versions-layout{grid-template-columns:1fr}.version-list{flex-direction:row;max-height:150px;padding-bottom:6px}.version-list-heading{display:none}.version-list button{width:156px;min-width:156px}.version-detail{padding:12px}.code-grid.comparison{grid-template-columns:1fr}.save-row,.rating-row{flex-wrap:wrap}.version-detail>header{align-items:flex-start}}
@container(max-width:540px){.module-current small{display:none}.tabs{gap:14px}.job-strip{gap:6px}.save-row>input{flex-basis:100%}.records>article,.policy-form{padding:12px}.policy-grid{grid-template-columns:1fr}}

.version-detail{padding:12px}.version-detail>header{padding:0 2px}.versions-layout{grid-template-columns:156px minmax(0,1fr);gap:12px}
.report{padding:8px 10px;margin:10px 0;background:var(--s-muted);font-size:11px}.report>summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;line-height:20px}.report>summary::before{content:'▸';color:var(--s-dim)}.report[open]>summary::before{content:'▾'}.report>summary strong{font-size:16px;color:var(--s-text)}.report>summary strong small{font-size:10px;font-weight:400}.report>summary>span:last-child{margin-left:auto;color:var(--s-dim)}.report-time{color:var(--s-dim)}
.code-workspace{display:flex;flex-direction:column;min-width:0;border:1px solid var(--s-border);border-radius:8px;overflow:hidden;margin-top:10px;background:var(--s-panel)}.code-workspace .code-toolbar{margin:0;padding:7px 10px;border-bottom:1px solid var(--s-border);flex:none;flex-wrap:wrap;gap:8px}.code-toolbar>div{display:flex;align-items:center;gap:10px}.code-toolbar small{font-size:10px}.draft-status{color:var(--s-accent)}.code-toolbar .icon-button{width:26px;height:26px;padding:5px;display:grid;place-items:center;border:0;background:transparent}.icon-button svg{width:16px;height:16px}.editor-actions button[aria-pressed=true]{background:var(--s-accent-soft);color:var(--s-accent)}
.code-panes{display:grid;grid-template-columns:minmax(0,1fr);height:420px;min-height:0;min-width:0;overflow:hidden}.code-panes.comparison{grid-template-columns:repeat(2,minmax(0,1fr))}.editor-pane{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.parent-pane{border-right:1px solid var(--s-border)}.pane-caption{flex:none;padding:6px 10px;border-bottom:1px solid var(--s-border);font-size:10px;color:var(--s-dim);display:flex;justify-content:space-between;gap:6px}
.code-workspace>.save-row{margin:0;padding:8px;border-top:1px solid var(--s-border);flex:none;flex-wrap:wrap}.save-row .save-version:not(:disabled){background:var(--s-accent);color:var(--s-on-accent,#fff);border-color:var(--s-accent)}.code-workspace :deep(.skill-code-editor footer){gap:8px;padding:5px 10px}.code-workspace :deep(.skill-code-editor footer small){display:none}
.code-workspace.expanded{position:fixed;inset:16px;z-index:1000;margin:0;box-shadow:0 16px 60px #0003}.code-workspace.expanded .code-panes{height:auto;flex:1}.code-workspace.expanded .save-row>input{flex-basis:auto}
@container(max-width:850px){.versions-layout{grid-template-columns:1fr}}
@container(max-width:540px){.code-panes.comparison{grid-template-columns:minmax(0,1fr);grid-template-rows:1fr 1fr;height:640px}.parent-pane{border-right:0;border-bottom:1px solid var(--s-border)}.code-workspace.expanded .code-panes.comparison{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:1fr}.code-workspace.expanded .parent-pane{border-right:1px solid var(--s-border);border-bottom:0}.code-toolbar small{display:none}.report-time{display:none}}
.format-error{flex:none;margin:0;padding:8px 10px;font-size:12px;max-height:100px;overflow:auto;white-space:pre-wrap}.editor-actions{flex-wrap:wrap;justify-content:flex-end}

.code-file-item{display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;margin:10px 0;border:0;text-align:left;font-size:12px;background:var(--s-muted)}.code-file-item>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.code-file-item small{font-size:10px;white-space:nowrap}.code-file-item>span:last-child{margin-left:auto}.code-file-item[aria-pressed=true]{background:var(--s-accent-soft);color:var(--s-accent)}
.code-workspace.docked{height:100%;margin:0;border:0;border-radius:0;box-sizing:border-box;font-size:12px;color:var(--s-text);container-type:inline-size}.docked .code-panes{flex:1;height:auto;min-height:0}.docked .code-toolbar{padding:10px;gap:8px}.docked .code-toolbar>div:first-child{min-width:0;flex:1}.docked .code-toolbar strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.docked .editor-actions{gap:5px}.docked .save-row{gap:6px}.docked .save-row input{flex:1;min-width:120px}.docked .editor-notice{padding:6px 10px;margin:0;color:var(--s-accent);font-size:11px}.code-workspace.docked.expanded{height:auto;inset:var(--desktop-titlebar-height,0px) 0 0;z-index:1000}
@container(max-width:650px){.docked .code-panes.comparison{grid-template-columns:minmax(0,1fr);grid-template-rows:1fr 1fr}.docked .parent-pane{border-right:0;border-bottom:1px solid var(--s-border)}}

.versions-layout{display:block}.version-list{display:flex;flex-direction:column;max-height:420px;gap:0;padding:0}.version-list-heading{display:flex;padding:4px 8px 8px}.version-list button{display:flex;align-items:center;gap:10px;width:100%;min-width:0;height:30px;padding:4px 8px;border:0;border-radius:4px;margin:0;font-size:12px;line-height:20px}.version-list button>strong{font-weight:500;font-size:12px}.version-list button>small{font-size:10px;white-space:nowrap;color:var(--s-dim)}.version-list button>span{display:inline;font-size:10px;color:var(--s-dim)}.version-list .version-score{margin-left:auto;white-space:nowrap}.version-list .version-arrow{flex:none}
.code-workspace .version-options{flex:none;max-height:30%;overflow:auto;border:0;border-bottom:1px solid var(--s-border);border-radius:0;margin:0;padding:8px 10px;font-size:11px}.version-options>summary{color:var(--s-dim);font-size:11px}.version-options>header{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.version-options>header h2{font-size:13px}.version-options .rating-row{flex-wrap:wrap}.version-options .report{margin:8px 0}.version-options .code-contract{margin:8px 0}
@container(max-width:540px){.version-list{flex-direction:column}.version-list button{width:100%;min-width:0}.version-list button>small{display:none}.version-list-heading{display:flex}}

.managed-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;border-bottom:1px solid var(--s-border);flex:none}.managed-panel-heading strong{font-size:13px}.managed-panel-heading small{font-size:11px;font-weight:400;color:var(--s-dim);margin-left:6px}.managed-panel-heading>div{display:flex;gap:6px}.managed-panel-heading .icon-button{cursor:pointer;padding:6px;width:28px;height:28px;display:grid;place-items:center;border:0;background:transparent}.managed-panel-heading .icon-button:hover{background:var(--s-muted)}.managed-panel-heading svg{width:16px;height:16px}
.managed-panel-file{padding:8px 12px;border-bottom:1px solid var(--s-border);flex:none}.managed-panel-file select{width:100%;padding:6px;font-size:11px;border-radius:6px;background:var(--s-panel)}
.versions-layout>.version-options{padding:10px 0;margin:12px 0 0;border:0;border-top:1px solid var(--s-border);border-radius:0;background:transparent}.code-workspace.docked :deep(.skill-code-editor footer small){display:block}

.code-tools{position:relative;display:flex;align-items:center}.code-tools>.icon-button[aria-expanded=true]{background:var(--s-muted);color:var(--s-accent)}.code-tools-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:40;width:180px;max-width:calc(100vw - 32px);padding:4px;border:1px solid var(--s-border);border-radius:8px;background:var(--s-panel);box-shadow:0 6px 20px #0002}.code-tools-menu button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border:0;border-radius:5px;background:transparent;text-align:left;font-size:12px;line-height:18px}.code-tools-menu button:hover:not(:disabled){background:var(--s-muted)}.code-tools-menu button[aria-pressed=true]{color:var(--s-accent)}.code-tools-menu svg{flex:none;width:14px;height:14px}
</style>
