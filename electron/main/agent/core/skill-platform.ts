/**
 * Skill Platform
 * 管理 Skill 生命周期、Tool 执行、权限检查
 */

import fs from 'node:fs'
import path from 'node:path'
import type {
  SkillManifest,
  SkillInstance,
  SkillInstallOptions,
  SkillSource,
  ToolDefinition
} from '../../../shared/types/index.js'
import type { PythonRuntimeManager } from './python-runtime-manager.js'

export class SkillPlatform {
  private removing = new Set<string>()
  private activeExecutions = new Map<string, number>()
  private skills = new Map<string, SkillInstance>()

  constructor(
    private skillsDir: string,
    private runtimeManager: PythonRuntimeManager
  ) {
    // 确保 skills 目录存在
    fs.mkdirSync(skillsDir, { recursive: true })
  }

  /**
   * 初始化：扫描并加载所有 Skills
   */
  async initialize(): Promise<void> {
    if(this.removing.size)throw new Error('正在删除插件，请稍后刷新')
    console.log(`[SkillPlatform] Scanning skills directory: ${this.skillsDir}`)

    const previous = this.skills
    this.skills = new Map()
    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const skillPath = path.join(this.skillsDir, entry.name)
      const manifestPath = path.join(skillPath, 'skill.json')

      if (!fs.existsSync(manifestPath)) {
        console.warn(`[SkillPlatform] No skill.json found in: ${skillPath}`)
        continue
      }

      try {
        const manifest: SkillManifest = JSON.parse(
          fs.readFileSync(manifestPath, 'utf8')
        )

        // 验证 manifest
        this.validateManifest(manifest)

        const stats = fs.statSync(skillPath)

        const instance: SkillInstance = {
          manifest,
          path: skillPath,
          enabled: manifest.enabled !== false,
          installedAt: stats.birthtime.toISOString(),
          updatedAt: fs.statSync(manifestPath).mtime.toISOString(),
          status: 'idle'
        }

        this.skills.set(manifest.id, instance)
        console.log(`[SkillPlatform] Loaded skill: ${manifest.id} (${manifest.name})`)

      } catch (error) {
        console.error(`[SkillPlatform] Failed to load skill ${entry.name}:`, error)
      }
    }

    for (const skillId of previous.keys()) {
      // Code and dependencies can change without touching skill.json.
      await this.runtimeManager.stopWorker(skillId)
    }

