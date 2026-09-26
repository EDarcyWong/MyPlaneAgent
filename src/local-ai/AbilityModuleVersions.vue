<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AbilityModuleCommands, ConversationIntent, RouterInput, RouteAction, ModulePolicy, ModuleSnapshot, ModuleVersion, ModuleReport } from '../../electron/shared/ability-modules'

const props = defineProps<{ moduleId: string }>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
function moduleCall<K extends keyof AbilityModuleCommands>(action: K, payload?: AbilityModuleCommands[K]['input']): Promise<AbilityModuleCommands[K]['output']> {
  return window.myplane.localAiStudio(action, { ...payload, moduleId: props.moduleId } as AbilityModuleCommands[K]['input'])
}

const snapshot = ref<ModuleSnapshot>(), selected = ref<ModuleVersion>(), parent = ref<ModuleVersion>()
const busy = ref(false), error = ref(''), notice = ref(''), code = ref(''), reason = ref('')
const section = ref<'versions' | 'problems' | 'policy'>('versions'), comparison = ref(false)
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
const changed = computed(() => !!selected.value && code.value !== selected.value.code)
watch(() => changed.value || (!!policy.value && !!snapshot.value && JSON.stringify(policy.value) !== JSON.stringify(snapshot.value.policy)), value => emit('dirty', value))
const label = (id?: string) => id === 'bundled-v1' ? '内置基线' : id?.slice(0, 8) || '—'
const date = (value: string) => new Date(value).toLocaleString()
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false

