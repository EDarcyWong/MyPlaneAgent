import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { Capability } from '../../../shared/types/index.js'
import { stopProcessTree } from '../processes.js'

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
  readOnly: boolean
}

export class MCPClient {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  private tools: MCPTool[] = []

  constructor(private config: MCPServerConfig) {}

  async connect(): Promise<void> {
    if (this.client) return
    const environment = Object.fromEntries(
      Object.entries({ ...process.env, ...this.config.env }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args || [],
      env: environment,
      stderr: 'pipe',
      maxBufferSize: 1_000_000
    })
    transport.stderr?.on('data', () => {})
    const client = new Client({ name: 'MyPlaneAgent', version: '0.1.0' }, {
      capabilities: {},
      versionNegotiation: { mode: 'legacy' }
    })
    client.onclose = () => { this.tools = []; this.client = null; this.transport = null }
    try {
      await client.connect(transport, { timeout: 15_000 })
      const response = await client.listTools({}, { timeout: 15_000, cacheMode: 'bypass' })
      if (response.tools.length > 100 || JSON.stringify(response.tools).length > 200_000) {
        throw new Error('MCP tool catalog exceeds limits')
      }
      this.tools = response.tools.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema as Record<string, unknown>,
        readOnly: tool.annotations?.readOnlyHint === true
      }))
      this.client = client
      this.transport = transport
    } catch (error) {
      if (transport.pid) await stopProcessTree(transport.pid)
      await client.close().catch(() => {})
      throw error
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client
    const transport = this.transport
    this.client = null
    this.transport = null
    this.tools = []
    if (transport?.pid) await stopProcessTree(transport.pid)
    await client?.close().catch(() => {})
  }

  getTools(): MCPTool[] { return this.tools }
  getConfig(): MCPServerConfig { return this.config }
  isConnected(): boolean { return this.client !== null }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!this.client || !this.tools.some(tool => tool.name === name)) throw new Error('MCP tool not available')
    const response = await this.client.callTool({ name, arguments: args }, { signal, timeout: 60_000 })
    if (response.isError) throw new Error(JSON.stringify(response.content).slice(0, 1000))
    return response.structuredContent || response.content
  }

  toCapabilities(): Capability[] {
    return this.tools.map(tool => ({
      name: `mcp.${this.config.id}.${tool.name}`,
      category: 'mcp',
      description: `[${this.config.name}] ${tool.description}`,
      parameters: tool.inputSchema,
      source: { type: 'mcp', serverId: this.config.id },
      runtime: 'mcp',
      permissions: ['network'],
      tags: ['mcp', this.config.id, ...(tool.readOnly ? [] : ['requires-approval', 'risk:high'])]
    }))
  }
}
