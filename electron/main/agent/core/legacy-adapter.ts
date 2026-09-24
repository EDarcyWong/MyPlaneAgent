/**
 * Legacy Adapter (向后兼容层)
 * 将旧的工具接口映射到新的 5 层架构
 */

import type { CapabilityRegistry } from './capability-registry.js'

/**
 * 兼容旧的工具调用接口
 */
export class LegacyAdapter {
  private static instance: LegacyAdapter | null = null
  private toolMapping: Record<string, string>

  constructor(private capabilityRegistry: CapabilityRegistry) {
    // 工具名称映射
    this.toolMapping = {
      // 文件操作
      'readFile': 'file.read',
      'writeFile': 'file.write',
      'listFiles': 'file.list',

      // Git 操作
      'gitStatus': 'git.status',
      'gitAdd': 'git.add',
      'gitCommit': 'git.commit',
      'gitPush': 'git.push',
      'gitPull': 'git.pull',
      'gitLog': 'git.log',
      'gitDiff': 'git.diff',
      'gitBranch': 'git.branch',

      // 浏览器操作（预留）
      'browserOpen': 'browser.open',
      'browserScreenshot': 'browser.screenshot',
      'browserClick': 'browser.click'
    }
  }

  /**
   * 初始化单例
   */
  static initialize(capabilityRegistry: CapabilityRegistry): LegacyAdapter {
    if (!LegacyAdapter.instance) {
      LegacyAdapter.instance = new LegacyAdapter(capabilityRegistry)
    }
    return LegacyAdapter.instance
  }

  /**
   * 获取单例
   */
  static getInstance(): LegacyAdapter {
    if (!LegacyAdapter.instance) {
      throw new Error('Legacy adapter not initialized. Call initialize() first.')
    }
    return LegacyAdapter.instance
  }

  /**
   * 旧接口：直接执行工具
   * 映射到：Capability Registry 执行
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ success: boolean; output?: unknown; error?: string; elapsedMs: number }> {
    const startTime = Date.now()

    try {
      // 映射工具名称到能力名称
      const capability = this.mapToolToCapability(toolName)

      // 如果没有提供 signal，创建一个默认的
      const abortController = new AbortController()
      const actualSignal = signal || abortController.signal

      const result = await this.capabilityRegistry.execute(
        {
          capability,
          args,
          workspace: args.workspace as string || process.cwd()
        },
        actualSignal
      )

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        elapsedMs: Date.now() - startTime
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startTime
      }
    }
  }

  /**
   * 工具名称映射
   */
  private mapToolToCapability(toolName: string): string {
    return this.toolMapping[toolName] || toolName
  }

  /**
   * 检查能力是否可用
   */
  hasCapability(toolName: string): boolean {
    const capability = this.mapToolToCapability(toolName)
    return this.capabilityRegistry.has(capability)
  }

  /**
   * 列出所有可用工具（旧接口）
   */
  listTools(): Array<{
    name: string
    description: string
    category: string
  }> {
    const capabilities = this.capabilityRegistry.list()

    return capabilities.map(cap => ({
      name: this.mapCapabilityToTool(cap.name),
      description: cap.description,
      category: cap.category
    }))
  }

  /**
   * 能力名称映射回工具名称（反向）
   */
  private mapCapabilityToTool(capability: string): string {
    const reverseMappings: Record<string, string> = {
      'file.read': 'readFile',
      'file.write': 'writeFile',
      'file.list': 'listFiles',
      'git.status': 'gitStatus',
      'git.add': 'gitAdd',
      'git.commit': 'gitCommit',
      'git.push': 'gitPush',
      'git.pull': 'gitPull',
      'git.log': 'gitLog',
      'git.diff': 'gitDiff',
      'git.branch': 'gitBranch',
      'browser.open': 'browserOpen',
      'browser.screenshot': 'browserScreenshot',
      'browser.click': 'browserClick'
    }

    return reverseMappings[capability] || capability
  }
}

// 兼容旧的导出接口（保留向后兼容）
export function initializeLegacyAdapter(capabilityRegistry: CapabilityRegistry): void {
  LegacyAdapter.initialize(capabilityRegistry)
}

export function getLegacyAdapter(): LegacyAdapter {
  return LegacyAdapter.getInstance()
}
