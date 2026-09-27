<script setup lang="ts">
import VisualReviewCard from './VisualReviewCard.vue'
import {visualReviewCard,visualDecisionText,type VisualDecision} from '../../electron/shared/visual-review'
import ConversationOutline from './ConversationOutline.vue'
import SessionExportMenu from './SessionExportMenu.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowUp, Close, Connection, FolderOpened, Download, EditPen, Grid, Search, Setting, VideoPause } from '@element-plus/icons-vue'
import { ElDialog } from 'element-plus'
import { LOCAL_AI_MAX_OUTPUT_TOKENS } from '../../electron/shared/local-ai'
import type { useLocalAiStudio } from './useLocalAiStudio'
import ChatArtifactPanel from './ChatArtifactPanel.vue'
import {chatArtifacts,type ChatArtifact} from '../../electron/shared/chat-presentation'
import ChatHistorySidebar from './ChatHistorySidebar.vue'
import WorkspaceChatMessages from './WorkspaceChatMessages.vue'
import TokenUsageDisplay from './TokenUsageDisplay.vue'
import ContextUsageDisplay from './ContextUsageDisplay.vue'
import ChatComposerSelect from './ChatComposerSelect.vue'
import ChatPermissionSelect from './ChatPermissionSelect.vue'
import ChatApprovalButton from './ChatApprovalButton.vue'

const props = defineProps<{studio: ReturnType<typeof useLocalAiStudio>}>()
const emit = defineEmits<{settings: []; models: []}>()
const ch = reactive(props.studio)
const visualItem=computed(()=>{const item=ch.session?.taskPlan?.items.find(item=>item.status!=='complete');return item&&visualReviewCard(item,ch.messages)?item:undefined})
async function decideVisual(value:VisualDecision){
 if(locked.value||!visualItem.value)return
 await ch.send(false,{text:visualDecisionText(visualItem.value,value),images:[],visualDecision:value})
}
const locked = computed(() => ch.sending || ch.sessionBusy || ch.selectingChatModel)
const hasConversation = computed(() => ch.messages.length > 0)
const historyOpen = ref(false)
const selectedArtifact = ref<ChatArtifact>()
const artifacts = computed(()=>chatArtifacts(ch.messages))
watch(artifacts,values=>{
 const selected=selectedArtifact.value
 if(!selected)return
 const messagePrefix=selected.id.slice(0,selected.id.indexOf(':')+1)
 const latest=values.find(item=>item.path===selected.path&&item.id.startsWith(messagePrefix))
 if(latest)selectedArtifact.value=latest
})
watch(()=>ch.session?.id,()=>{selectedArtifact.value=undefined})
const scroller = ref<HTMLElement>()
const composerElement = ref<HTMLElement>()
const composerHeight = ref(180)
const settingsOpen = ref(false)
const settingsTrigger = ref<HTMLButtonElement>()
const settingsTheme = ref<Record<string, string>>({})
let composerObserver: ResizeObserver | undefined
watch(scroller, value => { ch.scroller = value })
watch(() => ch.tab, value => { if (value !== 'chat') { historyOpen.value = false; settingsOpen.value = false } })
onMounted(() => {
  composerObserver = new ResizeObserver(() => {
    const height = composerElement.value?.getBoundingClientRect().height
    if (height) composerHeight.value = Math.ceil(height)
  })
  if (composerElement.value) composerObserver.observe(composerElement.value)
})
onBeforeUnmount(() => composerObserver?.disconnect())
async function selectSession(id?: string) {
  if (id) await ch.openSession(id)
  else await ch.newSession()
  historyOpen.value = false
}
function openConversationSettings() {
  const source = settingsTrigger.value && getComputedStyle(settingsTrigger.value)
  settingsTheme.value = Object.fromEntries(['--s-bg', '--s-panel', '--s-muted', '--s-border', '--s-text', '--s-dim', '--s-accent', '--s-accent-soft', '--s-on-accent', '--s-danger'].map(name => [name, source?.getPropertyValue(name).trim() || '']))
  settingsOpen.value = true
}
async function openBrowser(){try{await window.myplane.browser('open')}catch(error){ch.error=String(error)}}
async function focusSettingsTrigger() { await nextTick(); settingsTrigger.value?.focus() }
</script>

