/**
 * 集成测试：5 层架构端到端测试
 * 测试路径：Python Runtime Manager → Skill Platform → Capability Registry
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonRuntimeManager } from './electron/main/agent/core/python-runtime-manager.js'
import { SkillPlatform } from './electron/main/agent/core/skill-platform.js'
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = __dirname

async function testRuntimeManager() {
  console.log('\n=== Test 1: Python Runtime Manager ===')

  const dataDir = path.join(projectRoot, '.test-data')
  const runtime = new PythonRuntimeManager(dataDir)

  try {
    const controller = new AbortController()

    const result = await runtime.execute(
      {
        skillId: 'file-operations',
        skillPath: path.join(projectRoot, 'skills/file-operations'),
        tool: 'list',
        args: { path: '.', depth: 2 },
        venv: false,
        workspace: projectRoot
      },
      controller.signal
    )

    console.log('✓ Runtime Manager 测试通过')
    console.log('  输出:', JSON.stringify(result.output, null, 2).substring(0, 200))
    console.log('  耗时:', result.elapsedMs, 'ms')

    await runtime.stopAll()
    return true

  } catch (error) {
    console.error('✗ Runtime Manager 测试失败:', error)
    return false
  }
}

async function testSkillPlatform() {
  console.log('\n=== Test 2: Skill Platform ===')

  const dataDir = path.join(projectRoot, '.test-data')
  const skillsDir = path.join(projectRoot, 'skills')

  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)

  try {
    await platform.initialize()

    const skills = platform.list()
    console.log(`✓ 加载了 ${skills.length} 个 Skills`)

    for (const skill of skills) {
      console.log(`  - ${skill.manifest.id} (${skill.manifest.name})`)
    }

    // 执行 file.list
    const controller = new AbortController()
    const result = await platform.executeTool(
      'file-operations',
      'list',
      { path: '.', depth: 1 },
      controller.signal,
      projectRoot
    )

    console.log('✓ Skill Platform 测试通过')
    console.log('  file.list 结果:', JSON.stringify(result, null, 2).substring(0, 200))

    await runtime.stopAll()
    return true

  } catch (error) {
    console.error('✗ Skill Platform 测试失败:', error)
    return false
  }
}

async function testCapabilityRegistry() {
  console.log('\n=== Test 3: Capability Registry ===')

  const dataDir = path.join(projectRoot, '.test-data')
  const skillsDir = path.join(projectRoot, 'skills')

  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)
  const registry = new CapabilityRegistry(platform)

  try {
    await platform.initialize()
    await registry.initialize()

    const capabilities = registry.list()
    console.log(`✓ 注册了 ${capabilities.length} 个能力`)

    for (const cap of capabilities) {
      console.log(`  - ${cap.name}: ${cap.description}`)
    }

    // 执行 file.read
    const controller = new AbortController()

    // 先创建测试文件
    await platform.executeTool(
      'file-operations',
      'write',
      {
        path: '.test-data/test.txt',
        content: 'Hello from 5-layer architecture!\nLine 2\nLine 3\n'
      },
      controller.signal,
      projectRoot
    )

    // 读取测试文件
    const result = await registry.execute(
      {
        capability: 'file.read',
        args: { path: '.test-data/test.txt' },
        workspace: projectRoot
      },
      controller.signal
    )

    console.log('✓ Capability Registry 测试通过')
    console.log('  file.read 结果:', result.success ? '成功' : '失败')
    if (result.output) {
      console.log('  文件内容预览:', JSON.stringify(result.output).substring(0, 150))
    }

    // 统计信息
    const stats = registry.getStats()
    console.log('\n统计信息:')
    console.log('  总能力数:', stats.total)
    console.log('  按分类:', stats.byCategory)
    console.log('  按运行时:', stats.byRuntime)

    await runtime.stopAll()
    return true

  } catch (error) {
    console.error('✗ Capability Registry 测试失败:', error)
    console.error(error)
    return false
  }
}

async function testEndToEnd() {
  console.log('\n=== Test 4: 端到端测试 ===')

  const dataDir = path.join(projectRoot, '.test-data')
  const skillsDir = path.join(projectRoot, 'skills')

  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)
  const registry = new CapabilityRegistry(platform)

  try {
    // 初始化
    await platform.initialize()
    await registry.initialize()

    const controller = new AbortController()

    // 场景：列出文件 → 读取文件 → 写入文件 → 验证
    console.log('场景 1: 列出文件')
    const listResult = await registry.execute(
      {
        capability: 'file.list',
        args: { path: 'skills', depth: 2 },
        workspace: projectRoot
      },
      controller.signal
    )
    console.log(`  ✓ 找到 ${(listResult.output as any).paths?.length || 0} 个文件`)

    console.log('\n场景 2: 写入测试文件')
    const writeResult = await registry.execute(
      {
        capability: 'file.write',
        args: {
          path: '.test-data/integration-test.txt',
          content: `集成测试
时间: ${new Date().toISOString()}
架构: 5 层架构
组件: Runtime Manager → Skill Platform → Capability Registry
`
        },
        workspace: projectRoot
      },
      controller.signal
    )
    console.log('  ✓ 写入成功:', (writeResult.output as any).bytes, '字节')

    console.log('\n场景 3: 读取测试文件')
    const readResult = await registry.execute(
      {
        capability: 'file.read',
        args: { path: '.test-data/integration-test.txt' },
        workspace: projectRoot
      },
      controller.signal
    )
    console.log('  ✓ 读取成功:', (readResult.output as any).totalLines, '行')
    console.log('  内容预览:')
    const text = (readResult.output as any).text
    console.log(text.split('\n').slice(0, 5).map((l: string) => `    ${l}`).join('\n'))

    console.log('\n✓ 端到端测试通过！')
    console.log('\n性能指标:')
    const stats = runtime.getStats()
    console.log('  总执行次数:', stats.totalExecutions)
    console.log('  平均耗时:', Math.round(stats.averageExecutionTime), 'ms')
    console.log('  错误率:', (stats.errorRate * 100).toFixed(2), '%')

    await runtime.stopAll()
    return true

  } catch (error) {
    console.error('✗ 端到端测试失败:', error)
    console.error(error)
    return false
  }
}

// 运行测试
async function runTests() {
  console.log('🚀 开始集成测试...')
  console.log('项目根目录:', projectRoot)

  const results = {
    runtimeManager: await testRuntimeManager(),
    skillPlatform: await testSkillPlatform(),
    capabilityRegistry: await testCapabilityRegistry(),
    endToEnd: await testEndToEnd()
  }

  console.log('\n' + '='.repeat(50))
  console.log('测试结果汇总:')
  console.log('='.repeat(50))
  console.log('Runtime Manager:', results.runtimeManager ? '✓' : '✗')
  console.log('Skill Platform:', results.skillPlatform ? '✓' : '✗')
  console.log('Capability Registry:', results.capabilityRegistry ? '✓' : '✗')
  console.log('端到端测试:', results.endToEnd ? '✓' : '✗')

  const allPassed = Object.values(results).every(r => r)
  console.log('\n总体结果:', allPassed ? '✓ 全部通过' : '✗ 部分失败')

  process.exit(allPassed ? 0 : 1)
}

runTests().catch(error => {
  console.error('测试运行失败:', error)
  process.exit(1)
})
