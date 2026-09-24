<script setup lang="ts">
/**
 * Agent Core Enhancement Component
 * 为 LocalAiAgent 添加新架构支持
 * 可选功能，不影响现有功能
 */

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Check, Close, Warning, Clock, Refresh, InfoFilled, Lightning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

interface AgentCoreStatus {
  enabled: boolean
  available: boolean
  runningTasks?: number
  skillsCount?: number
  capabilitiesCount?: number
}

interface AgentPlanStep {
  id: string
  capability: string
  args: Record<string, unknown>
  description: string
  status?: 'pending' | 'running' | 'completed' | 'failed'
  duration?: number
  error?: string
}

interface AgentPlan {
  steps: AgentPlanStep[]
  reasoning: string
}

const props = defineProps<{
  projectId?: string
  workspace?: string
  enabled?: boolean
}>()

const emit = defineEmits<{
  statusChange: [enabled: boolean]
  planCreated: [plan: AgentPlan]
  executionStarted: []
  executionCompleted: []
  taskFailed: [error: string]
}>()

// 状态管理
const agentCoreStatus = ref<AgentCoreStatus>({ enabled: false, available: false })
const useNewArchitecture = ref(false)
const currentPlan = ref<AgentPlan | null>(null)
const executionStatus = ref<'idle' | 'planning' | 'executing' | 'completed' | 'failed'>('idle')
const currentStepIndex = ref(0)
const retryCount = ref(0)
const replanningReason = ref('')
const showPlanDetails = ref(false)

// 计算属性
const isActive = computed(() => useNewArchitecture.value && agentCoreStatus.value.enabled)
const progress = computed(() => {
  if (!currentPlan.value || currentPlan.value.steps.length === 0) return 0
  return Math.round((currentStepIndex.value / currentPlan.value.steps.length) * 100)
})

const statusText = computed(() => {
  switch (executionStatus.value) {
    case 'planning': return '正在规划...'
    case 'executing': return '执行中...'
    case 'completed': return '已完成'
    case 'failed': return '执行失败'
    default: return '空闲'
  }
})

const statusColor = computed(() => {
  switch (executionStatus.value) {
    case 'planning': return '#2196f3'
    case 'executing': return '#ff9800'
    case 'completed': return '#4caf50'
    case 'failed': return '#f44336'
    default: return '#9e9e9e'
  }
})

// 检查 Agent Core 可用性
async function checkAgentCore() {
  try {
    const status = await window.myplane.localAiStudio('agentCoreStatus')
    agentCoreStatus.value = status

    if (status.enabled && props.enabled !== false) {
      useNewArchitecture.value = true
    }
  } catch (error) {
    console.warn('Agent Core 不可用:', error)
    agentCoreStatus.value = { enabled: false, available: false }
  }
}

// 监听新架构事件
let eventDisposer: (() => void) | undefined

function setupEventListeners() {
  if (typeof window.myplane?.onAgentCoreEvent !== 'function') {
    console.warn('Agent Core 事件监听不可用')
    return
  }

  eventDisposer = window.myplane.onAgentCoreEvent((data: any) => {
    const { event } = data

    switch (event.type) {
      case 'planning_started':
        executionStatus.value = 'planning'
        currentPlan.value = null
        currentStepIndex.value = 0
        retryCount.value = 0
        break

      case 'plan_created':
        executionStatus.value = 'idle'
        currentPlan.value = event.plan
        emit('planCreated', event.plan)

        // 初始化步骤状态
        if (currentPlan.value) {
          currentPlan.value.steps.forEach(step => {
            step.status = 'pending'
          })
        }
        break

      case 'execution_started':
        executionStatus.value = 'executing'
        emit('executionStarted')
        break

      case 'execution_completed':
        executionStatus.value = 'completed'
        currentStepIndex.value = currentPlan.value?.steps.length || 0
        emit('executionCompleted')
        ElMessage.success('任务执行完成')
        break

      case 'task_failed':
        executionStatus.value = 'failed'
        emit('taskFailed', event.error || '未知错误')
        ElMessage.error(`任务失败: ${event.error}`)
        break

      case 'replanning_started':
        retryCount.value++
        replanningReason.value = event.reason || ''
        executionStatus.value = 'planning'
        ElMessage.warning(`正在重新规划（第 ${retryCount.value} 次）`)
        break
    }
  })
}

