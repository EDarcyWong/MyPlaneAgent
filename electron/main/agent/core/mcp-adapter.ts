/**
 * MCP Adapter
 * 管理多个 MCP 客户端，将 MCP Tools 集成到 Capability Registry
 */

import type { Capability, CapabilityExecutionRequest, CapabilityExecutionResult } from '../../../shared/types/index.js'
import { MCPClient, type MCPServerConfig } from './mcp-client.js'

export class MCPAdapter {
  private clients = new Map<string, MCPClient>()

  constructor() {}

  /**
   * 添加 MCP 服务器
   */
  async addServer(config: MCPServerConfig): Promise<void> {
    const previous = this.clients.get(config.id)
    if (previous?.isConnected()) {
      throw new Error(`MCP server already exists: ${config.id}`)
    }
    if (previous) {
      await previous.disconnect()
      this.clients.delete(config.id)
    }

    console.log(`[MCP Adapter] Adding server: ${config.name}`)

    const client = new MCPClient(config)
    await client.connect()

    this.clients.set(config.id, client)

    console.log(`[MCP Adapter] Server added: ${config.name}`)
  }

  /**
   * 移除 MCP 服务器
   */
  async removeServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client) {
      await client.disconnect()
      this.clients.delete(serverId)
      console.log(`[MCP Adapter] Server removed: ${serverId}`)
    }
  }

  /**
   * 获取所有 Capabilities
   */
  getAllCapabilities(): Capability[] {
    const capabilities: Capability[] = []

    for (const client of this.clients.values()) {
      if (!client.isConnected()) continue
      capabilities.push(...client.toCapabilities())
    }

    return capabilities
  }

  /**
   * 执行 MCP Tool
   */
  async execute(
    request: CapabilityExecutionRequest,
    signal: AbortSignal
  ): Promise<CapabilityExecutionResult> {
    const startTime = Date.now()

    // 解析能力名称: mcp.{serverId}.{toolName}
    const parts = request.capability.split('.')
    if (parts.length < 3 || parts[0] !== 'mcp') {
      return {
        success: false,
        error: `Invalid MCP capability name: ${request.capability}`,
        elapsedMs: 0
      }
    }

    const serverId = parts[1]
    const toolName = parts.slice(2).join('.')

    const client = this.clients.get(serverId)
    if (!client) {
      return {
        success: false,
        error: `MCP server not found: ${serverId}`,
        elapsedMs: 0
      }
    }

    try {
      signal.throwIfAborted()

      const output = await client.callTool(toolName, request.args, signal)

      return {
        success: true,
        output,
        elapsedMs: Date.now() - startTime,
        metadata: {
          runtime: 'mcp',
          source: {
            type: 'mcp',
            serverId
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startTime,
        metadata: {
          runtime: 'mcp',
          source: {
            type: 'mcp',
            serverId
          }
        }
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalServers: number
    totalTools: number
    byServer: Record<string, number>
  } {
    const byServer: Record<string, number> = {}
    let totalTools = 0

    for (const [serverId, client] of this.clients) {
      const tools = client.getTools().length
      byServer[serverId] = tools
      totalTools += tools
    }

    return {
      totalServers: this.clients.size,
      totalTools,
      byServer
    }
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect()
    }
    this.clients.clear()
  }

  /**
   * 列出所有服务器
   */
  listServers(): Array<{ id: string; name: string }> {
    const servers: Array<{ id: string; name: string }> = []
    for (const [id, client] of this.clients) {
      if (!client.isConnected()) continue
      servers.push({
        id,
        name: client.getConfig().name
      })
    }
    return servers
  }

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    await this.disconnectAll()
  }
}