    console.log(`[SkillPlatform] Loaded ${this.skills.size} skills`)
  }

  /**
   * 验证 skill.json
   */
  validateManifest(manifest: SkillManifest): void {
    if (!manifest.id || !/^[a-z0-9-]+$/.test(manifest.id)) {
      throw new Error(`Invalid skill id: ${manifest.id}`)
    }

    if (!manifest.name) {
      throw new Error('Skill name is required')
    }

    if (!manifest.version) {
      throw new Error('Skill version is required')
    }

    if (!manifest.category) {
      throw new Error('Skill category is required')
    }

    if (!manifest.runtime || !manifest.runtime.entry) {
      throw new Error('Skill runtime entry is required')
    }
    if (manifest.runtime.type !== 'python' || manifest.runtime.entry !== 'index.py') {
      throw new Error('Only Python index.py skills are supported')
    }
    if (!Array.isArray(manifest.capabilities?.tools)) {
      throw new Error('Skill capabilities.tools is required')
    }
    const toolNames = new Set<string>()
    for (const tool of manifest.capabilities.tools) {
      if (!tool || typeof tool.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tool.name) || toolNames.has(tool.name)) {
        throw new Error('Skill tool names must be unique Python identifiers')
      }
      if (typeof tool.description !== 'string' || !tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters)) {
        throw new Error(`Invalid tool definition: ${tool.name}`)
      }
      toolNames.add(tool.name)
    }
    if (!manifest.permissions || typeof manifest.permissions !== 'object') {
      throw new Error('Skill permissions are required')
    }
    const files = manifest.permissions.fileSystem
    if (files && (!Array.isArray(files.read) || !Array.isArray(files.write) ||
      [...files.read, ...files.write].some(pattern => typeof pattern !== 'string'))) {
      throw new Error('Skill file permissions must be string arrays')
    }
  }

  /**
   * 获取 Skill
   */
  get(skillId: string): SkillInstance | undefined {
    return this.skills.get(skillId)
  }

  /**
   * 获取所有 Skills（用于管理界面）
   */
  getAll(): Map<string, SkillInstance> {
    return this.skills
  }

  /**
   * 列出所有 Skills
   */
  list(options?: { enabled?: boolean; category?: string }): SkillInstance[] {
    let skills = Array.from(this.skills.values())

    if (options?.enabled !== undefined) {
      skills = skills.filter(s => s.enabled === options.enabled)
    }

    if (options?.category) {
      skills = skills.filter(s => s.manifest.category === options.category)
    }

    return skills
  }

  /**
   * 获取已启用的 Skills
   */
  getEnabled(): SkillInstance[] {
    return this.list({ enabled: true })
  }

  /**
   * 获取 Skill 的所有 Tools
   */
  getTools(skillId: string): ToolDefinition[] {
    const skill = this.skills.get(skillId)
    if (!skill || !skill.enabled) return []

    return skill.manifest.capabilities.tools || []
  }

  /**
   * 获取所有 Tools（扁平化）
   */
  getAllTools(): Array<{
    skillId: string
    skillName: string
    category: string
    tool: ToolDefinition
  }> {
    const tools: Array<{
      skillId: string
      skillName: string
      category: string
      tool: ToolDefinition
    }> = []

    for (const skill of this.getEnabled()) {
      for (const tool of skill.manifest.capabilities.tools || []) {
        tools.push({
          skillId: skill.manifest.id,
          skillName: skill.manifest.name,
          category: skill.manifest.category,
          tool
        })
      }
    }

    return tools
  }

  /**
   * 执行 Skill Tool
   */
  async executeTool(
    skillId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    workspace?: string,
    context?: Record<string, unknown>
  ): Promise<unknown> {
    const skill = this.skills.get(skillId)

    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    if (!skill.enabled) {
      throw new Error(`Skill disabled: ${skillId}`)
    }

    if (skill.status === 'error') {
      throw new Error(`Skill in error state: ${skillId}`)
    }

    // 查找 Tool 定义
    const tool = skill.manifest.capabilities.tools?.find(t => t.name === toolName)
    if (!tool) {
      throw new Error(`Tool not found: ${skillId}.${toolName}`)
    }

    // TODO: 参数验证（使用 ajv）
    // this.validateArgs(tool.parameters, args)

    this.activeExecutions.set(skillId,(this.activeExecutions.get(skillId)||0)+1)
    skill.status = 'loading'
    try {
      await this.checkPermissions(skill, args)
      // 提交到 Runtime Manager
      const response = await this.runtimeManager.execute(
        {
          skillId: skill.manifest.id,
          skillPath: skill.path,
          tool: toolName,
          args,
          venv: skill.manifest.runtime.venv,
          workspace,
          context
        },
        signal
      )

      skill.status = 'ready'
      skill.error = undefined

      return response.output

    } catch (error) {
      skill.status = 'ready'
      skill.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      const remaining=(this.activeExecutions.get(skillId)||1)-1
      if(remaining)this.activeExecutions.set(skillId,remaining);else this.activeExecutions.delete(skillId)
    }
  }

  /**
   * 权限检查
   */
  private async checkPermissions(
    skill: SkillInstance,
    args: Record<string, unknown>
  ): Promise<void> {
    const perms = skill.manifest.permissions

    // 检查文件系统权限
    if (perms.fileSystem) {
      const filePath = args.path as string | undefined
      if (filePath) {
        const allowedRead = perms.fileSystem.read || []
        const allowedWrite = perms.fileSystem.write || []

        // TODO: 使用 minimatch 或 pathspec 检查路径是否在允许范围内
        // 简化版：检查是否在允许的模式中
        const isReadAllowed = allowedRead.some(pattern =>
          pattern === '**/*' || filePath.startsWith(pattern.replace('**/*', ''))
        )

        const isWriteNeeded = args.content !== undefined || args.write === true
        if (isWriteNeeded) {
          const isWriteAllowed = allowedWrite.some(pattern =>
            pattern === '**/*' || filePath.startsWith(pattern.replace('**/*', ''))
          )

          if (!isWriteAllowed) {
            throw new Error(
              `Skill ${skill.manifest.id} not permitted to write to: ${filePath}`
            )
          }
        } else if (!isReadAllowed) {
          throw new Error(
            `Skill ${skill.manifest.id} not permitted to read from: ${filePath}`
          )
        }
      }
    }

    // 检查网络权限
    if (!perms.network && (args.url || args.host || args.domain)) {
      throw new Error(`Skill ${skill.manifest.id} not permitted to access network`)
    }

    // 检查进程权限
    if (!perms.process && (args.command || args.shell || args.exec)) {
      throw new Error(`Skill ${skill.manifest.id} not permitted to spawn processes`)
    }
  }

  /**
   * 启用 Skill
   */
  async enable(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId)
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    skill.enabled = true
    console.log(`[SkillPlatform] Enabled skill: ${skillId}`)
  }

  /**
   * 禁用 Skill
   */
  async disable(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId)
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    skill.enabled = false

    // 停止关联的 Worker
    await this.runtimeManager.stopWorker(skillId)

    console.log(`[SkillPlatform] Disabled skill: ${skillId}`)
  }

  /**
   * 安装 Skill
   */
  async install(
    source: SkillSource,
    options?: SkillInstallOptions
  ): Promise<SkillInstance> {
    // TODO: 实现安装逻辑
    // 1. 根据 source.type 下载/解压 Skill
    //    - local: 复制本地目录
    //    - git: git clone
    //    - npm: npm install
    //    - marketplace: 从 API 下载
    // 2. 验证 skill.json
    // 3. 安装依赖（pip install -r requirements.txt）
    // 4. 加载到 skills Map
    // 5. 可选：立即启用

    throw new Error('Not implemented: install')
  }

  /**
   * 卸载 Skill
   */
  async uninstall(skillId: string, remove:(directory:string)=>Promise<void>=async directory=>{fs.rmSync(directory,{recursive:true,force:true})}): Promise<void> {
    const skill=this.skills.get(skillId)
    if(!skill)throw new Error(`插件不存在: ${skillId}`)
    if(this.removing.has(skillId))throw new Error('插件正在删除')
    if(this.activeExecutions.has(skillId))throw new Error('插件正在执行，请等待完成后再删除')
    const root=fs.realpathSync(this.skillsDir),target=fs.realpathSync(skill.path)
    if(path.dirname(target)!==root||fs.lstatSync(skill.path).isSymbolicLink())throw new Error('只能删除插件目录内的独立插件')
    this.removing.add(skillId)
    const enabled=skill.enabled;skill.enabled=false
    try{
      await this.runtimeManager.stopWorker(skillId)
      await remove(skill.path)
      this.skills.delete(skillId)
    }catch(error){skill.enabled=enabled;throw error}finally{this.removing.delete(skillId)}
  }

  /**
   * 重新加载 Skill
   */
  async reload(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId)
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    console.log(`[SkillPlatform] Reloading skill: ${skillId}`)

    // 停止 Worker
    await this.runtimeManager.stopWorker(skillId)

    // 重新读取 skill.json
    const manifestPath = path.join(skill.path, 'skill.json')
    const manifest: SkillManifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8')
    )

    this.validateManifest(manifest)

    skill.manifest = manifest
    skill.updatedAt = fs.statSync(manifestPath).mtime.toISOString()
    skill.status = 'idle'
    skill.error = undefined

    console.log(`[SkillPlatform] Reloaded skill: ${skillId}`)
  }

  /**
   * 获取 Skill 统计
   */
  getStats(): {
    total: number
    enabled: number
    byCategory: Record<string, number>
    byRuntime: Record<string, number>
  } {
    const skills = Array.from(this.skills.values())

    const byCategory: Record<string, number> = {}
    const byRuntime: Record<string, number> = {}

    for (const skill of skills) {
      byCategory[skill.manifest.category] =
        (byCategory[skill.manifest.category] || 0) + 1

      byRuntime[skill.manifest.runtime.type] =
        (byRuntime[skill.manifest.runtime.type] || 0) + 1
    }

    return {
      total: skills.length,
      enabled: skills.filter(s => s.enabled).length,
      byCategory,
      byRuntime
    }
  }

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    // 停止所有关联的 Workers
    for (const skillId of this.skills.keys()) {
      await this.runtimeManager.stopWorker(skillId).catch(() => {})
    }
    console.log('[SkillPlatform] Disposed')
  }
}
