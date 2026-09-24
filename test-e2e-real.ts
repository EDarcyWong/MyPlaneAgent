/**
 * 端到端测试：真实大模型 + 完整 Agent 流程
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonRuntimeManager } from './electron/main/agent/core/python-runtime-manager.js'
import { SkillPlatform } from './electron/main/agent/core/skill-platform.js'
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry.js'
import { MCPAdapter } from './electron/main/agent/core/mcp-adapter.js'
import { ModelClient } from './electron/main/agent/core/model-client.js'
import { AgentMemory } from './electron/main/agent/core/agent-memory.js'
import { AgentCore } from './electron/main/agent/core/agent-core.js'
import { getModelConfig, validateConfig } from './agent-config.js'
import { MockModelClient } from './mock-model-client.js'
import type { AgentTask } from './electron/shared/types/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function testRealAgent() {
  console.log('🚀 开始端到端真实测试...\n')

  // 1. 配置大模型
  console.log('=== 步骤 1: 配置大模型 ===')
  const useMock = !process.env.AI_PROVIDER || process.env.USE_MOCK === 'true'

  if (useMock) {
    console.log('✓ 使用 Mock Model Client（测试模式）')
  } else {
    const modelConfig = getModelConfig()
    const provider = process.env.AI_PROVIDER
    try {
      validateConfig(modelConfig.connection, provider)
      console.log(`✓ 使用 ${provider} 模型: ${modelConfig.model}`)
    } catch (error) {
      console.error(`✗ 配置验证失败: ${error instanceof Error ? error.message : error}`)
      console.log('\n提示: 请设置环境变量或使用本地 Ollama')
      console.log('  export AI_PROVIDER=ollama')
      console.log('  export OLLAMA_MODEL=qwen2.5:14b')
      process.exit(1)
    }
  }

  // 2. 初始化基础设施
  console.log('\n=== 步骤 2: 初始化基础设施 ===')

  const dataDir = path.join(__dirname, '.test-data')
  const skillsDir = path.join(__dirname, 'skills')

  const runtime = new PythonRuntimeManager(dataDir, { maxWorkers: 4 })
  const platform = new SkillPlatform(skillsDir, runtime)
  const mcpAdapter = new MCPAdapter()
  const registry = new CapabilityRegistry(platform, mcpAdapter)

  await platform.initialize()
  console.log(`✓ Skill Platform 初始化完成`)

  // 添加示例 MCP 服务器
  await mcpAdapter.addServer({
    id: 'example',
    name: 'Example MCP Server',
    command: 'node',
    args: [path.join(__dirname, 'test-mcp-server.mjs')]
  })
  console.log(`✓ MCP Adapter 初始化完成`)

  await registry.initialize()
  console.log(`✓ Capability Registry 初始化完成`)
  console.log(`  - 总能力数: ${registry.list().length}`)

  // 3. 初始化 Agent Core
  console.log('\n=== 步骤 3: 初始化 Agent Core ===')

  const modelClient = useMock
    ? new MockModelClient({ connection: {}, model: 'mock' })
    : new ModelClient({
        connection: getModelConfig().connection,
        model: getModelConfig().model
      })
  console.log(`✓ Model Client 初始化完成`)

  const memory = new AgentMemory(dataDir)
  console.log(`✓ Agent Memory 初始化完成`)

  const agent = new AgentCore(
    registry,
    modelClient,
    memory,
    {
      mode: 'auto',
      maxReplanAttempts: 2,
      autoApprove: true,
      temperature: 0.2
    }
  )
  console.log(`✓ Agent Core 初始化完成`)

  // 4. 执行测试任务
  console.log('\n=== 步骤 4: 执行测试任务 ===')

  const task: AgentTask = {
    id: 'e2e-test-1',
    description: '列出 skills 目录下的所有文件，统计总共有多少个 Skill',
    context: {
      workspace: __dirname,
      userIntent: '分析 Skills 目录结构'
    },
    createdAt: Date.now()
  }

  console.log(`任务: ${task.description}\n`)

  // 监听事件
  const events: string[] = []
  agent.on(event => {
    events.push(event.type)

    if (event.type === 'planning_started') {
      console.log('📋 开始规划...')
    } else if (event.type === 'plan_created') {
      console.log(`✓ 计划生成: ${event.plan?.steps.length} 个步骤`)
      console.log(`  理由: ${event.plan?.reasoning}`)
      event.plan?.steps.forEach((step, i) => {
        console.log(`  ${i + 1}. ${step.capability}`)
      })
    } else if (event.type === 'execution_started') {
      console.log('\n⚡ 开始执行...')
    } else if (event.type === 'execution_completed') {
      console.log(`✓ 执行完成 (${event.result?.elapsedMs}ms)`)
    } else if (event.type === 'replanning_started') {
      console.log(`🔄 重新规划: ${event.reason}`)
    } else if (event.type === 'task_failed') {
      console.log(`✗ 任务失败: ${event.error}`)
    }
  })

  const controller = new AbortController()

  try {
    const result = await agent.run(task, controller.signal)

    console.log('\n=== 步骤 5: 验证结果 ===')
    console.log(`状态: ${result.success ? '✓ 成功' : '✗ 失败'}`)
    console.log(`总耗时: ${result.elapsedMs}ms`)
    console.log(`步骤数: ${result.stepResults?.length || 0}`)

    if (result.success) {
      console.log('\n最终输出:')
      console.log(JSON.stringify(result.outputs[result.outputs.length - 1], null, 2))
    } else {
      console.log('\n错误信息:')
      result.errors?.forEach((err, i) => {
        if (err) console.log(`  ${i + 1}. ${err}`)
      })
    }

    // 6. 记忆验证
    console.log('\n=== 步骤 6: 记忆验证 ===')
    const memoryStats = memory.getStats()
    console.log(`记忆条目: ${memoryStats.total}`)
    console.log(`成功率: ${(memoryStats.successRate * 100).toFixed(1)}%`)
    console.log(`平均步骤数: ${memoryStats.averageSteps.toFixed(1)}`)

    // 7. 事件流验证
    console.log('\n=== 步骤 7: 事件流验证 ===')
    console.log(`事件序列: ${events.join(' → ')}`)

    // 清理
    await mcpAdapter.disconnectAll()

    console.log('\n' + '='.repeat(50))
    console.log(result.success ? '✓ 端到端测试通过！' : '✗ 端到端测试失败')
    console.log('='.repeat(50))

    return result.success

  } catch (error) {
    console.error('\n✗ 测试异常:', error)
    await mcpAdapter.disconnectAll()
    return false
  }
}

// 运行测试
testRealAgent()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('测试崩溃:', error)
    process.exit(1)
  })
