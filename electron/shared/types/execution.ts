/**
 * Execution 类型定义
 * Python Runtime Manager 相关类型
 */

/**
 * 执行请求
 */
export type ExecutionRequest = {
  skillId: string
  skillPath: string
  tool: string
  args: Record<string, unknown>
  venv: boolean
  workspace?: string
  context?: Record<string, unknown>
  timeout?: number                     // 超时时间（毫秒）
}

/**
 * 执行响应
 */
export type ExecutionResponse = {
  output: unknown
  elapsedMs: number
  mcpCalls?: Array<{
    server: string
    tool: string
    args: Record<string, unknown>
    result: unknown
  }>
  logs?: string[]
}

/**
 * Worker 状态
 */
export type WorkerStatus = 'idle' | 'busy' | 'error' | 'stopped'

/**
 * Worker 信息
 */
export type WorkerInfo = {
  skillId: string
  pid: number
  status: WorkerStatus
  venvPath: string | null
  createdAt: number
  lastUsed: number
  pendingTasks: number
}

/**
 * Runtime 配置
 */
export type RuntimeConfig = {
  maxWorkers: number                   // 最大并发 Worker 数
  idleTimeout: number                  // 空闲超时（毫秒）
  defaultTimeout: number               // 默认执行超时（毫秒）
  pythonExecutable?: string            // Python 可执行文件路径
  venvDir?: string                     // venv 目录
}

/**
 * IPC 消息类型
 */
export type IpcMessage =
  | {
      type: 'request'
      id: string
      tool: string
      args: Record<string, unknown>
      workspace?: string
  context?: Record<string, unknown>
    }
  | {
      type: 'response'
      id: string
      output?: unknown
      error?: string
      elapsedMs: number
    }
  | {
      type: 'mcp_call'
      id: string
      server: string
      tool: string
      args: Record<string, unknown>
    }
  | {
      type: 'mcp_response'
      id: string
      result?: unknown
      error?: string
    }
  | {
      type: 'log'
      level: 'debug' | 'info' | 'warn' | 'error'
      message: string
      timestamp: number
    }

/**
 * Runtime 统计
 */
export type RuntimeStats = {
  activeWorkers: number
  totalExecutions: number
  averageExecutionTime: number
  errorRate: number
  workersBySkill: Record<string, number>
}
