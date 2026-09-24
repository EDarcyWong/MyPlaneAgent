/**
 * 真实项目案例：代码分析工具
 *
 * 使用 MyPlaneAgent 分析项目代码结构
 */

import path from 'path'
import { fileURLToPath } from 'url'
import { PythonRuntimeManager } from './electron/main/agent/core/python-runtime-manager'
import { SkillPlatform } from './electron/main/agent/core/skill-platform'
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'
import { ModelClient } from './electron/main/agent/core/model-client'
import { AgentMemory } from './electron/main/agent/core/agent-memory'
import { AgentCore } from './electron/main/agent/core/agent-core'
import { getModelConfig } from './agent-config'
import { MockModelClient } from './mock-model-client'
import type { AgentTask } from './electron/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function analyzeProject() {
  console.log('📊 MyPlaneAgent 代码分析工具\n')
  console.log('=' .repeat(60))

  // 1. 初始化系统
  console.log('\n[1/5] 初始化 Agent 系统...')

  const dataDir = path.join(__dirname, '.agent-data')
  const skillsDir = path.join(__dirname, 'skills')

  const runtime = new PythonRuntimeManager(dataDir, { maxWorkers: 4 })
  const platform = new SkillPlatform(skillsDir, runtime)
  await platform.initialize()

  const registry = new CapabilityRegistry(platform)
  await registry.initialize()

  // 使用 Mock Model 进行测试
  const modelClient = new MockModelClient({ connection: {}, model: 'mock' })
  const memory = new AgentMemory(dataDir)

  const agent = new AgentCore(registry, modelClient, memory, {
    mode: 'auto',
    maxReplanAttempts: 2,
    autoApprove: true
  })

  console.log(`✓ 已加载 ${registry.list().length} 个能力`)

  // 2. 分析 TypeScript 文件
  console.log('\n[2/5] 分析 TypeScript 文件结构...')

  const analysisTask: AgentTask = {
    id: 'analyze-ts-files',
    description: `
      分析项目中的 TypeScript 文件:
      1. 列出 electron/main/agent/core/ 目录下的所有 .ts 文件
      2. 读取每个文件的内容
      3. 统计每个文件的行数
    `,
    context: {
      workspace: __dirname,
      targetDir: 'electron/main/agent/core'
    },
    createdAt: Date.now()
  }

  let currentStep = 0
  agent.on(event => {
    if (event.type === 'plan_created') {
      console.log(`\n执行计划 (${event.plan?.steps.length} 个步骤):`)
      event.plan?.steps.forEach((step, i) => {
        console.log(`  ${i + 1}. ${step.capability}`)
      })
    } else if (event.type === 'capability_executed') {
      currentStep++
      console.log(`  ✓ 步骤 ${currentStep} 完成`)
    }
  })

  const controller = new AbortController()
  const result1 = await agent.run(analysisTask, controller.signal)

  if (result1.success) {
    console.log('\n✓ TypeScript 文件分析完成')
  } else {
    console.error('\n✗ 分析失败:', result1.errors)
  }

  // 3. 分析 Skills
  console.log('\n[3/5] 分析 Skills 结构...')

  const skillsTask: AgentTask = {
    id: 'analyze-skills',
    description: `
      分析 Skills 目录:
      1. 列出 skills/ 目录下的所有子目录
      2. 读取每个 Skill 的 skill.json 文件
      3. 统计总共有多少个 Skill 和工具
    `,
    context: {
      workspace: __dirname,
      targetDir: 'skills'
    },
    createdAt: Date.now()
  }

  currentStep = 0
  const result2 = await agent.run(skillsTask, controller.signal)

  if (result2.success) {
    console.log('\n✓ Skills 分析完成')
  }

  // 4. 分析 Git 历史
  console.log('\n[4/5] 分析 Git 历史...')

  const gitTask: AgentTask = {
    id: 'analyze-git',
    description: `
      分析 Git 仓库:
      1. 查看当前 git 状态
      2. 获取最近 5 条提交记录
      3. 查看当前分支信息
    `,
    context: {
      workspace: __dirname
    },
    createdAt: Date.now()
  }

  currentStep = 0
  const result3 = await agent.run(gitTask, controller.signal)

  if (result3.success) {
    console.log('\n✓ Git 分析完成')
  }

  // 5. 生成报告
  console.log('\n[5/5] 生成分析报告...')

  const reportTask: AgentTask = {
    id: 'generate-report',
    description: `
      生成项目分析报告:
      1. 汇总前面的分析结果
      2. 创建一个 Markdown 格式的报告
      3. 保存到 PROJECT_ANALYSIS.md 文件

      报告应包含:
      - 项目概览
      - TypeScript 文件统计
      - Skills 统计
      - Git 状态
    `,
    context: {
      workspace: __dirname,
      previousResults: {
        tsAnalysis: result1.outputs,
        skillsAnalysis: result2.outputs,
        gitAnalysis: result3.outputs
      }
    },
    createdAt: Date.now()
  }

  currentStep = 0
  const result4 = await agent.run(reportTask, controller.signal)

  // 6. 输出结果
  console.log('\n' + '='.repeat(60))
  console.log('\n📈 分析结果汇总:\n')

  console.log('任务执行统计:')
  console.log(`  - TypeScript 分析: ${result1.success ? '✓' : '✗'} (${result1.elapsedMs}ms)`)
  console.log(`  - Skills 分析: ${result2.success ? '✓' : '✗'} (${result2.elapsedMs}ms)`)
  console.log(`  - Git 分析: ${result3.success ? '✓' : '✗'} (${result3.elapsedMs}ms)`)
  console.log(`  - 报告生成: ${result4.success ? '✓' : '✗'} (${result4.elapsedMs}ms)`)

  const totalTime = result1.elapsedMs + result2.elapsedMs + result3.elapsedMs + result4.elapsedMs
  console.log(`\n总耗时: ${totalTime}ms`)

  // 记忆统计
  const memStats = memory.getStats()
  console.log(`\n记忆系统:`)
  console.log(`  - 记录数: ${memStats.total}`)
  console.log(`  - 成功率: ${(memStats.successRate * 100).toFixed(1)}%`)
  console.log(`  - 平均步骤: ${memStats.averageSteps.toFixed(1)}`)

  // 直接查询能力来获取具体数据
  console.log('\n直接查询统计数据:')

  // 统计 TypeScript 文件
  const coreFiles = await registry.execute({
    capability: 'file.list',
    args: { path: 'electron/main/agent/core' }
  })

  if (coreFiles.success) {
    const tsFiles = coreFiles.output.files.filter((f: string) => f.endsWith('.ts'))
    console.log(`  - 核心模块文件: ${tsFiles.length} 个`)
  }

  // 统计 Skills
  const skillDirs = await registry.execute({
    capability: 'file.list',
    args: { path: 'skills' }
  })

  if (skillDirs.success) {
    console.log(`  - Skills: ${skillDirs.output.files.length} 个`)
  }

  // Git 状态
  const gitStatus = await registry.execute({
    capability: 'git.status',
    args: { workspace: __dirname }
  })

  if (gitStatus.success) {
    const status = gitStatus.output
    console.log(`  - Git 状态: ${status.modified?.length || 0} 个修改`)
  }

  console.log('\n' + '='.repeat(60))
  console.log('\n✅ 代码分析完成！\n')

  // 如果有生成报告，显示位置
  if (result4.success) {
    console.log('📄 分析报告已生成: PROJECT_ANALYSIS.md')
  }

  return {
    success: result1.success && result2.success && result3.success && result4.success,
    totalTime,
    memoryStats: memStats
  }
}

// 运行分析
analyzeProject()
  .then(result => {
    console.log('\n分析工具执行完毕')
    process.exit(result.success ? 0 : 1)
  })
  .catch(error => {
    console.error('\n分析工具异常:', error)
    process.exit(1)
  })
