/**
 * Agent Planner
 * 调用大模型生成任务计划，将用户意图分解为 Capability 调用序列
 */

import type {
  AgentTask,
  AgentPlan,
  AgentPlanStep,
  Capability
} from '../../../shared/types/index.js'
import type { ModelClient } from './model-client.js'
import type { AgentMemory } from './agent-memory.js'

export class AgentPlanner {
  constructor(
    private modelClient: ModelClient,
    private memory: AgentMemory
  ) {}

  /**
   * 生成任务计划
   */
  async plan(
    task: AgentTask,
    availableCapabilities: Capability[],
    signal: AbortSignal
  ): Promise<AgentPlan> {
    // 构建 Prompt
    const prompt = this.buildPlanningPrompt(task, availableCapabilities)

    // 调用大模型
    const response = await this.modelClient.complete(
      [
        {
          role: 'system',
          content: 'You are a task planning assistant. Generate execution plans in JSON format.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      signal,
      { temperature: 0.2 }
    )

    // 解析响应
    const plan = this.parsePlanResponse(response.content, task.id)

    // 验证计划
    this.validatePlan(plan, availableCapabilities)

    return plan
  }

  /**
   * 构建规划 Prompt
   */
  private buildPlanningPrompt(
    task: AgentTask,
    capabilities: Capability[]
  ): string {
    // 按分类分组能力
    const byCategory: Record<string, Capability[]> = {}
    for (const cap of capabilities) {
      if (!byCategory[cap.category]) {
        byCategory[cap.category] = []
      }
      byCategory[cap.category].push(cap)
    }

    // 构建能力列表
    const capabilityList = Object.entries(byCategory)
      .map(([category, caps]) => {
        const items = caps
          .map(c => `  - ${c.name}: ${c.description}`)
          .join('\n')
        return `${category}:\n${items}`
      })
      .join('\n\n')

    // 获取历史上下文
    const contextSummary = this.memory.buildContextSummary(3)

    // 学习成功案例
    const { insights } = this.memory.learnFromSuccess(task.description)
    const insightsText = insights.length > 0
      ? `\n相似任务的经验:\n${insights.map(i => `- ${i}`).join('\n')}`
      : ''

    return `
# 任务规划

## 用户任务
${task.description}

## 当前日期
${new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}

## 上下文
- 工作区: ${task.context.workspace}
${task.context.files ? `- 相关文件: ${task.context.files.join(', ')}` : ''}
- 用户意图: ${task.context.userIntent}

## 历史记录
${contextSummary}
${insightsText}

## 可用能力
${capabilityList}

## 要求
1. 分析用户任务，理解意图
2. 将任务分解为一系列能力调用
3. 每个步骤指定：
   - capability: 能力名称（必须从可用能力中选择）
   - args: 参数对象
   - dependsOn: 依赖的步骤索引（可选）
4. 提供规划理由（reasoning）
5. 参数必须是可直接执行的具体值。不要写 {{step0...}} 一类占位符；执行器不会替换占位符。如需读取网页，请使用已知的完整公网 URL。
6. 只使用上方列出的能力名称，不要编造浏览器等能力。

## 输出格式（JSON）
\`\`\`json
{
  "reasoning": "为什么这个计划可行的理由",
  "steps": [
    {
      "capability": "file.read",
      "args": { "path": "example.txt" },
      "dependsOn": []
    },
    {
      "capability": "file.write",
      "args": { "path": "output.txt", "content": "..." },
      "dependsOn": [0]
    }
  ]
}
\`\`\`

请生成计划：
`.trim()
  }

  /**
   * 解析计划响应
   */
  private parsePlanResponse(content: string, taskId: string): AgentPlan {
    // 提取 JSON（可能包含在 markdown 代码块中）
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                     content.match(/```\s*([\s\S]*?)\s*```/)

    const jsonText = jsonMatch ? jsonMatch[1] : content

    try {
      const parsed = JSON.parse(jsonText)

      // 验证基本结构
      const reasoning = parsed.reasoning ?? parsed.reason
      if (!reasoning || typeof reasoning !== 'string') {
        throw new Error('Missing or invalid reasoning')
      }

      if (!Array.isArray(parsed.steps)) {
        throw new Error('Missing or invalid steps array')
      }

      // 验证每个步骤
      const steps: AgentPlanStep[] = parsed.steps.map((step: any, index: number) => {
        const capability = step.capability ?? step.action
        const args = step.args ?? step.params
        if (!capability || typeof capability !== 'string') {
          throw new Error(`Step ${index}: missing or invalid capability`)
        }

        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          throw new Error(`Step ${index}: missing or invalid args`)
        }

        return {
          capability,
          args,
          dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : undefined,
          optional: step.optional === true
        }
      })

      return {
        taskId,
        steps,
        reasoning,
        estimatedTime: parsed.estimatedTime,
        createdAt: Date.now()
      }

    } catch (error) {
      throw new Error(
        `Failed to parse plan: ${error instanceof Error ? error.message : String(error)}\n` +
        `Raw content: ${content.substring(0, 500)}`
      )
    }
  }

  /**
   * 验证计划
   */
  private validatePlan(
    plan: AgentPlan,
    availableCapabilities: Capability[]
  ): void {
    const capabilityNames = new Set(availableCapabilities.map(c => c.name))

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]

      // 检查能力是否存在
      if (!capabilityNames.has(step.capability)) {
        throw new Error(
          `Step ${i}: capability "${step.capability}" not found in available capabilities`
        )
      }

      // 检查依赖关系
      if (step.dependsOn) {
        for (const depIndex of step.dependsOn) {
          if (depIndex < 0 || depIndex >= i) {
            throw new Error(
              `Step ${i}: invalid dependency ${depIndex} (must be 0 <= dep < ${i})`
            )
          }
        }
      }
    }

