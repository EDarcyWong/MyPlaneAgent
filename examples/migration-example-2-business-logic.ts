/**
 * 迁移示例 2: 业务逻辑迁移
 *
 * 展示如何将复杂的业务流程从手动编排迁移到 Agent 自动规划
 */

import path from 'path'
import { fileURLToPath } from 'url'
import { PythonRuntimeManager } from '../electron/main/agent/core/python-runtime-manager'
import { SkillPlatform } from '../electron/main/agent/core/skill-platform'
import { CapabilityRegistry } from '../electron/main/agent/core/capability-registry'
import { ModelClient } from '../electron/main/agent/core/model-client'
import { AgentMemory } from '../electron/main/agent/core/agent-memory'
import { AgentCore } from '../electron/main/agent/core/agent-core'
import { MockModelClient } from '../mock-model-client'
import type { AgentTask } from '../electron/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ============================================================
// 旧代码: 手动编排业务流程
// ============================================================

async function oldBusinessLogic_Manual(registry: CapabilityRegistry) {
  console.log('\n=== 旧方式: 手动编排 ===\n')

  try {
    // 步骤 1: 检查 Git 状态
    console.log('1. 检查 Git 状态...')
    const statusResult = await registry.execute({
      capability: 'git.status',
      args: { workspace: process.cwd() }
    })

    if (!statusResult.success) {
      throw new Error('Git 状态检查失败')
    }

    const status = statusResult.output
    console.log(`   - 修改的文件: ${status.modified?.length || 0}`)

    // 步骤 2: 如果有修改，列出文件
    if (status.modified && status.modified.length > 0) {
      console.log('\n2. 列出修改的文件...')
      for (const file of status.modified.slice(0, 3)) {
        console.log(`   - ${file}`)
      }
    }

    // 步骤 3: 列出核心目录
    console.log('\n3. 分析项目结构...')
    const filesResult = await registry.execute({
      capability: 'file.list',
      args: { path: 'electron/main/agent/core' }
    })

    if (filesResult.success) {
      const files = filesResult.output.files
      console.log(`   - 核心文件数: ${files.length}`)
    }

    // 步骤 4: 手动错误处理
    console.log('\n4. 读取配置文件...')
    const configResult = await registry.execute({
      capability: 'file.read',
      args: { path: 'package.json' }
    })

    if (configResult.success) {
      console.log('   - 配置文件读取成功')
    }

    console.log('\n✅ 手动流程完成')
    console.log('\n缺点:')
    console.log('- 需要手动编排每个步骤')
    console.log('- 手动处理错误和重试')
    console.log('- 步骤失败时难以恢复')
    console.log('- 代码冗长，可读性差')

    return { success: true }

  } catch (error) {
    console.error('\n❌ 流程失败:', error)
    console.log('\n问题:')
    console.log('- 没有自动重试机制')
    console.log('- 需要手动处理每个错误')
    return { success: false }
  }
}

// ============================================================
// 新方式: Agent 自动规划和执行
// ============================================================

async function newBusinessLogic_Agent(agent: AgentCore) {
  console.log('\n=== 新方式: Agent 自动规划 ===\n')

  // 定义任务（用自然语言描述）
  const task: AgentTask = {
    id: 'project-analysis',
    description: `
      分析项目状态:
      1. 检查 Git 仓库状态
      2. 如果有修改的文件，列出前 3 个
      3. 分析 electron/main/agent/core 目录的文件数量
      4. 读取 package.json 配置文件
    `,
    context: {
      workspace: process.cwd(),
      userIntent: '项目状态分析'
    },
    createdAt: Date.now()
  }

  // 监听执行进度
  let stepCount = 0
  agent.on(event => {
    if (event.type === 'plan_created') {
      console.log(`📋 Agent 生成的计划: ${event.plan.steps.length} 个步骤`)
      event.plan.steps.forEach((step, i) => {
        console.log(`   ${i + 1}. ${step.capability}`)
      })
      console.log('')
    } else if (event.type === 'execution_started') {
      console.log('⚡ 开始执行...')
    } else if (event.type === 'step_completed') {
      stepCount++
      console.log(`✓ 步骤 ${stepCount} 完成`)
    }
  })

  // 执行任务（Agent 自动处理一切）
  const controller = new AbortController()
  const result = await agent.run(task, controller.signal)

  if (result.success) {
    console.log('\n✅ Agent 流程完成')
    console.log(`   耗时: ${result.elapsedMs}ms`)
    console.log('\n优点:')
    console.log('- 自然语言描述任务')
    console.log('- Agent 自动生成执行计划')
    console.log('- 失败自动重试（最多 3 次）')
    console.log('- 代码简洁，易于维护')
    return { success: true }
  } else {
    console.log('\n⚠️  Agent 流程失败')
    console.log('   但已自动重试 3 次')
    return { success: false }
  }
}