<template>
  <main class="agent-workspace unified-workspace chat-workbench" @keydown.esc="historyOpen=false;selectedArtifact=undefined">
    <button v-if="historyOpen" class="agent-history-backdrop" aria-label="收起会话导航" @click="historyOpen=false"></button>
    <aside class="agent-history" :class="{expanded:historyOpen}">
      <header><strong>工作空间</strong><div class="agent-new-actions"><button class="agent-new" :disabled="locked" title="新建会话" aria-label="新建会话" @click="selectSession()"><EditPen/></button></div><button class="agent-icon agent-history-close" aria-label="收起会话导航" @click="historyOpen=false"><Close/></button></header>
      <label class="workspace-search"><Search/><input v-model="ch.sessionFilter" placeholder="搜索会话" aria-label="搜索会话"/><button v-if="ch.sessionFilter" class="agent-icon" aria-label="清除搜索" @click="ch.sessionFilter=''"><Close/></button></label>
      <ChatHistorySidebar :studio="studio" @open="selectSession"/>
      <footer class="chat-sidebar-footer"><button class="chat-settings-button" aria-label="设置" @click="emit('settings')"><Setting/><span>设置</span></button></footer>
    </aside>
    <section class="agent-main" :class="{'is-welcome':!hasConversation,'has-message-outline':ch.messages.filter(message=>message.role==='user').length>1}" :style="{'--composer-height':composerHeight+'px'}">
      <header class="agent-toolbar">
        <button class="agent-icon agent-history-toggle" aria-label="展开会话导航" :aria-expanded="historyOpen" @click="historyOpen=!historyOpen"><Grid/></button>
        <div class="workspace-heading"><strong>{{hasConversation?ch.session?.title:'新会话'}}</strong><button type="button" class="agent-workspace-picker" :disabled="locked" :title="ch.chatWorkspacePath||'选择工作目录，启用文件与命令工具'" aria-label="选择聊天工作目录" @click="ch.chooseChatWorkspace"><FolderOpened/><span>{{ch.chatWorkspacePath.split(/[\\/]/).filter(Boolean).pop()||'选择工作目录'}}</span></button></div>
        <TokenUsageDisplay v-if="hasConversation" class="agent-token-usage" :usage="ch.session?.usage" :pending="ch.sending" label="Tokens" compact/>
        <button type="button" class="agent-icon" title="内置浏览器" aria-label="打开内置浏览器" @click="openBrowser"><Connection/></button>
        <SessionExportMenu v-if="ch.session?.messages.length" :disabled="locked" @select="ch.exportSession"/>
