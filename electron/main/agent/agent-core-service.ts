/**
 * Agent Core Service
 * 集成新的 Agent Core 架构到现有系统
 * 提供与 LocalAgentService 兼容的接口
 */

import { runCoreChat, type ChatRunOptions } from './core/chat-runner.js'
import { AgentCore } from './core/agent-core.js'
import { CapabilityRegistry } from './core/capability-registry.js'
import { SkillPlatform } from './core/skill-platform.js'
import { PythonRuntimeManager } from './core/python-runtime-manager.js'
import { MCPAdapter } from './core/mcp-adapter.js'
import { AgentMemory } from './core/agent-memory.js'
import { ModelClient } from './core/model-client.js'
import type {
  AgentTask,
  AgentConfig,
  AgentEvent,
  ExecutionResult
} from '../../shared/types/index.js'
import type { AgentConnection } from './model.js'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

export interface AgentCoreServiceConfig {
  dataDir: string
  skillsDir: string
  getConnection: () => AgentConnection
  diagnosticLog?: (message: string) => void
}

export interface AgentRunOptions {
  projectId?: string
  model?: string
  connection?: AgentConnection
  mode?: 'general' | 'coding' | 'documents'
  maxReplanAttempts?: number
  maxSteps?: number
  temperature?: number
  approve?: (capability: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<boolean>
}

/**
 * Agent Core Service
 * 封装新架构的初始化和管理
 */
export class AgentCoreService extends EventEmitter {
  private runtimeManager: PythonRuntimeManager
  private skillPlatform: SkillPlatform
  private mcpAdapter: MCPAdapter
  private capabilityRegistry: CapabilityRegistry
  private memory: AgentMemory
  private runningTasks: Map<string, AbortController> = new Map()
  private initialized = false

  constructor(private config: AgentCoreServiceConfig) {
    super()

    // 确保目录存在
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.mkdirSync(config.skillsDir, { recursive: true })

    // 初始化运行时管理器
    this.runtimeManager = new PythonRuntimeManager(config.dataDir)

    // 初始化 Skill Platform
    this.skillPlatform = new SkillPlatform(config.skillsDir, this.runtimeManager)

    // 初始化 MCP Adapter
    this.mcpAdapter = new MCPAdapter()

    // 初始化能力注册表
    this.capabilityRegistry = new CapabilityRegistry(
      this.skillPlatform,
      this.mcpAdapter
    )

    // 初始化记忆系统
    this.memory = new AgentMemory(config.dataDir)

  }