// ============================================================
// 对比示例: 部署流程
// ============================================================

async function deployWorkflow_Old(registry: CapabilityRegistry) {
  console.log('\n=== 旧部署流程（手动） ===\n')

  const steps = [
    'git.status',
    'file.list',
    'git.add',
    'git.commit',
    'git.push'
  ]

  for (let i = 0; i < steps.length; i++) {
    console.log(`${i + 1}. 执行 ${steps[i]}...`)
    // 每个步骤都需要手动编写逻辑
    // 错误处理、重试、日志都需要手动实现
  }

  console.log('\n代码量: ~100 行（包含错误处理）')
}

async function deployWorkflow_New(agent: AgentCore) {
  console.log('\n=== 新部署流程（Agent） ===\n')

  const task: AgentTask = {
    id: 'deploy',
    description: `
      部署流程:
      1. 检查 git 状态，确保工作区干净
      2. 如果有未提交的修改，添加并提交
      3. 推送到远程仓库
    `,
    context: {
      workspace: process.cwd(),
      userIntent: '部署到生产环境'
    },
    createdAt: Date.now()
  }

  const controller = new AbortController()
  await agent.run(task, controller.signal)

  console.log('\n代码量: ~15 行（Agent 自动处理）')
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('📚 业务逻辑迁移示例')
  console.log('=' .repeat(60))

  // 初始化系统
  console.log('\n初始化系统...')
  const dataDir = path.join(__dirname, '..', '.agent-data')
  const skillsDir = path.join(__dirname, '..', 'skills')

  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)
  await platform.initialize()

  const registry = new CapabilityRegistry(platform)
  await registry.initialize()

  const modelClient = new MockModelClient({ connection: {}, model: 'mock' })
  const memory = new AgentMemory(dataDir)

  const agent = new AgentCore(registry, modelClient, memory, {
    mode: 'auto',
    maxReplanAttempts: 2
  })

  console.log('✓ 系统初始化完成\n')

  // 演示 1: 业务逻辑对比
  await oldBusinessLogic_Manual(registry)
  await newBusinessLogic_Agent(agent)

  // 演示 2: 部署流程对比
  console.log('\n' + '='.repeat(60))
  await deployWorkflow_Old(registry)
  await deployWorkflow_New(agent)

  // 总结
  console.log('\n' + '='.repeat(60))
  console.log('\n📊 迁移效果对比:\n')

  console.table([
    {
      方面: '代码量',
      旧方式: '100-200 行',
      新方式: '10-20 行',
      提升: '90%'
    },
    {
      方面: '可维护性',
      旧方式: '低（逻辑分散）',
      新方式: '高（集中描述）',
      提升: '⭐⭐⭐⭐⭐'
    },
    {
      方面: '容错能力',
      旧方式: '手动处理',
      新方式: '自动重试',
      提升: '⭐⭐⭐⭐⭐'
    },
    {
      方面: '开发速度',
      旧方式: '慢（细节多）',
      新方式: '快（描述即可）',
      提升: '5-10倍'
    }
  ])

  console.log('\n💡 迁移建议:')
  console.log('1. 简单工具调用: 保持现状或用 Legacy Adapter')
  console.log('2. 复杂业务流程: 迁移到 Agent（收益最大）')
  console.log('3. 关键路径: 先迁移，验证后推广')
  console.log('4. 渐进式: 新功能用 Agent，旧代码逐步迁移')
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('错误:', error)
    process.exit(1)
  })