    // 检查循环依赖
    this.checkCircularDependencies(plan.steps)
  }

  /**
   * 检查循环依赖
   */
  private checkCircularDependencies(steps: AgentPlanStep[]): void {
    const visited = new Set<number>()
    const visiting = new Set<number>()

    const visit = (index: number): void => {
      if (visiting.has(index)) {
        throw new Error(`Circular dependency detected at step ${index}`)
      }

      if (visited.has(index)) {
        return
      }

      visiting.add(index)

      const step = steps[index]
      if (step.dependsOn) {
        for (const depIndex of step.dependsOn) {
          if (depIndex >= 0 && depIndex < steps.length) {
            visit(depIndex)
          }
        }
      }

      visiting.delete(index)
      visited.add(index)
    }

    for (let i = 0; i < steps.length; i++) {
      visit(i)
    }
  }

  /**
   * 重新规划（失败后）
   */
  async replan(
    task: AgentTask,
    previousPlan: AgentPlan,
    previousResult: any,
    availableCapabilities: Capability[],
    signal: AbortSignal
  ): Promise<AgentPlan> {
    // 构建重新规划 Prompt
    const prompt = this.buildReplanningPrompt(
      task,
      previousPlan,
      previousResult,
      availableCapabilities
    )

    // 调用大模型
    const response = await this.modelClient.complete(
      [
        {
          role: 'system',
          content: 'You are a task planning assistant. Analyze failures and generate alternative plans.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      signal,
      { temperature: 0.3 }  // 稍高的温度以获得不同的方案
    )

    // 解析响应
    const plan = this.parsePlanResponse(response.content, task.id)

    // 验证计划
    this.validatePlan(plan, availableCapabilities)

    return plan
  }

  /**
   * 构建重新规划 Prompt
   */
  private buildReplanningPrompt(
    task: AgentTask,
    previousPlan: AgentPlan,
    previousResult: any,
    capabilities: Capability[]
  ): string {
    const capabilityList = capabilities
      .map(c => `- ${c.name}: ${c.description}`)
      .join('\n')

    const errors = previousResult.errors?.filter(Boolean).join('\n') || '未知错误'

    return `
# 任务重新规划

## 原始任务
${task.description}

## 当前日期
${new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}

## 之前的计划
理由: ${previousPlan.reasoning}

步骤:
${previousPlan.steps.map((s, i) => `${i}. ${s.capability}(${JSON.stringify(s.args)})`).join('\n')}

## 失败原因
${errors}

## 可用能力
${capabilityList}

## 要求
1. 分析失败原因
2. 生成**不同**的执行计划，避免相同的错误
3. 考虑使用不同的能力或不同的参数
4. 参数必须是可直接执行的具体值，不要使用 {{step0...}} 一类占位符；只使用上方列出的能力名称
5. 只输出完整 JSON 对象，不要代码块或额外文字，使用以下字段：
{"reasoning":"替代方案的理由","steps":[{"capability":"上方列出的能力名称","args":{},"dependsOn":[]}]}

请生成替代方案：
`.trim()
  }
}
