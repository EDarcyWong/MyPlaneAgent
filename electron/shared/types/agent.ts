/**
 * Agent 类型定义
 * Agent Core 相关类型
 */

/**
 * Agent 任务
 */
export type AgentTask = {
  id: string
  description: string
  context: {
    workspace: string
    files?: string[]
    userIntent: string
    [key: string]: unknown
  }
  priority?: number
  createdAt: number
}

/**
 * Agent 计划步骤
 */
export type AgentPlanStep = {
  capability: string                   // 能力名称：file.read, browser.screenshot
  args: Record<string, unknown>
  dependsOn?: number[]                 // 依赖的步骤索引
  optional?: boolean                   // 是否可选
}

/**
 * Agent 计划
 */
export type AgentPlan = {
  taskId: string
  steps: AgentPlanStep[]
  reasoning: string                    // 规划理由
  estimatedTime?: number               // 预计耗时（毫秒）
  createdAt: number
}

/**
 * 执行结果
 */
export type ExecutionResult = {
  success: boolean
  outputs: unknown[]
  errors?: string[]
  elapsedMs: number
  stepResults?: Array<{
    step: number
    success: boolean
    output?: unknown
    error?: string
    elapsedMs: number
  }>
}

/**
 * Agent 模式
 */
export type AgentMode = 'auto' | 'manual' | 'verify'

/**
 * Agent 状态
 */
export type AgentStatus = 'idle' | 'planning' | 'executing' | 'replanning' | 'error'

/**
 * Agent 配置
 */
export type AgentConfig = {
  mode: AgentMode
  maxReplanAttempts: number            // 最大重新规划次数
  autoApprove: boolean                 // 自动批准执行
  temperature: number                  // 模型温度
  model?: string                       // 模型名称
}

/**
 * 记忆条目
 */
export type MemoryEntry = {
  id: string
  taskId: string
  plan: AgentPlan
  result: ExecutionResult
  timestamp: number
  tags?: string[]
}

/**
 * 记忆查询选项
 */
export type MemoryQueryOptions = {
  taskId?: string
  tags?: string[]
  fromTime?: number
  toTime?: number
  limit?: number
}

/**
 * Agent 事件
 */
export type AgentEvent =
  | { type: 'task_created'; task: AgentTask }
  | { type: 'planning_started'; taskId: string }
  | { type: 'plan_created'; plan: AgentPlan }
  | { type: 'execution_started'; taskId: string }
  | { type: 'step_completed'; taskId: string; step: number; result: unknown }
  | { type: 'step_failed'; taskId: string; step: number; error: string }
  | { type: 'execution_completed'; taskId: string; result: ExecutionResult }
  | { type: 'replanning_started'; taskId: string; reason: string }
  | { type: 'task_failed'; taskId: string; error: string }