<button v-if="artifacts.length" class="artifact-toggle" @click="selectedArtifact=selectedArtifact?undefined:artifacts[artifacts.length-1]">产物 {{artifacts.length}}</button>
        <span class="workspace-local"><i :class="{online:ch.online}"/>{{ch.online?'已连接':'未连接'}}</span>
      </header>
      <div ref="scroller" class="agent-scroll message-scroll" :class="{'is-empty':!hasConversation}" @scroll="ch.trackScroll">
        <section v-if="!hasConversation" class="agent-welcome"><div class="agent-welcome-label"><span>MyPlaneAgent</span></div><h1>有什么可以帮你？</h1><p>聊聊想法，开始一段新的对话。</p></section>
        <WorkspaceChatMessages v-else :messages="ch.messages" :sending="ch.sending" @copy="ch.copy" @regenerate="ch.send(true)" @open-artifact="selectedArtifact=$event" @open-link="ch.openLink"/>
      </div>
      <ConversationOutline :messages="ch.messages" :scroller="scroller" :session-id="ch.session?.id"/>
      <div ref="composerElement" class="agent-composer-wrap">
        <VisualReviewCard v-if="visualItem" :item="visualItem" :messages="ch.messages" :disabled="locked" @decide="decideVisual" @open="ch.openLink"/>
        <details v-if="ch.session?.taskPlan" class="task-plan-panel">
          <summary>任务清单 · {{ch.session.taskPlan.items.filter(item=>item.status==='complete').length}} / {{ch.session.taskPlan.items.length}} 已完成</summary>
          <p v-if="ch.session.taskPlan.scope" class="task-scope-note">当前目标：{{ch.session.taskPlan.scope.goal}}<br/>只验收当前任务要求的结果；可选检查不阻止完成。</p>
          <ol><li v-for="item in ch.session.taskPlan.items" :key="item.id">
            <strong>{{item.status==='blocked'&&item.outcome==='needs_input'?'待确认':({pending:'待执行',running:'执行中',verifying:'验证中',complete:'已完成',blocked:'受阻'})[item.status]}} · {{item.title}}</strong><p>验收目标：{{item.acceptance}}</p>
            <div v-if="item.status==='blocked'" class="task-block-reason" role="status">
              <strong>{{item.outcome==='needs_input'?'尚待确认':'未完成原因'}}</strong>
              <p v-if="item.completionReview&&item.completionReview.status!=='complete'">{{item.completionReview.reason}}</p>
              <p v-else>{{item.summary||'尚未取得完整验收结果，请查看执行记录。'}}</p>
              <ul v-if="item.completionReview?.missingEvidence?.length"><li v-for="evidence in item.completionReview.missingEvidence" :key="evidence">待核验：{{evidence}}</li></ul>
              <p v-if="item.completionReview?.nextStep&&visualItem?.id!==item.id">下一步：{{item.completionReview.nextStep}}</p>
            </div>
            <p v-if="item.reviewQueue?.phase==='implement'">当前阶段：落实代码修改。后置检查将在实现完成后继续。</p>
            <details v-if="item.reviewQueue?.checks.length" class="task-verification"><summary>{{item.reviewQueue.phase==='implement'?'后置检查（等待实现完成）':'补充检查'}} · {{item.reviewQueue.checks.filter(check=>check.status==='complete').length}} / {{item.reviewQueue.checks.length}}</summary><div v-for="check in item.reviewQueue.checks" :key="check.id"><strong>{{({pending:'待执行',running:'执行中',complete:'已核验',failed:'未通过',invalid:'参数待修正',deferred:'等待实现完成'})[check.status]}} · {{check.title}}</strong><p v-if="['failed','invalid','deferred'].includes(check.status)">{{check.summary}}</p></div></details>
            <details v-if="item.completionReview?.optionalChecks?.length" class="task-verification"><summary>可选建议（不影响本次完成）</summary><p v-for="suggestion in item.completionReview.optionalChecks" :key="suggestion">{{suggestion}}</p></details>
            <small v-if="item.repairAttempts">自动修复 {{item.repairAttempts}} / 2 次</small>
            <p v-if="item.verificationProblem">验收配置待纠正：{{item.verificationProblem.message}}（已尝试 {{item.verificationProblem.attempts}} / 2 次）</p>
            <details v-if="item.verificationRepairs?.length" class="task-verification"><summary>验收规则纠正记录 · {{item.verificationRepairs.length}} 次</summary><div v-for="(repair,index) in item.verificationRepairs" :key="index"><pre>{{JSON.stringify(repair.input,null,2)}}</pre><pre>{{repair.error||repair.output}}</pre></div></details>
            <details v-if="item.baseline" class="task-verification"><summary>执行前检查：{{item.baseline.passed?'通过':'存在失败'}}（仅用于前后对比）</summary>
              <p>以下只验证列出的文件或程序条件，不代表整个任务或浏览器画面已通过验收。</p>
              <pre v-for="(result,index) in item.baseline.results" :key="index">{{result.passed?'✓':'×'}} {{result.summary}}</pre>
              <details v-if="item.baselineHistory?.length"><summary>此前受阻的基线检查 · {{item.baselineHistory.length}} 次</summary><div v-for="(run,index) in item.baselineHistory" :key="index"><pre v-for="(result,position) in run.results" :key="position">{{result.summary}}</pre></div></details>
            </details>
            <p v-else-if="item.baselineUnavailableReason&&(item.requiresVerification||item.modifiedFiles?.length)">{{item.baselineUnavailableReason}}</p>
            <details v-if="item.verificationRuns?.length" class="task-verification"><summary>程序验收：{{item.verificationRuns.at(-1)?.passed?'通过':'未通过'}} · {{item.verificationRuns.length}} 次记录</summary>
              <div v-for="(run,index) in item.verificationRuns" :key="index"><strong>第 {{index+1}} 次 · {{run.passed?'通过':'未通过'}}</strong>
                <p v-if="run.comparison">新增 {{run.comparison.failures.filter(f=>f.origin==='new').length}} · 原有 {{run.comparison.failures.filter(f=>f.origin==='existing').length}} · 已解决 {{run.comparison.resolved.length}} · 环境问题 {{run.comparison.failures.filter(f=>f.issue.category==='environment').length}} · 来源未确定 {{run.comparison.failures.filter(f=>f.origin==='unknown').length}}</p>
                <pre v-for="(result,position) in run.results" :key="position">{{result.passed?'✓':'×'}} {{result.summary}}</pre>
                <p v-for="failure in run.comparison?.failures" :key="failure.issue.key">{{({new:'新增',existing:'原有',unknown:'来源未确定'})[failure.origin]}} · {{failure.issue.category==='environment'?'环境问题':failure.related?'与修改文件相关':'未定位到修改文件'}}：{{failure.issue.message}} {{failure.issue.advice}}</p>
              </div>
            </details>
          </li></ol>
        </details>
        <section v-if="ch.chatModelLoading" class="chat-model-loading" aria-label="模型切换进度" :aria-busy="true">
          <div class="chat-model-loading-heading"><strong :title="ch.chatModelLoading.name">{{ch.chatModelLoading.name}}</strong><span role="status">{{ch.chatModelLoading.stage}}</span></div>
          <div class="chat-model-loading-track" role="progressbar" aria-label="模型切换进度" :aria-valuetext="ch.chatModelLoading.stage"><span/></div>
        </section>
        <section v-if="ch.chatApproval" class="chat-approval" aria-label="操作批准请求" role="region">
          <header><strong>请求批准 · {{ch.chatApproval.activity.capability}}</strong><span>本次操作的完整参数</span></header>
          <pre>{{JSON.stringify(ch.chatApproval.activity.args,null,2)}}</pre>
          <footer><button type="button" class="agent-secondary" :disabled="ch.approvingChat" @click="ch.approveChat(false)">拒绝</button><ChatApprovalButton :disabled="ch.approvingChat" @approve="ch.approveChat(true,$event)"/></footer>
        </section>
        <ContextUsageDisplay v-if="hasConversation" :context="ch.session?.context" :checkpoint="ch.session?.checkpoint" :has-history="hasConversation" :disabled="locked" :shortcut="`Enter 发送 · Shift + Enter 换行${ch.attaching?' · 正在读取图片…':''}`" @compact="ch.compactSession"/>
        <form class="agent-prompt composer" @submit.prevent="ch.send()">
          <div v-if="ch.images.length" class="composer-images"><figure v-for="(image,index) in ch.images" :key="index"><img :src="image.dataUrl" :alt="image.name"/><figcaption>{{image.name}}</figcaption><button type="button" :aria-label="'移除图片 '+(index+1)" :disabled="ch.attaching" @click="ch.removeImage(index)">×</button></figure></div>
          <textarea v-model="ch.input" aria-label="消息" :disabled="ch.sessionBusy" maxlength="100000" :placeholder="hasConversation?'补充要求，继续这段对话…':'询问任何问题，或描述你想完成的工作…'" @paste="ch.pasteImages" @keydown="ch.composerKey"></textarea>
          <footer><div class="agent-prompt-options">
            <ChatPermissionSelect v-model="ch.approvalMode" :disabled="locked"/>
            <button ref="settingsTrigger" type="button" class="agent-settings-trigger" title="会话设置" aria-label="会话设置" @click="openConversationSettings"><Setting/></button>
            <ChatComposerSelect :model-value="ch.chatModel" class="conversation-model-select" :models="ch.chatModels" :disabled="locked||!!ch.busy||ch.connecting" @update:model-value="ch.selectChatModel" @manage="emit('models')"/>
          </div><button v-if="ch.sending" type="button" class="agent-primary stop-button" title="停止" aria-label="停止生成" @click="ch.stop"><VideoPause/></button><button v-else class="agent-primary send-button" title="发送" aria-label="发送消息" :disabled="!ch.canSend"><ArrowUp/></button></footer>
        </form>
      </div>
    </section>
    <ChatArtifactPanel v-if="selectedArtifact" :artifact="selectedArtifact" @close="selectedArtifact=undefined" @copy="ch.copy"/>
    <ElDialog v-model="settingsOpen" class="agent-settings agent-settings-dialog" modal-class="agent-settings-overlay" width="min(500px, calc(100vw - 32px))" :style="settingsTheme" :show-close="false" append-to-body align-center @closed="focusSettingsTrigger">
      <template #header><div class="agent-settings-header"><div><strong>会话设置</strong><small>调整联网与生成参数</small></div><button type="button" class="agent-icon" aria-label="关闭会话设置" @click="settingsOpen=false"><Close/></button></div></template>
      <div class="agent-settings-panel"><section class="agent-settings-group"><label class="conversation-web-setting"><span><strong>联网搜索</strong><small>{{ch.approvalMode==='full'?'完全访问模式下，联网始终开启。':'允许搜索和访问网页，调用时遵循任务权限。'}}</small></span><input v-model="ch.webEnabled" type="checkbox" role="switch" aria-label="联网搜索" :disabled="locked||ch.approvalMode==='full'"/></label></section><section class="agent-settings-group"><header><strong>生成参数</strong><small>控制回答风格和输出长度</small></header><div class="agent-settings-grid">
        <label class="agent-setting-field full"><span>系统提示词</span><textarea v-model="ch.systemPrompt" :disabled="locked" maxlength="12000" rows="3" aria-label="系统提示词"/></label>
        <label class="agent-setting-field"><span>最大输出 Tokens</span><input v-model.number="ch.settings.maxTokens" type="number" min="128" :max="LOCAL_AI_MAX_OUTPUT_TOKENS" step="128" :disabled="locked"/></label>
        <label class="agent-setting-field"><span>Temperature</span><input v-model.number="ch.settings.temperature" type="number" min="0" max="2" step="any" :disabled="locked"/></label>
        <label class="agent-setting-field"><span>Top P</span><input v-model.number="ch.settings.topP" type="number" min="0.01" max="1" step="any" :disabled="locked"/></label>
        <label class="agent-setting-field"><span>重复惩罚</span><input v-model.number="ch.settings.repeatPenalty" type="number" min="0.1" max="2" step="any" :disabled="locked"/></label>
      </div></section><footer><button type="button" class="agent-primary" @click="settingsOpen=false">完成</button></footer></div>
    </ElDialog>
  </main>
