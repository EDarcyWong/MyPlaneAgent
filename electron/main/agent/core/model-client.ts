/**
 * Model Client 适配器
 * 简化的接口供 Agent Core 使用
 */

import type { AgentConnection, AgentMessage, AgentAnswer } from '../model.js'
import { requestAgentModel } from '../model.js'
import type { ToolDefinition } from '../registry.js'

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ModelResponse = {
  content: string
  reasoning?: string
}

export type ModelConfig = {
  connection: AgentConnection
  model: string
  temperature?: number
}

export class ModelClient {
  constructor(private config: ModelConfig) {}

  /**
   * 简单的文本补全（无工具调用）
   */
  async complete(
    messages: ModelMessage[],
    signal: AbortSignal,
    options?: {
      temperature?: number
      maxRetries?: number
    }
  ): Promise<ModelResponse> {
    const agentMessages: AgentMessage[] = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      tool_calls: undefined,
      tool_call_id: undefined
    }))

    let retries = 0
    const maxRetries = options?.maxRetries ?? 2

    while (retries <= maxRetries) {
      try {
        const response = await requestAgentModel(
          this.config.connection,
          this.config.model,
          agentMessages,
          signal,
          {
            tools: false,  // 不使用工具
            thinking: false
          }
        )

        return {
          content: response.content || '',
          reasoning: response.reasoning
        }

      } catch (error) {
        retries++
        if (retries > maxRetries) {
          throw error
        }

        // 短暂延迟后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * retries))
      }
    }

    throw new Error('Model request failed after retries')
  }

  /**
   * 带工具调用的补全（用于 Agent 执行）
   */
  async completeWithTools(
    messages: ModelMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal
  ): Promise<AgentAnswer> {
    const agentMessages: AgentMessage[] = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      tool_calls: undefined,
      tool_call_id: undefined
    }))

    return await requestAgentModel(
      this.config.connection,
      this.config.model,
      agentMessages,
      signal,
      {
        tools,
        thinking: true
      }
    )
  }

  /**
   * 流式补全（用于实时响应）
   */
  async streamComplete(
    messages: ModelMessage[],
    signal: AbortSignal,
    onChunk: (text: string) => void
  ): Promise<ModelResponse> {
    const agentMessages: AgentMessage[] = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      tool_calls: undefined,
      tool_call_id: undefined
    }))

    let fullContent = ''
    let reasoning = ''

    const response = await requestAgentModel(
      this.config.connection,
      this.config.model,
      agentMessages,
      signal,
      {
        tools: false,
        thinking: false,
        onContent: (text) => {
          fullContent += text
          onChunk(text)
        },
        onReasoning: (text) => {
          reasoning += text
        }
      }
    )

    return {
      content: response.content || fullContent,
      reasoning: response.reasoning || reasoning
    }
  }
}