// 切换新架构
function toggleArchitecture() {
  if (!agentCoreStatus.value.available) {
    ElMessage.warning('新架构不可用')
    return
  }

  useNewArchitecture.value = !useNewArchitecture.value
  emit('statusChange', useNewArchitecture.value)

  if (useNewArchitecture.value) {
    ElMessage.success('已启用新架构（智能规划和失败恢复）')
  } else {
    ElMessage.info('已切换回传统模式')
  }
}

// 切换计划详情
function togglePlanDetails() {
  showPlanDetails.value = !showPlanDetails.value
}

// 格式化时间
function formatDuration(ms?: number) {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

// 获取步骤状态图标
function getStepIcon(status?: string) {
  switch (status) {
    case 'completed': return Check
    case 'running': return Refresh
    case 'failed': return Close
    default: return Clock
  }
}

// 生命周期
onMounted(() => {
  checkAgentCore()
  setupEventListeners()
})

onBeforeUnmount(() => {
  if (eventDisposer) {
    eventDisposer()
  }
})

// 监听 enabled 属性变化
watch(() => props.enabled, (enabled) => {
  if (enabled === false) {
    useNewArchitecture.value = false
  } else if (enabled === true && agentCoreStatus.value.enabled) {
    useNewArchitecture.value = true
  }
})
</script>

<template>
  <div v-if="agentCoreStatus.available" class="agent-core-enhancement">
    <!-- 架构切换开关 -->
    <div class="architecture-toggle">
      <label class="toggle-label">
        <input
          type="checkbox"
          v-model="useNewArchitecture"
          :disabled="!agentCoreStatus.enabled"
          @change="toggleArchitecture"
        />
        <span class="toggle-text">
          <Lightning class="icon" />
          使用新架构
        </span>
        <span class="toggle-hint">（智能规划 + 失败恢复）</span>
      </label>

      <div v-if="agentCoreStatus.enabled" class="status-indicator enabled">
        <Check />
        <span>可用</span>
      </div>
      <div v-else class="status-indicator disabled">
        <Close />
        <span>未启用</span>
      </div>
    </div>

    <!-- 执行状态 -->
    <div v-if="isActive && executionStatus !== 'idle'" class="execution-status">
      <div class="status-header">
        <h4>{{ statusText }}</h4>
        <div class="status-badge" :style="{ backgroundColor: statusColor }">
          {{ executionStatus }}
        </div>
      </div>

      <!-- 进度条 -->
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
        <span class="progress-text">{{ progress }}%</span>
      </div>

      <!-- 重试信息 -->
      <div v-if="retryCount > 0" class="retry-info">
        <Warning />
        <span>已重试 {{ retryCount }} 次</span>
        <span v-if="replanningReason" class="retry-reason">
          原因: {{ replanningReason }}
        </span>
      </div>
    </div>

    <!-- 任务计划 -->
    <div v-if="isActive && currentPlan" class="task-plan">
      <div class="plan-header" @click="togglePlanDetails">
        <h4>
          <InfoFilled />
          执行计划（{{ currentPlan.steps.length }} 步）
        </h4>
        <button class="toggle-btn" :class="{ expanded: showPlanDetails }">
          {{ showPlanDetails ? '收起' : '展开' }}
        </button>
      </div>

      <div v-if="showPlanDetails" class="plan-content">
        <p class="plan-reasoning">
          <strong>规划思路：</strong>{{ currentPlan.reasoning }}
        </p>

        <ol class="plan-steps">
          <li
            v-for="(step, index) in currentPlan.steps"
            :key="step.id"
            class="plan-step"
            :class="{
              active: index === currentStepIndex,
              completed: step.status === 'completed',
              failed: step.status === 'failed'
            }"
          >
            <div class="step-icon">
              <component :is="getStepIcon(step.status)" />
            </div>
            <div class="step-content">
              <strong>{{ step.capability }}</strong>
              <p>{{ step.description }}</p>
              <div v-if="step.error" class="step-error">
                <Warning />
                {{ step.error }}
              </div>
            </div>
            <div v-if="step.duration" class="step-duration">
              {{ formatDuration(step.duration) }}
            </div>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-core-enhancement {
  margin-bottom: 16px;
  padding: 16px;
  background: var(--studio-card-bg, #f5f5f5);
  border: 1px solid var(--studio-border, #e0e0e0);
  border-radius: 8px;
}

.architecture-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: var(--studio-bg, white);
  border: 1px solid var(--studio-border, #e0e0e0);
  border-radius: 6px;
  margin-bottom: 16px;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.toggle-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.toggle-label input[type="checkbox"]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.toggle-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--studio-text, #333);
}

.toggle-text .icon {
  color: #ff9800;
}

.toggle-hint {
  font-size: 12px;
  color: var(--studio-text-muted, #666);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-indicator.enabled {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-indicator.disabled {
  background: #ffebee;
  color: #c62828;
}

.execution-status {
  padding: 12px;
  background: var(--studio-bg, white);
  border: 1px solid var(--studio-border, #e0e0e0);
  border-radius: 6px;
  margin-bottom: 16px;
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.status-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--studio-text, #333);
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  color: white;
  text-transform: uppercase;
}

.progress-bar {
  position: relative;
  height: 24px;
  background: var(--studio-input-bg, #f5f5f5);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #2196f3, #21cbf3);
  transition: width 0.3s ease;
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 11px;
  font-weight: 600;
  color: var(--studio-text, #333);
}

.retry-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fff3e0;
  border: 1px solid #ffe0b2;
  border-radius: 6px;
  font-size: 12px;
  color: #e65100;
}

.retry-reason {
  margin-left: auto;
  font-style: italic;
  color: #f57c00;
}

.task-plan {
  background: var(--studio-bg, white);
  border: 1px solid var(--studio-border, #e0e0e0);
  border-radius: 6px;
  overflow: hidden;
}

.plan-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: var(--studio-input-bg, #f5f5f5);
  cursor: pointer;
  user-select: none;
}

.plan-header:hover {
  background: var(--studio-button-hover, #eeeeee);
}

.plan-header h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--studio-text, #333);
}

.toggle-btn {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid var(--studio-border, #e0e0e0);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-btn:hover {
  background: var(--studio-button-hover, #e0e0e0);
}

.plan-content {
  padding: 12px;
}

.plan-reasoning {
  margin: 0 0 16px;
  padding: 12px;
  background: var(--studio-input-bg, #f5f5f5);
  border-left: 3px solid #2196f3;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--studio-text, #333);
}

.plan-reasoning strong {
  display: block;
  margin-bottom: 4px;
  font-weight: 600;
}

.plan-steps {
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border-left: 2px solid #e0e0e0;
  margin-bottom: 8px;
  transition: all 0.2s;
}

.plan-step.active {
  background: #e3f2fd;
  border-left-color: #2196f3;
}

.plan-step.completed {
  opacity: 0.7;
  border-left-color: #4caf50;
}

.plan-step.failed {
  background: #ffebee;
  border-left-color: #f44336;
}

.step-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--studio-input-bg, #f5f5f5);
}

.plan-step.active .step-icon {
  background: #2196f3;
  color: white;
  animation: pulse 2s infinite;
}

.plan-step.completed .step-icon {
  background: #4caf50;
  color: white;
}

.plan-step.failed .step-icon {
  background: #f44336;
  color: white;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.step-content {
  flex: 1;
}

.step-content strong {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--studio-text, #333);
}

.step-content p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--studio-text-muted, #666);
}

.step-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px;
  background: #ffebee;
  border: 1px solid #ffcdd2;
  border-radius: 4px;
  font-size: 12px;
  color: #c62828;
}

.step-duration {
  flex-shrink: 0;
  padding: 4px 8px;
  background: var(--studio-input-bg, #f5f5f5);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--studio-text-muted, #666);
}
</style>