async function select(id: string) {
  selected.value = await moduleCall('abilityModuleVersion', { id })
  code.value = selected.value.code; reason.value = ''; comparison.value = false
  parent.value = selected.value.parentId ? await moduleCall('abilityModuleVersion', { id: selected.value.parentId }) : undefined
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
onMounted(() => { void poll() })
onBeforeUnmount(() => { disposed = true; if (timer) clearTimeout(timer) })
defineExpose({ discard() { if (selected.value) code.value = selected.value.code; if (snapshot.value) policy.value = { ...snapshot.value.policy }; reason.value = '' } })
</script>

<template>
  <section class="ability-manager" aria-label="能力模块管理">
    <header class="page-heading"><div><h2>版本、评测与自动改进</h2><p>改进代码、验证效果，再选择版本。所有版本与失败报告都会保留。</p></div><button :disabled="busy" @click="run(refresh)">刷新模块</button></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <template v-if="snapshot">
      <article class="module-overview"><div><h2>{{ snapshot.name }}</h2><p>{{ snapshot.description }} 原始消息和执行证据由应用保存。</p></div><div class="module-current"><span class="pill">使用中 · {{ label(snapshot.activeId) }}</span><small>版本切换在下一轮对话生效</small></div></article>
      <div class="job-strip"><div><strong>{{ activeJob ? '正在优化' : '自动改进' }}</strong><p>{{ activeJob?.message || (snapshot.policy.autoOptimize ? '已开启；达到问题阈值后使用当前模型分析，测试更优时自动切换取决于发布策略。' : '已关闭自动触发，可手动分析已记录的问题。') }}</p><small>每天最多 {{ snapshot.policy.maxAttemptsPerDay }} 次 · 单次 {{ snapshot.policy.timeoutSeconds }} 秒</small></div><button v-if="activeJob" :disabled="busy" @click="run(()=>moduleCall('abilityModuleCancel'),'已请求停止优化')">停止优化</button><button v-else :disabled="busy || !snapshot.problems.length" @click="run(()=>moduleCall('abilityModuleOptimize'),'优化已启动，可以继续使用应用')">分析问题并优化</button></div>
      <nav class="tabs" aria-label="模块管理页面"><button v-for="item in [{id:'versions',label:'版本与评测'},{id:'problems',label:'问题与优化记录'},{id:'policy',label:'改进策略'}] as const" :key="item.id" :class="{active:section===item.id}" :aria-current="section===item.id?'page':undefined" @click="section=item.id">{{ item.label }}</button></nav>

      <div v-if="section==='versions'" class="versions-layout">
        <aside class="version-list" aria-label="历史版本"><button v-for="version in snapshot.versions" :key="version.id" :disabled="busy || changed" :class="{selected:selected?.id===version.id}" @click="run(()=>select(version.id))"><span><strong>{{ label(version.id) }}</strong><b v-if="version.id===snapshot.activeId">使用中</b><b v-else-if="version.quarantined" class="error">运行异常</b></span><p>{{ version.reason }}</p><small>{{ date(version.createdAt) }}</small><span class="score">{{ version.report ? `回归 ${version.report.score} 分 · ${version.report.passed?'通过':'未通过'}` : '尚未测试' }}</span></button></aside>
        <article v-if="selected" class="version-detail">
          <header><div><h2>版本 {{ label(selected.id) }}</h2><small>父版本 {{ label(selected.parentId) }} · API {{ selected.apiVersion }}</small></div><div class="actions"><button :disabled="busy || changed" @click="run(()=>moduleCall('abilityModuleTest',{id:selected!.id}),'评测完成，报告已保留')">运行测试</button><button :disabled="busy || changed || selected.id===snapshot.activeId" @click="run(()=>moduleCall('abilityModuleActivate',{id:selected!.id}),'已通过重新评测并切换版本')">测试并使用</button></div></header>
          <p class="muted">手动切换也必须通过当前全部回归案例。用户评分辅助选择，不替代测试。</p>
          <div v-if="versionView?.report" class="report"><strong>{{ versionView.report.score }} / 100</strong><span>{{ versionView.report.tests.filter(test=>test.passed).length }} / {{ versionView.report.tests.length }} 项通过 · {{ versionView.report.elapsedMs }} ms</span><details><summary>查看最近测试报告</summary><ul><li v-for="test in versionView.report.tests" :key="test.name" :class="{error:!test.passed}">{{ test.passed?'通过':'失败' }} · {{ test.name }} <span v-if="test.error">— {{ test.error }}</span></li></ul><small>{{ date(versionView.report.createdAt) }} · 每次测试报告独立保存</small></details></div>
          <div class="code-toolbar"><strong>模块代码 · JavaScript</strong><button v-if="parent" :disabled="busy" @click="comparison=!comparison">{{ comparison?'收起父版本':'对照父版本' }}</button></div>
          <div class="code-grid" :class="{comparison}"><pre v-if="comparison && parent" aria-label="父版本代码">{{ parent.code }}</pre><textarea v-model="code" class="code-editor" :disabled="busy" spellcheck="false" aria-label="模块 JavaScript 代码"/></div>
          <p class="muted">{{ snapshot.contract }} 代码在受限沙箱运行，没有文件、网络或进程接口。</p>
          <div class="save-row"><input v-model="reason" maxlength="2000" placeholder="修改原因（另存新版本，原版保留）" aria-label="修改原因"/><button :disabled="busy || !changed || !reason.trim()" @click="run(save,'新版本已保存，请运行测试')">保存新版本</button><button v-if="changed" :disabled="busy" @click="code=selected.code">撤销未保存编辑</button></div>
          <div class="rating-row"><label>体验评分<select v-model.number="rating"><option v-for="n in 5" :key="n" :value="n">{{ n }} 星</option></select></label><input v-model="ratingNote" maxlength="2000" aria-label="评分备注" placeholder="在哪些场景表现更好？"/><button :disabled="busy" @click="run(()=>moduleCall('abilityModuleRate',{id:selected!.id,score:rating,note:ratingNote}),'评分已保存')">记录评分</button></div>
          <ul v-if="versionView?.ratings.length" class="ratings"><li v-for="item in versionView.ratings" :key="item.id">{{ item.score }} 星 · {{ item.note || '无备注' }} · {{ date(item.createdAt) }}</li></ul>
          <details v-if="reports.length"><summary>全部历史评测 · {{ reports.length }} 次</summary><details v-for="report in reports" :key="report.id"><summary>{{ date(report.createdAt) }} · {{ report.score }} 分 · {{ report.tests.length }} 项</summary><ul><li v-for="test in report.tests" :key="test.name" :class="{error:!test.passed}">{{ test.passed?'通过':'失败' }} · {{ test.name }} {{ test.error }}</li></ul></details></details>
        </article>
      </div>

      <div v-else-if="section==='problems'" class="records">
        <article v-if="genericFeedback" class="generic-feedback"><h2>添加专属回归案例</h2><p>以接口示例为起点填写输入和预期结果。来源、权限与容量校验不能由反馈绕过。</p><label>问题说明<input v-model="description" maxlength="2000"/></label><label>输入 JSON<textarea v-model="feedbackInput" rows="8" spellcheck="false" aria-label="策略反馈输入"/></label><label>预期输出 JSON<textarea v-model="feedbackExpected" rows="6" spellcheck="false" aria-label="策略反馈预期"/></label><button :disabled="busy||!description.trim()" @click="run(report,'专属案例已保存')">记录问题</button></article><article v-else><h2>添加可复现问题</h2><p>{{ isRouter ? '填写当前用户消息、已识别意图、任务状态和预期动作。' : '每行填写一条用户消息。' }}{{ isRouter ? '' : isSelection ? '填写预期保留的消息行号，最新消息自动设为必保留。' : '选择最后一条消息的预期意图。' }}案例会加入后续所有版本的回归测试。</p><label>问题说明<input v-model="description" maxlength="2000" placeholder="例如：问进度时丢失了原始目标"/></label><label>{{ isRouter ? '当前用户消息' : '用户消息（按时间顺序，每行一条）' }}<textarea v-model="sample" rows="4" maxlength="60000"/></label><div v-if="isRouter" class="router-feedback"><label>现有任务状态<select v-model="taskStatus" aria-label="路由任务状态"><option v-for="(name,id) in taskLabels" :key="id" :value="id">{{ name }}</option></select></label><label>预期路由动作<select v-model="expectedAction" aria-label="预期路由动作"><option v-for="(name,id) in routeLabels" :key="id" :value="id">{{ name }}</option></select></label><label class="check"><input v-model="hasAttachments" type="checkbox"/>消息包含图片附件</label></div><div v-if="isSelection" class="selection-feedback"><label>必须保留的行号（逗号分隔）<input v-model="requiredLines" aria-label="必保留消息行号"/></label><label>预期保留的行号（按时间排序，逗号分隔）<input v-model="expectedLines" aria-label="预期保留消息行号"/></label><label>最多保留消息数<input v-model.number="maxMessages" type="number" min="1" max="80"/></label><label>字符容量<input v-model.number="maxCharacters" type="number" min="100" max="60000"/></label></div><div class="actions"><label v-if="!isSelection">{{ isRouter ? '已识别的意图（输入）' : '最后一条的预期意图' }}<select v-model="expectedIntent"><option v-for="(name,id) in intents" :key="id" :value="id">{{ name }}</option></select></label><button :disabled="busy || !description.trim() || !sample.trim()" @click="run(report,'问题已记录并加入回归测试')">记录问题</button></div></article>
        <article><h2>优化记录</h2><p v-if="!snapshot.jobs.length">尚无优化任务。记录问题后可开始分析。</p><details v-for="job in snapshot.jobs" :key="job.id"><summary>{{ ({queued:'等待',analyzing:'分析中',testing:'测试中',complete:'已结束',failed:'失败',cancelled:'已停止'})[job.phase] }} · {{ date(job.createdAt) }}</summary><p>{{ job.message }}</p><p v-if="job.diagnosis">原因：{{ job.diagnosis }}</p><small>模型 {{ job.model || '尚未选择' }} · 父版本 {{ label(job.parentId) }} · 候选 {{ label(job.candidateId) }}</small></details></article>
        <article><h2>问题案例 · {{ snapshot.problems.length }}</h2><p v-if="!snapshot.problems.length">模块运行异常会自动记录；语义判断错误可在上方补充样例。</p><details v-for="problem in snapshot.problems" :key="problem.id"><summary>{{ problem.kind==='runtime'?'运行异常':'用户反馈' }} · {{ problem.description }}</summary><small>{{ date(problem.createdAt) }} · 版本 {{ label(problem.versionId) }}</small><pre>{{ JSON.stringify({input:problem.input,expected:problem.expected},null,2) }}</pre></details></article>
        <article v-if="snapshot.jobs.some(job=>job.shadow)"><h2>历史对话副本验证</h2><p>使用已保存的用户消息回放，不执行工具。结果发生变化不等同于质量提高。</p><p v-for="job in snapshot.jobs.filter(job=>job.shadow)" :key="job.id">候选 {{ label(job.candidateId) }} · {{ job.shadow!.samples }} 个样例 · {{ job.shadow!.changed }} 个结果变化 · {{ job.shadow!.failed }} 个运行失败</p></article>
        <article><h2>切换记录</h2><p v-if="!snapshot.switches.length">当前仍使用初始版本。</p><p v-for="item in snapshot.switches" :key="item.id">{{ label(item.from) }} → {{ label(item.to) }} · {{ item.reason }} · {{ date(item.createdAt) }}</p></article>
      </div>

      <article v-else-if="policy" class="policy-form"><h2>自动改进策略</h2><p>优化使用当前配置的模型服务。开启自动优化后，问题样例与模块代码会发送至该服务；使用已配置的模型连接，不向模型提示词提供连接密钥。</p><label class="check"><input v-model="policy.autoOptimize" type="checkbox"/>达到阈值后自动分析并生成候选</label><label class="check"><input v-model="policy.autoPromote" type="checkbox"/>全部回归通过且优于当前版本时自动切换</label><div class="policy-grid"><label>触发问题数<input v-model.number="policy.failureThreshold" type="number" min="1" max="10"/></label><label>每日最多优化次数（UTC）<input v-model.number="policy.maxAttemptsPerDay" type="number" min="1" max="20"/></label><label>单次生成输出 Token 上限<input v-model.number="policy.maxOutputTokens" type="number" min="512" max="16384"/></label><label>单次总时限（秒）<input v-model.number="policy.timeoutSeconds" type="number" min="15" max="600"/></label></div><button :disabled="busy" @click="run(()=>moduleCall('abilityModulePolicy',JSON.parse(JSON.stringify(policy))),'策略已保存')">保存策略</button><p class="muted">每次优化生成一个候选版本。达到次数或时间预算会停止；候选未通过、得分相同或当前版本已变更时不会自动替换。</p></article>
    </template>
    <p v-else-if="!error">正在读取能力模块…</p>
  </section>
</template>

<style scoped>
.ability-manager{padding:28px;overflow:auto;min-width:0;color:var(--s-text);font-size:13px;height:100%;box-sizing:border-box}.page-heading,.module-overview,.job-strip,.version-detail>header{display:flex;justify-content:space-between;gap:20px;align-items:center}.eyebrow{font-size:11px;letter-spacing:1px;color:var(--s-dim)}h1{font-size:25px;margin:7px 0}h2{font-size:16px;margin:0 0 8px}p{line-height:1.7;margin:8px 0;color:var(--s-dim)}small,.muted{color:var(--s-dim)}button,input,textarea,select{font:inherit;color:inherit;background:var(--s-panel);border:1px solid var(--s-border);border-radius:7px;padding:9px;box-sizing:border-box;min-width:0}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--s-accent);outline-offset:2px}.module-overview,.job-strip,.records>article,.policy-form{padding:20px;border:1px solid var(--s-border);border-radius:12px;background:var(--s-panel);margin-top:18px}.module-current{display:grid;gap:10px;flex-shrink:0}.pill{background:var(--s-accent-soft);color:var(--s-accent);padding:8px 12px;border-radius:30px;text-align:center}.job-strip{background:var(--s-muted);margin-top:12px}.job-strip button{flex-shrink:0}.tabs{display:flex;gap:20px;border-bottom:1px solid var(--s-border);margin:24px 0 20px}.tabs button{background:none;border:0;border-radius:0;padding:12px 2px;color:var(--s-dim)}.tabs .active{border-bottom:2px solid var(--s-accent);color:var(--s-text)}.versions-layout{display:grid;grid-template-columns:245px minmax(0,1fr);gap:22px}.version-list{display:flex;flex-direction:column;gap:10px}.version-list button{text-align:left;padding:14px;background:var(--s-panel)}.version-list button.selected{border-color:var(--s-accent);background:var(--s-accent-soft)}.version-list button>span{display:flex;justify-content:space-between;gap:8px}.version-list p{max-height:66px;overflow:hidden}.version-list b{font-size:11px;font-weight:500;color:var(--s-accent)}.score{margin-top:10px;font-size:12px}.version-detail{min-width:0}.actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.report{padding:14px;background:var(--s-muted);border-radius:8px;margin:16px 0}.report>strong{font-size:22px;margin-right:15px}.report li{padding:5px;overflow-wrap:anywhere}details{margin-top:12px}summary{cursor:pointer;line-height:1.7;overflow-wrap:anywhere}.code-toolbar{display:flex;justify-content:space-between;align-items:center;margin:16px 0 10px}.code-grid{display:grid;min-width:0}.code-grid.comparison{grid-template-columns:1fr 1fr;gap:10px}.code-editor,.code-grid pre{height:350px;resize:vertical;font-family:Consolas,monospace;font-size:12px;line-height:1.7;white-space:pre;overflow:auto;tab-size:2;padding:15px;background:var(--s-bg);border:1px solid var(--s-border);border-radius:8px;margin:0}.save-row,.rating-row{display:flex;gap:10px;align-items:center;margin:16px 0}.save-row>input,.rating-row>input{flex:1}.rating-row{border-top:1px solid var(--s-border);padding-top:18px}.rating-row label{display:flex;align-items:center;gap:8px}.ratings{padding-left:18px;color:var(--s-dim);line-height:1.8}.records{max-width:1100px}.records label,.policy-grid label{display:flex;flex-direction:column;gap:8px;margin:14px 0}.records pre{max-height:300px;overflow:auto;background:var(--s-bg);padding:12px;font-size:12px}.policy-form{max-width:800px}.check{display:flex;gap:10px;align-items:center;margin:18px 0}.policy-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.error{color:var(--s-danger)!important}.notice{color:var(--s-accent);padding:10px;background:var(--s-accent-soft);border-radius:8px}@media(max-width:1000px){.versions-layout{grid-template-columns:1fr}.version-list{flex-direction:row;overflow:auto}.version-list button{min-width:220px}.page-heading,.module-overview,.job-strip,.version-detail>header{align-items:flex-start;flex-wrap:wrap}.code-grid.comparison{grid-template-columns:1fr}.save-row,.rating-row{flex-wrap:wrap}}@media(max-width:650px){.ability-manager{padding:16px}.policy-grid{grid-template-columns:1fr}.tabs{gap:12px}}
</style>