  /**
   * 初始化所有组件
   */
  async initialize(): Promise<void> {
    try {
      // 初始化 Skill Platform
      await this.skillPlatform.initialize()
      this.emit('skill-platform-ready', {
        skills: this.skillPlatform.list()
      })

      // 初始化能力注册表
      await this.capabilityRegistry.initialize()
      this.initialized = true
      this.emit('capability-registry-ready', {
        capabilities: this.capabilityRegistry.list()
      })

      this.emit('initialized')
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  /**
   * 运行 Agent 任务
   */
  async runTask(
    task: AgentTask,
    options: AgentRunOptions = {}
  ): Promise<ExecutionResult> {
    if (!this.initialized) throw new Error('Agent Core is not initialized')
    this.capabilityRegistry.refreshMCP()
    const taskId = task.id

    // 如果任务已在运行，抛出错误
    if (this.runningTasks.has(taskId)) {
      throw new Error(`Task ${taskId} is already running`)
    }

    // 创建中止控制器
    const abortController = new AbortController()
    this.runningTasks.set(taskId, abortController)

    try {
      // 获取或创建 Agent Core 实例
      const agentCore = this.createAgentCore(options)

      // 设置事件监听
      agentCore.on((event: AgentEvent) => {
        this.emit('agent-event', { taskId, event })

        // 转发特定事件到界面
        switch (event.type) {
          case 'planning_started':
            this.emit('task-planning', { taskId })
            break
          case 'plan_created':
            this.emit('task-plan-created', { taskId, plan: event.plan })
            break
          case 'execution_started':
            this.emit('task-executing', { taskId })
            break
          case 'execution_completed':
            this.emit('task-completed', { taskId, result: event.result })
            break
          case 'task_failed':
            this.emit('task-failed', { taskId, error: event.error })
            break
          case 'replanning_started':
            this.emit('task-replanning', { taskId, reason: event.reason })
            break
        }
      })

      // 运行任务
      const result = await agentCore.run(task, abortController.signal)

      // 任务完成
      this.emit('task-result', { taskId, result })
      return result

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.emit('task-cancelled', { taskId })
      } else {
        this.emit('task-error', { taskId, error })
      }
      throw error
    } finally {
      this.runningTasks.delete(taskId)
    }
  }

  async runConversation(options: ChatRunOptions): Promise<void> {
    if (!this.initialized) throw new Error('Agent Core is not initialized')
    this.capabilityRegistry.refreshMCP()
    return runCoreChat(this.capabilityRegistry, options)
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): void {
    const controller = this.runningTasks.get(taskId)
    if (controller) {
      controller.abort()
    }
  }

  /**
   * 获取或创建 Agent Core 实例
   */
  private createAgentCore(options: AgentRunOptions): AgentCore {
    const config: AgentConfig = {
      mode: options.mode || 'general',
      maxReplanAttempts: options.maxReplanAttempts ?? 2,
      autoApprove: false,
      temperature: options.temperature ?? 0.2,
      model: options.model
    }
    return new AgentCore(
      this.capabilityRegistry,
      new ModelClient({
        getConnection: this.config.getConnection,
        connection: options.connection,
        model: options.model,
        diagnosticLog: this.config.diagnosticLog
      }),
      this.memory,
      config,
      options.approve,
      options.maxSteps
    )
  }

  /**
   * 获取 Skill Platform
   */
  getSkillPlatform(): SkillPlatform {
    return this.skillPlatform
  }

  /**
   * 获取能力注册表
   */
  getCapabilityRegistry(): CapabilityRegistry {
    return this.capabilityRegistry
  }

  /**
   * 获取 MCP Adapter
   */
  getMCPAdapter(): MCPAdapter {
    return this.mcpAdapter
  }

  /**
   * 获取记忆系统
   */
  getMemory(): AgentMemory {
    return this.memory
  }

  /**
   * 列出所有可用能力
   */
  listCapabilities() {
    this.capabilityRegistry.refreshMCP()
    return this.capabilityRegistry.list()
  }

  /**
   * 列出所有 Skills
   */
  listSkills() {
    return this.skillPlatform.list()
  }

  /**
   * 添加 MCP 服务器
   */
  async addMCPServer(config: {
    id: string
    name: string
    command: string
    args?: string[]
    env?: Record<string, string>
  }) {
    await this.mcpAdapter.addServer(config)
    this.capabilityRegistry.refreshMCP()
    this.emit('mcp-server-added', { id: config.id })
  }

  /**
   * 移除 MCP 服务器
   */
  async removeMCPServer(id: string) {
    await this.mcpAdapter.removeServer(id)
    this.capabilityRegistry.refreshMCP()
    this.emit('mcp-server-removed', { id })
  }

  /**
   * 获取项目相关的能力
   */
  async getProjectCapabilities(projectId: string) {
    // 这里可以根据项目配置过滤能力
    return this.capabilityRegistry.list().filter(capability => {
      // 实现项目级别的能力过滤逻辑
      return true
    })
  }

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    try {
      // 取消所有运行中的任务
      const taskIds = Array.from(this.runningTasks.keys())
      for (const taskId of taskIds) {
        const controller = this.runningTasks.get(taskId)
        if (controller) {
          controller.abort()
        }
      }
      this.runningTasks.clear()

      // 清理 MCP Adapter
      await this.mcpAdapter.dispose()

      // 清理 Skill Platform
      await this.skillPlatform.dispose()

      // 清理 Python Runtime
      await this.runtimeManager.dispose()
      this.initialized = false

      this.emit('disposed')
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  /**
   * 获取服务状态
   */
  getStatus() {
    this.capabilityRegistry.refreshMCP()
    return {
      initialized: this.initialized,
      runningTasks: this.runningTasks.size,
      skillsCount: this.skillPlatform.list().length,
      capabilitiesCount: this.capabilityRegistry.list().length,
      mcpServers: this.mcpAdapter.listServers().length
    }
  }
}
