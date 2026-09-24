/**
 * Agent Memory
 * 管理短期记忆（对话上下文）和长期记忆（任务历史）
 */

import fs from 'node:fs'
import path from 'node:path'
import type {
  AgentTask,
  AgentPlan,
  ExecutionResult,
  MemoryEntry,
  MemoryQueryOptions
} from '../../../shared/types/index.js'

export class AgentMemory {
  private shortTermMemory: MemoryEntry[] = []
  private memoryFile: string

  constructor(private dataDir: string) {
    this.memoryFile = path.join(dataDir, 'agent-memory.json')

    // 确保数据目录存在
    fs.mkdirSync(dataDir, { recursive: true })

    // 加载持久化记忆
    this.loadMemory()
  }

  /**
   * 存储任务执行记忆
   */
  async store(entry: {
    taskId: string
    plan: AgentPlan
    result: ExecutionResult
    timestamp: number
    tags?: string[]
  }): Promise<void> {
    const memoryEntry: MemoryEntry = {
      id: `memory-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId: entry.taskId,
      plan: entry.plan,
      result: entry.result,
      timestamp: entry.timestamp,
      tags: entry.tags || []
    }

    this.shortTermMemory.push(memoryEntry)

    // 限制短期记忆大小（最多保留 100 条）
    if (this.shortTermMemory.length > 100) {
      this.shortTermMemory = this.shortTermMemory.slice(-100)
    }

    // 持久化到磁盘
    await this.saveMemory()
  }

  /**
   * 查询记忆
   */
  query(options?: MemoryQueryOptions): MemoryEntry[] {
    let results = [...this.shortTermMemory]

    // 按任务 ID 过滤
    if (options?.taskId) {
      results = results.filter(entry => entry.taskId === options.taskId)
    }

    // 按标签过滤
    if (options?.tags && options.tags.length > 0) {
      results = results.filter(entry =>
        options.tags!.some(tag => entry.tags?.includes(tag))
      )
    }

    // 按时间范围过滤
    if (options?.fromTime) {
      results = results.filter(entry => entry.timestamp >= options.fromTime!)
    }

    if (options?.toTime) {
      results = results.filter(entry => entry.timestamp <= options.toTime!)
    }

    // 限制返回数量
    if (options?.limit) {
      results = results.slice(-options.limit)
    }

    return results
  }

  /**
   * 获取最近的记忆
   */
  getRecent(limit = 10): MemoryEntry[] {
    return this.shortTermMemory.slice(-limit)
  }

  /**
   * 获取特定任务的记忆
   */
  getByTask(taskId: string): MemoryEntry[] {
    return this.shortTermMemory.filter(entry => entry.taskId === taskId)
  }

  /**
   * 清除短期记忆
   */
  clearShortTerm(): void {
    this.shortTermMemory = []
  }

  /**
   * 获取记忆统计
   */
  getStats(): {
    total: number
    byTask: Record<string, number>
    successRate: number
    averageSteps: number
  } {
    const byTask: Record<string, number> = {}
    let successCount = 0
    let totalSteps = 0

    for (const entry of this.shortTermMemory) {
      byTask[entry.taskId] = (byTask[entry.taskId] || 0) + 1

      if (entry.result.success) {
        successCount++
      }

      totalSteps += entry.plan.steps.length
    }

    return {
      total: this.shortTermMemory.length,
      byTask,
      successRate: this.shortTermMemory.length > 0
        ? successCount / this.shortTermMemory.length
        : 0,
      averageSteps: this.shortTermMemory.length > 0
        ? totalSteps / this.shortTermMemory.length
        : 0
    }
  }

  /**
   * 构建上下文摘要（用于提供给 Planner）
   */
  buildContextSummary(limit = 5): string {
    const recent = this.getRecent(limit)

    if (recent.length === 0) {
      return '没有历史任务记录。'
    }

    const lines: string[] = ['最近的任务历史：']

    for (const entry of recent) {
      const status = entry.result.success ? '✓ 成功' : '✗ 失败'
      const steps = entry.plan.steps.length
      const elapsed = entry.result.elapsedMs

      lines.push(
        `- ${status} | ${steps} 步 | ${elapsed}ms | ${entry.plan.reasoning.substring(0, 50)}...`
      )
    }

    return lines.join('\n')
  }

  /**
   * 加载持久化记忆
   */
  private loadMemory(): void {
    if (!fs.existsSync(this.memoryFile)) {
      return
    }

    try {
      const data = fs.readFileSync(this.memoryFile, 'utf8')
      const parsed = JSON.parse(data)

      if (Array.isArray(parsed)) {
        this.shortTermMemory = parsed
        console.log(`[Memory] Loaded ${this.shortTermMemory.length} memory entries`)
      }
    } catch (error) {
      console.error('[Memory] Failed to load memory:', error)
    }
  }

  /**
   * 持久化记忆到磁盘
   */
  private async saveMemory(): Promise<void> {
    try {
      const data = JSON.stringify(this.shortTermMemory, null, 2)
      fs.writeFileSync(this.memoryFile, data, 'utf8')
    } catch (error) {
      console.error('[Memory] Failed to save memory:', error)
    }
  }

  /**
   * 从成功案例中学习
   */
  learnFromSuccess(taskDescription: string): {
    similarTasks: MemoryEntry[]
    insights: string[]
  } {
    // 查找成功的相似任务
    const successfulTasks = this.shortTermMemory.filter(
      entry => entry.result.success
    )

    // 简单的关键词匹配（可以优化为向量相似度）
    const keywords = taskDescription.toLowerCase().split(/\s+/)
    const similarTasks = successfulTasks.filter(entry => {
      const reasoning = entry.plan.reasoning.toLowerCase()
      return keywords.some(keyword => reasoning.includes(keyword))
    })

    // 提取洞察
    const insights: string[] = []

    if (similarTasks.length > 0) {
      insights.push(`找到 ${similarTasks.length} 个相似的成功案例`)

      // 统计常用的 Capability
      const capabilityCount: Record<string, number> = {}
      for (const task of similarTasks) {
        for (const step of task.plan.steps) {
          capabilityCount[step.capability] =
            (capabilityCount[step.capability] || 0) + 1
        }
      }

      const topCapabilities = Object.entries(capabilityCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cap]) => cap)

      if (topCapabilities.length > 0) {
        insights.push(`常用能力: ${topCapabilities.join(', ')}`)
      }
    }

    return {
      similarTasks: similarTasks.slice(-3),  // 最近 3 个
      insights
    }
  }
}
