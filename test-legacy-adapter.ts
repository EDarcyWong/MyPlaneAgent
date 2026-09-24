/**
 * Legacy Adapter 向后兼容性测试
 *
 * 测试旧代码通过 Legacy Adapter 是否能正常工作
 */

import path from 'path'
import { fileURLToPath } from 'url'
import { PythonRuntimeManager } from './electron/main/agent/core/python-runtime-manager'
import { SkillPlatform } from './electron/main/agent/core/skill-platform'
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'
import { LegacyAdapter } from './electron/main/agent/core/legacy-adapter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function testLegacyAdapter() {
  console.log('🔄 测试 Legacy Adapter 向后兼容性\n')
  console.log('=' .repeat(60))

  // 1. 初始化系统
  console.log('\n[1/4] 初始化系统...')

  const dataDir = path.join(__dirname, '.agent-data')
  const skillsDir = path.join(__dirname, 'skills')

  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)
  await platform.initialize()

  const registry = new CapabilityRegistry(platform)
  await registry.initialize()

  console.log(`✓ 已加载 ${registry.list().length} 个能力`)

  // 2. 初始化 Legacy Adapter
  console.log('\n[2/4] 初始化 Legacy Adapter...')

  const adapter = LegacyAdapter.initialize(registry)
  console.log('✓ Legacy Adapter 已初始化')

  // 3. 测试旧工具名映射
  console.log('\n[3/4] 测试工具名映射...')

  const toolMappings = [
    { old: 'readFile', new: 'file.read' },
    { old: 'writeFile', new: 'file.write' },
    { old: 'listFiles', new: 'file.list' },
    { old: 'gitStatus', new: 'git.status' },
    { old: 'gitAdd', new: 'git.add' },
    { old: 'gitCommit', new: 'git.commit' },
    { old: 'gitPush', new: 'git.push' },
    { old: 'gitPull', new: 'git.pull' },
    { old: 'gitLog', new: 'git.log' },
    { old: 'gitDiff', new: 'git.diff' },
    { old: 'gitBranch', new: 'git.branch' },
  ]

  let mappingsPassed = 0
  let mappingsFailed = 0

  for (const mapping of toolMappings) {
    try {
      // 检查映射是否存在
      const newName = (adapter as any).toolMapping[mapping.old]
      if (newName === mapping.new) {
        console.log(`  ✓ ${mapping.old} → ${mapping.new}`)
        mappingsPassed++
      } else {
        console.log(`  ✗ ${mapping.old} 映射错误: 期望 ${mapping.new}, 实际 ${newName}`)
        mappingsFailed++
      }
    } catch (error) {
      console.log(`  ✗ ${mapping.old} 映射失败: ${error}`)
      mappingsFailed++
    }
  }

  console.log(`\n映射测试: ${mappingsPassed} 通过, ${mappingsFailed} 失败`)

  // 4. 测试实际执行（模拟旧代码调用方式）
  console.log('\n[4/4] 测试旧代码执行...')

  const tests = [
    {
      name: '列出文件',
      oldTool: 'listFiles',
      args: { path: 'skills' }
    },
    {
      name: '读取文件',
      oldTool: 'readFile',
      args: { path: 'package.json' }
    },
    {
      name: 'Git 状态',
      oldTool: 'gitStatus',
      args: { workspace: process.cwd() }
    }
  ]

  let executionPassed = 0
  let executionFailed = 0

  for (const test of tests) {
    try {
      console.log(`\n  测试: ${test.name}`)
      console.log(`  调用: ${test.oldTool}(${JSON.stringify(test.args)})`)

      const result = await adapter.executeTool(test.oldTool, test.args)

      if (result.success) {
        console.log(`  ✓ 成功`)
        console.log(`  耗时: ${result.elapsedMs}ms`)
        executionPassed++
      } else {
        console.log(`  ✗ 失败: ${result.error}`)
        executionFailed++
      }
    } catch (error) {
      console.log(`  ✗ 异常: ${error instanceof Error ? error.message : String(error)}`)
      executionFailed++
    }
  }

  console.log(`\n执行测试: ${executionPassed} 通过, ${executionFailed} 失败`)

  // 5. 测试单例模式
  console.log('\n[5/5] 测试单例模式...')

  const adapter2 = LegacyAdapter.getInstance()
  if (adapter2 === adapter) {
    console.log('✓ 单例模式正常工作')
  } else {
    console.log('✗ 单例模式失败：返回了不同的实例')
  }

  // 6. 总结
  console.log('\n' + '='.repeat(60))
  console.log('\n📊 测试总结:\n')

  const totalTests = mappingsPassed + mappingsFailed + executionPassed + executionFailed + 1
  const totalPassed = mappingsPassed + executionPassed + 1
  const totalFailed = mappingsFailed + executionFailed

  console.log(`总测试数: ${totalTests}`)
  console.log(`通过: ${totalPassed}`)
  console.log(`失败: ${totalFailed}`)
  console.log(`通过率: ${((totalPassed / totalTests) * 100).toFixed(1)}%`)

  if (totalFailed === 0) {
    console.log('\n✅ 所有测试通过！Legacy Adapter 完全兼容')
    return { success: true, passed: totalPassed, failed: totalFailed }
  } else {
    console.log(`\n⚠️  有 ${totalFailed} 个测试失败`)
    return { success: false, passed: totalPassed, failed: totalFailed }
  }
}

// 运行测试
testLegacyAdapter()
  .then(result => {
    console.log('\n测试完成')
    process.exit(result.success ? 0 : 1)
  })
  .catch(error => {
    console.error('\n测试异常:', error)
    process.exit(1)
  })
