/**
 * Agent Executor
 * 按计划执行 Capability 调用，处理依赖关系
 */

import type {
  AgentPlan,
  AgentEvent,
  ExecutionResult,
  CapabilityExecutionRequest
} from '../../../shared/types/index.js'
import type { CapabilityRegistry } from './capability-registry.js'

export class AgentExecutor {
  constructor(
    private capabilityRegistry: CapabilityRegistry,
    private approve?: (capability: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<boolean>,
    private onEvent?: (event: AgentEvent) => void
  ) {}

  private emit(event: AgentEvent): void {
    // Observers must not change execution outcomes.
    try { this.onEvent?.(event) } catch (error) { console.error('[Executor] Event listener failed', error) }
  }

  /**
   * 执行计划
   */
  async execute(
    plan: AgentPlan,
    workspace: string,
    signal: AbortSignal
  ): Promise<ExecutionResult> {
    const startTime = Date.now()
    const outputs: unknown[] = new Array(plan.steps.length)
    const errors: string[] = new Array(plan.steps.length)
    const stepResults: ExecutionResult['stepResults'] = []

    console.log(`[Executor] Starting execution: ${plan.steps.length} steps`)

    for (let i = 0; i < plan.steps.length; i++) {
      signal.throwIfAborted()

      const step = plan.steps[i]
      console.log(`[Executor] Step ${i}: ${step.capability}`)

      const stepStartTime = Date.now()
      this.emit({ type: 'step_started', taskId: plan.taskId, step: i })

      try {
        // 检查依赖关系
        if (step.dependsOn) {
          for (const depIndex of step.dependsOn) {
            if (errors[depIndex]) {
              throw new Error(
                `Dependency step ${depIndex} failed: ${errors[depIndex]}`
              )
            }
          }
        }

        const capability = this.capabilityRegistry.get(step.capability)
        if (capability?.tags?.includes('requires-approval')) {
          if (!this.approve || !await this.approve(step.capability, step.args, signal)) throw new Error('操作未获批准')
          signal.throwIfAborted()
        }

        // 执行 Capability
        const request: CapabilityExecutionRequest = {
          capability: step.capability,
          args: step.args,
          workspace,
          context: {
            stepIndex: i,
            totalSteps: plan.steps.length,
            previousOutputs: outputs.slice(0, i)
          }
        }

        const result = await this.capabilityRegistry.execute(request, signal)
        signal.throwIfAborted()

        if (!result.success) {
          throw new Error(result.error || 'Unknown error')
        }

        outputs[i] = result.output

        stepResults.push({
          step: i,
          success: true,
          output: result.output,
          elapsedMs: Date.now() - stepStartTime
        })

        console.log(`[Executor] Step ${i}: ✓ success (${result.elapsedMs}ms)`)
        this.emit({ type: 'step_completed', taskId: plan.taskId, step: i, result: result.output })

      } catch (error) {
        signal.throwIfAborted()
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.emit({ type: 'step_failed', taskId: plan.taskId, step: i, error: errorMessage })
        errors[i] = errorMessage

        stepResults.push({
          step: i,
          success: false,
          error: errorMessage,
          elapsedMs: Date.now() - stepStartTime
        })

        console.error(`[Executor] Step ${i}: ✗ failed - ${errorMessage}`)

        // 如果步骤不是可选的，则停止执行
        if (!step.optional) {
          break
        }
      }
    }

    // 检查是否所有必需步骤都成功
    let success = true
    for (let i = 0; i < plan.steps.length; i++) {
      if (!plan.steps[i].optional && errors[i]) {
        success = false
        break
      }
    }

    const result: ExecutionResult = {
      success,
      outputs,
      errors: errors.filter(Boolean).length > 0 ? errors : undefined,
      elapsedMs: Date.now() - startTime,
      stepResults
    }

    console.log(
      `[Executor] Execution ${success ? 'succeeded' : 'failed'} (${result.elapsedMs}ms)`
    )

    return result
  }

  /**
   * 执行单个步骤（用于调试）
   */
  async executeStep(
    capability: string,
    args: Record<string, unknown>,
    workspace: string,
    signal: AbortSignal
  ): Promise<unknown> {
    const request: CapabilityExecutionRequest = {
      capability,
      args,
      workspace
    }

    const result = await this.capabilityRegistry.execute(request, signal)

    if (!result.success) {
      throw new Error(result.error || 'Execution failed')
    }

    return result.output
  }

  /**
   * 验证计划可执行性
   */
  async validatePlan(plan: AgentPlan): Promise<{
    valid: boolean
    issues: string[]
  }> {
    const issues: string[] = []

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]

      // 检查 Capability 是否存在
      if (!this.capabilityRegistry.has(step.capability)) {
        issues.push(
          `Step ${i}: Capability "${step.capability}" not found`
        )
      }

      // 检查参数（基本验证）
      if (!step.args || typeof step.args !== 'object') {
        issues.push(
          `Step ${i}: Invalid arguments for ${step.capability}`
        )
      }

      // 检查依赖
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (dep < 0 || dep >= i) {
            issues.push(
              `Step ${i}: Invalid dependency index ${dep}`
            )
          }
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues
    }
  }

  /**
   * 获取执行摘要
   */
  summarizeResult(result: ExecutionResult): string {
    const lines: string[] = []

    lines.push(result.success ? '✓ 执行成功' : '✗ 执行失败')
    lines.push(`总耗时: ${result.elapsedMs}ms`)

    if (result.stepResults) {
      lines.push('\n步骤详情:')
      for (const step of result.stepResults) {
        const status = step.success ? '✓' : '✗'
        const time = step.elapsedMs
        const info = step.error ? ` - ${step.error.substring(0, 50)}` : ''
        lines.push(`  ${status} Step ${step.step} (${time}ms)${info}`)
      }
    }

    if (result.errors) {
      const errorCount = result.errors.filter(Boolean).length
      lines.push(`\n错误数: ${errorCount}`)
    }

    return lines.join('\n')
  }
}
