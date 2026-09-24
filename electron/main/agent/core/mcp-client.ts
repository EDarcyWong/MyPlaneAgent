/**
 * MCP Client Adapter
 * 连接外部 MCP 服务器，将 MCP Tools 注册到 Capability Registry
 */

import { spawn, ChildProcess } from 'node:child_process'
import type { Capability } from '../../../shared/types/index.js'

export type MCPServerConfig = {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type MCPTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type MCPMessage = {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export class MCPClient {
  private process: ChildProcess | null = null
  private messageId = 0
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()
  private tools: MCPTool[] = []
  private connected = false

  constructor(
    private config: MCPServerConfig
  ) {}

  /**
   * 启动 MCP 服务器进程
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    console.log(`[MCP Client] Connecting to ${this.config.name}...`)

    // 启动 MCP 服务器进程
    this.process = spawn(this.config.command, this.config.args || [], {
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // 监听输出
    let buffer = ''
    this.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()

      // 处理完整的 JSON-RPC 消息（换行分隔）
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message: MCPMessage = JSON.parse(line)
            this.handleMessage(message)
          } catch (error) {
            console.error('[MCP Client] Parse error:', error, line)
          }
        }
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[MCP Client] ${this.config.name} stderr:`, data.toString())
    })

    this.process.on('exit', (code) => {
      console.log(`[MCP Client] ${this.config.name} exited with code ${code}`)
      this.connected = false
    })

    // 初始化握手
    await this.initialize()

    // 列出工具
    await this.listTools()

    this.connected = true
    console.log(`[MCP Client] Connected to ${this.config.name}, ${this.tools.length} tools available`)
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.connected = false
  }

  /**
   * 初始化握手
   */
  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      clientInfo: {
        name: 'MyPlaneAgent',
        version: '1.0.0'
      }
    })
  }

  /**
   * 列出可用工具
   */
  private async listTools(): Promise<void> {
    const result = await this.sendRequest('tools/list', {}) as any

    if (result?.tools && Array.isArray(result.tools)) {
      this.tools = result.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || {}
      }))
    }
  }

  /**
   * 获取可用工具
   */
  getTools(): MCPTool[] {
    return this.tools
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      throw new Error('MCP client not connected')
    }

    const result = await this.sendRequest('tools/call', {
      name,
      arguments: args
    }) as any

    if (result?.content && Array.isArray(result.content)) {
      // MCP 返回格式: { content: [{ type: 'text', text: '...' }] }
      const textContent = result.content
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text)
        .join('\n')

      return textContent || result
    }

    return result
  }

  /**
   * 发送 JSON-RPC 请求
   */
  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId

      const message: MCPMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params
      }

      this.pendingRequests.set(id, { resolve, reject })

      if (this.process?.stdin) {
        this.process.stdin.write(JSON.stringify(message) + '\n')
      } else {
        reject(new Error('MCP process not started'))
      }

      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`MCP request timeout: ${method}`))
        }
      }, 30000)
    })
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(message: MCPMessage): void {
    if (message.id !== undefined) {
      // 响应消息
      const pending = this.pendingRequests.get(message.id as number)
      if (pending) {
        this.pendingRequests.delete(message.id as number)

        if (message.error) {
          pending.reject(new Error(message.error.message))
        } else {
          pending.resolve(message.result)
        }
      }
    } else if (message.method) {
      // 通知消息（暂不处理）
      console.log(`[MCP Client] Notification: ${message.method}`)
    }
  }

  /**
   * 将 MCP Tools 转换为 Capability
   */
  toCapabilities(): Capability[] {
    return this.tools.map(tool => ({
      name: `mcp.${this.config.id}.${tool.name}`,
      category: 'mcp',
      description: `[${this.config.name}] ${tool.description}`,
      parameters: tool.inputSchema,
      source: {
        type: 'mcp',
        serverId: this.config.id
      },
      runtime: 'mcp',
      permissions: ['network'],  // MCP 通常需要网络权限
      tags: ['mcp', this.config.id]
    }))
  }
}