</template>

<style scoped src="./studio-agent.css"></style>
<style scoped src="./studio-workspace.css"></style>
<style scoped>
.task-block-reason{margin:7px 0;padding:8px 10px;border-left:3px solid var(--s-accent);background:var(--s-muted);border-radius:4px}.task-block-reason p{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto}
.chat-model-loading{margin-bottom:10px;padding:12px 14px;border:1px solid var(--s-border);border-radius:12px;background:var(--s-panel)}
.chat-model-loading-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:5px 12px;margin-bottom:9px;font-size:12px}
.chat-model-loading-heading strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--s-text);font-weight:500}
.chat-model-loading-heading>span{color:var(--s-dim);font-size:11px}
.chat-model-loading-track{height:4px;border-radius:4px;overflow:hidden;background:var(--s-muted)}
.chat-model-loading-track>span{display:block;width:35%;height:100%;border-radius:inherit;background:var(--s-accent);animation:chat-model-loading 1.4s ease-in-out infinite}
@keyframes chat-model-loading{from{transform:translateX(-100%)}to{transform:translateX(386%)}}
@media(prefers-reduced-motion:reduce){.chat-model-loading-track>span{animation:none;width:100%;opacity:.65}}
.agent-prompt-options>.conversation-model-select{margin-left:auto;flex:0 1 220px;min-width:0}.conversation-model-select{max-width:220px}@container studio (max-width:650px){.conversation-model-select{max-width:150px}}
.agent-history>.chat-sidebar-footer{padding:8px 0 0;border-top:1px solid var(--s-border);flex:none}
.chat-settings-button{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border:0;border-radius:8px;background:transparent;color:var(--s-text);font-size:13px;text-align:left}
.chat-settings-button:hover{background:var(--s-accent-soft)}
.agent-history>.chat-sidebar-footer svg{width:18px;height:18px}
.artifact-toggle{border:1px solid var(--s-border);border-radius:7px;background:var(--s-panel);color:var(--s-text);font-size:12px;padding:5px 9px;white-space:nowrap}
.agent-prompt .agent-prompt-options{flex:1;min-width:0}.agent-prompt-options>.agent-model-select{margin-left:auto;flex:0 1 220px;text-align:right}.conversation-web-setting{display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer}.conversation-web-setting>span{display:flex;flex-direction:column;gap:5px}.conversation-web-setting strong{font-size:13px;font-weight:500}.conversation-web-setting small{font-size:11px;line-height:1.6;color:var(--s-dim)}.conversation-web-setting input{appearance:none;flex:none;width:34px;height:20px;border:1px solid var(--s-border);border-radius:12px;background:var(--s-muted);cursor:pointer;position:relative}.conversation-web-setting input::after{content:'';position:absolute;width:14px;height:14px;left:2px;top:2px;border-radius:50%;background:var(--s-dim);transition:transform .15s}.conversation-web-setting input:checked{background:var(--s-accent);border-color:var(--s-accent)}.conversation-web-setting input:checked::after{transform:translateX(14px);background:var(--s-on-accent)}.conversation-web-setting input:disabled{opacity:.5;cursor:default}.conversation-web-setting input:focus-visible{outline:2px solid var(--s-accent);outline-offset:3px}
.has-message-outline :deep(.messages){padding-left:48px}
.danger-text{color:var(--s-danger)}
.chat-approval{padding:12px 14px;margin-bottom:10px;border:1px solid var(--s-border);border-radius:12px;background:var(--s-panel);max-height:35vh;overflow:visible}
.approval-scope-hint{font-size:12px;color:var(--s-dim);margin:8px 0}.approval-scope{max-width:100%;min-width:0;border:1px solid var(--s-border);border-radius:8px;padding:6px 8px;background:var(--s-panel);color:var(--s-text);font:inherit}.chat-approval footer{flex-wrap:wrap}
.chat-approval header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:12px}.chat-approval header span{color:var(--s-dim)}
.chat-approval pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:18vh;overflow:auto;margin:8px 0}.chat-approval footer{display:flex;justify-content:flex-end;gap:8px}
@container studio (max-width:650px){.agent-prompt-options{flex-wrap:wrap}.agent-model-select{max-width:130px}}

</style>

<style scoped>
.task-plan-panel{border:1px solid var(--s-border);border-radius:10px;padding:10px 14px;margin-bottom:8px;background:var(--s-panel);font-size:12px}.task-plan-panel summary{cursor:pointer}.task-plan-panel ol{max-height:180px;overflow:auto;padding-left:22px}.task-plan-panel li{margin:8px 0}.task-plan-panel p{margin:3px 0;color:var(--s-dim)}
.task-verification{margin-top:6px}.task-verification pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:140px;overflow:auto;font-size:11px;color:var(--s-dim)}
</style>
