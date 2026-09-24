/**
 * 迁移示例 1: 简单工具调用迁移
 *
 * 展示如何将旧的直接函数调用迁移到新架构
 */

import path from 'path'
import { fileURLToPath } from 'url'
import { PythonRuntimeManager } from './electron/main/agent/core/python-runtime-manager'
import { SkillPlatform } from './electron/main/agent/core/skill-platform'
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'
import { LegacyAdapter } from './electron/main/agent/core/legacy-adapter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ============================================================
// 旧代码示例（假设的旧实现）
// ============================================================

// 旧的工具函数（已废弃）
// async function readFile(path: string): Promise<string>
// async function writeFile(path: string, content: string): Promise<void>
// async function listFiles(path: string): Promise<string[]>

// 旧代码使用方式
async function oldCodeExample() {
  // 这是旧代码的调用方式（现在不推荐）
  // const content = await readFile('package.json')
  // const files = await listFiles('src')
  // await writeFile('output.txt', 'hello')
}

// ============================================================
// 迁移方案 A: 使用 Legacy Adapter（最简单）
// ============================================================

async function migration_A_LegacyAdapter() {
  console.log('\n=== 方案 A: Legacy Adapter ===\n')

  // 1. 初始化系统
  const dataDir = path.join(__dirname, '.agent-data')
  const skillsDir = path.join(__dirname, 'skills')

  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)
  await platform.initialize()

  const registry = new CapabilityRegistry(platform)
  await registry.initialize()

  // 2. 初始化 Legacy Adapter
  const adapter = LegacyAdapter.initialize(registry)

  // 3. 使用旧的工具名（无需修改业务逻辑）
  console.log('1. 读取文件（旧工具名）')
  const readResult = await adapter.executeTool('readFile', {
    path: 'package.json'
  })
  console.log(`✓ 成功: ${readResult.success}`)

  console.log('\n2. 列出文件（旧工具名）')
  const listResult = await adapter.executeTool('listFiles', {
    path: 'skills'
  })
  console.log(`✓ 成功: ${listResult.success}`)

  console.log('\n3. Git 状态（旧工具名）')
  const gitResult = await adapter.executeTool('gitStatus', {
    workspace: process.cwd()
  })
  console.log(`✓ 成功: ${gitResult.success}`)

  console.log('\n✅ 方案 A 完成')
  console.log('优点: 代码改动最小，只需初始化 Legacy Adapter')
  console.log('缺点: 不能使用新功能（如智能规划）')
}

// ============================================================
// 迁移方案 B: 直接使用 Capability Registry（推荐）
// ============================================================

async function migration_B_DirectRegistry() {
  console.log('\n=== 方案 B: 直接使用 Registry ===\n')

  // 1. 初始化系统
  const dataDir = path.join(__dirname, '.agent-data')
  const skillsDir = path.join(__dirname, 'skills')

  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)
  await platform.initialize()

  const registry = new CapabilityRegistry(platform)
  await registry.initialize()

  // 2. 使用新的能力名称
  console.log('1. 读取文件（新能力名）')
  const readResult = await registry.execute({
    capability: 'file.read',
    args: { path: 'package.json' }
  })
  console.log(`✓ 成功: ${readResult.success}`)

  console.log('\n2. 列出文件（新能力名）')
  const listResult = await registry.execute({
    capability: 'file.list',
    args: { path: 'skills' }
  })
  console.log(`✓ 成功: ${listResult.success}`)

  console.log('\n3. Git 状态（新能力名）')
  const gitResult = await registry.execute({
    capability: 'git.status',
    args: { workspace: process.cwd() }
  })
  console.log(`✓ 成功: ${gitResult.success}`)

  console.log('\n✅ 方案 B 完成')
  console.log('优点: 使用标准接口，易于扩展')
  console.log('缺点: 需要修改工具名称')
}

// ============================================================
// 迁移方案 C: 封装为工具函数（推荐用于大型项目）
// ============================================================

// 创建封装的工具函数
class ProjectTools {
  constructor(private registry: CapabilityRegistry) {}

  async readFile(path: string): Promise<string> {
    const result = await this.registry.execute({
      capability: 'file.read',
      args: { path }
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to read file')
    }
    return result.output.content
  }

  async writeFile(path: string, content: string): Promise<void> {
    const result = await this.registry.execute({
      capability: 'file.write',
      args: { path, content }
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to write file')
    }
  }

  async listFiles(path: string): Promise<string[]> {
    const result = await this.registry.execute({
      capability: 'file.list',
      args: { path }
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to list files')
    }
    return result.output.files
  }

  async gitStatus(workspace: string): Promise<any> {
    const result = await this.registry.execute({
      capability: 'git.status',
      args: { workspace }
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to get git status')
    }
    return result.output
  }
}

async function migration_C_WrappedTools() {
  console.log('\n=== 方案 C: 封装工具类 ===\n')

  // 1. 初始化系统
  const dataDir = path.join(__dirname, '.agent-data')
  const skillsDir = path.join(__dirname, 'skills')

  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)
  await platform.initialize()

  const registry = new CapabilityRegistry(platform)
  await registry.initialize()

  // 2. 创建工具类实例
  const tools = new ProjectTools(registry)

  // 3. 使用和旧代码完全一样的接口
  console.log('1. 读取文件')
  const content = await tools.readFile('package.json')
  console.log(`✓ 读取成功，长度: ${content.length}`)

  console.log('\n2. 列出文件')
  const files = await tools.listFiles('skills')
  console.log(`✓ 找到 ${files.length} 个文件`)

  console.log('\n3. Git 状态')
  const status = await tools.gitStatus(process.cwd())
  console.log(`✓ Git 状态获取成功`)

  console.log('\n✅ 方案 C 完成')
  console.log('优点: 接口和旧代码完全一致，易于维护')
  console.log('缺点: 需要为每个工具编写封装代码')
}

// ============================================================
// 迁移建议
// ============================================================

async function main() {
  console.log('📚 工具调用迁移示例')
  console.log('=' .repeat(60))

  console.log('\n选择迁移方案:')
  console.log('- 方案 A: Legacy Adapter（最快）')
  console.log('- 方案 B: 直接使用 Registry（推荐）')
  console.log('- 方案 C: 封装工具类（大型项目）')

  // 运行所有示例
  await migration_A_LegacyAdapter()
  await migration_B_DirectRegistry()
  await migration_C_WrappedTools()

  console.log('\n' + '='.repeat(60))
  console.log('\n✅ 所有迁移方案演示完成')
  console.log('\n💡 建议:')
  console.log('1. 小项目/快速验证: 使用方案 A')
  console.log('2. 新项目/重构项目: 使用方案 B')
  console.log('3. 大型现有项目: 使用方案 C')
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('错误:', error)
    process.exit(1)
  })
