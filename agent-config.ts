/**
 * Agent 配置示例
 * 配置真实大模型连接
 */

import type { AgentConnection } from './electron/main/agent/model.js'

/**
 * OpenAI 配置
 */
export const openaiConfig: AgentConnection = {
  endpoint: 'https://api.openai.com/v1',
  key: process.env.OPENAI_API_KEY || '',
  maxTokens: 4096,
  contextLength: 128000,
  apiFormat: undefined
}

/**
 * Anthropic Claude 配置
 */
export const anthropicConfig: AgentConnection = {
  endpoint: 'https://api.anthropic.com/v1',
  key: process.env.ANTHROPIC_API_KEY || '',
  maxTokens: 4096,
  contextLength: 200000,
  apiFormat: 'anthropic'
}

/**
 * DeepSeek 配置
 */
export const deepseekConfig: AgentConnection = {
  endpoint: 'https://api.deepseek.com/v1',
  key: process.env.DEEPSEEK_API_KEY || '',
  maxTokens: 4096,
  contextLength: 64000,
  apiFormat: undefined
}

/**
 * 本地 Ollama 配置
 */
export const ollamaConfig: AgentConnection = {
  endpoint: 'http://localhost:11434/v1',
  key: '',
  maxTokens: 4096,
  contextLength: 8192,
  localLlama: true,
  apiFormat: undefined
}

/**
 * 获取配置（根据环境变量）
 */
export function getModelConfig(): {
  connection: AgentConnection
  model: string
} {
  const provider = process.env.AI_PROVIDER || 'openai'

  switch (provider) {
    case 'openai':
      return {
        connection: openaiConfig,
        model: process.env.OPENAI_MODEL || 'gpt-4o'
      }

    case 'anthropic':
      return {
        connection: anthropicConfig,
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'
      }

    case 'deepseek':
      return {
        connection: deepseekConfig,
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat'
      }

    case 'ollama':
      return {
        connection: ollamaConfig,
        model: process.env.OLLAMA_MODEL || 'qwen2.5:14b'
      }

    default:
      throw new Error(`Unknown AI provider: ${provider}`)
  }
}

/**
 * 验证配置
 */
export function validateConfig(connection: AgentConnection, provider: string): void {
  if (provider !== 'ollama' && !connection.key) {
    throw new Error(
      `API key not configured for ${provider}. ` +
      `Please set ${provider.toUpperCase()}_API_KEY environment variable.`
    )
  }
}
