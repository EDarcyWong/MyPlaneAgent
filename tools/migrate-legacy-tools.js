#!/usr/bin/env node
/**
 * 迁移传统工具到 Skills 系统
 *
 * 使用方法：
 * node tools/migrate-legacy-tools.js
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// 配置路径
const dataDir = path.join(projectRoot, 'data')
const toolsFile = path.join(dataDir, 'agent-tools.json')
const skillsDir = path.join(dataDir, 'skills')
const migrationLog = path.join(dataDir, 'migration.log')

// 风险等级映射
const riskLabels = {
  read: '只读',
  write: '写入',
  high: '高风险'
}

// 分类映射（根据工具名称推断）
function inferCategory(key) {
  if (key.includes('file') || key.includes('read') || key.includes('write')) return 'file'
  if (key.includes('git') || key.includes('commit')) return 'git'
  if (key.includes('test') || key.includes('diagnostic')) return 'test'
  if (key.includes('http') || key.includes('request')) return 'network'
  if (key.includes('command') || key.includes('run')) return 'system'
  if (key.includes('document') || key.includes('spreadsheet')) return 'document'
  return 'general'
}

// 清理 Python 代码
function cleanPythonCode(code) {
  // 移除 builtin 调用，提取实际实现
  if (code.includes('return builtin(')) {
    return `# 注意：此工具原为内置实现，需要手动补充具体逻辑
def execute(args, context):
    """
    原内置工具，迁移后需要实现具体逻辑
    """
    raise NotImplementedError("此工具需要重新实现")
`
  }
  return code
}

// 生成 Skill
async function generateSkill(tool) {
  const skillName = tool.key
  const skillDir = path.join(skillsDir, skillName)

  console.log(`  创建 Skill: ${skillName}`)

  // 创建目录
  await fs.mkdir(skillDir, { recursive: true })

  const currentVersion = tool.versions.find(v => v.version === tool.activeVersion)
  if (!currentVersion) {
    throw new Error(`工具 ${tool.key} 的当前版本不存在`)
  }

  // 1. 生成 skill.json
  const skillConfig = {
    name: skillName,
    displayName: currentVersion.name || tool.key,
    description: currentVersion.description || '无描述',
    version: `1.0.${tool.activeVersion}`,
    runtime: 'python-native',
    category: inferCategory(tool.key),
    tools: [
      {
        name: tool.key,
        description: currentVersion.description || '无描述',
        inputSchema: currentVersion.parameters
      }
    ],
    metadata: {
      migratedFrom: 'legacy-tool',
      originalBuiltin: tool.builtin,
      migrationDate: new Date().toISOString()
    }
  }

  await fs.writeFile(
    path.join(skillDir, 'skill.json'),
    JSON.stringify(skillConfig, null, 2),
    'utf-8'
  )

  // 2. 生成 index.py
  const pythonCode = cleanPythonCode(currentVersion.python)
  const indexPy = `"""
${currentVersion.name || tool.key}

${currentVersion.description || '无描述'}

迁移自传统工具系统
原工具标识: ${tool.key}
风险等级: ${riskLabels[currentVersion.risk]}
超时设置: ${currentVersion.timeoutMs}ms
"""

${pythonCode}

# 工具映射（SkillPlatform 需要）
TOOLS = {
    '${tool.key}': execute
}
`

  await fs.writeFile(
    path.join(skillDir, 'index.py'),
    indexPy,
    'utf-8'
  )

  // 3. 生成 README.md
  const versionHistory = tool.versions
    .sort((a, b) => b.version - a.version)
    .map(v => `- **v${v.version}** (${new Date(v.createdAt).toLocaleString()})${v.changeNote ? `: ${v.changeNote}` : ''}`)
    .join('\n')

  const readme = `# ${currentVersion.name || tool.key}

${currentVersion.description || '无描述'}

## 基本信息

- **工具标识**: \`${tool.key}\`
- **类型**: ${tool.builtin ? '内置工具' : '自定义工具'}
- **风险等级**: ${riskLabels[currentVersion.risk]}
- **超时设置**: ${currentVersion.timeoutMs}ms
- **当前版本**: v${tool.activeVersion}

## 参数

\`\`\`json
${JSON.stringify(currentVersion.parameters, null, 2)}
\`\`\`

## 版本历史

${versionHistory}

## 迁移说明

本 Skill 由传统工具系统自动迁移而来。

- 迁移时间: ${new Date().toISOString()}
- 原工具 ID: ${tool.id}
- 原工具状态: ${tool.enabled ? '已启用' : '已停用'}

${tool.builtin && currentVersion.python.includes('return builtin(') ? `
## ⚠️ 注意

此工具原为内置实现（依赖 Python 运行时内置函数）。迁移后需要：

1. 手动实现 \`execute(args, context)\` 函数的具体逻辑
2. 参考原内置实现的行为
3. 测试确保功能一致

或者保留为 Legacy Adapter 调用。
` : ''}

## 使用方法

### 通过 Agent 自动调用

\`\`\`typescript
const agent = new AgentCore(registry, modelClient, memory)
const result = await agent.run({
  id: 'task-1',
  description: '使用 ${tool.key} 工具完成任务',
  context: { workspace: '/path/to/workspace' }
}, signal)
\`\`\`

### 直接调用

\`\`\`typescript
const result = await registry.execute(
  '${tool.key}',
  { /* args */ },
  { workspace: '/path/to/workspace' },
  signal
)
\`\`\`
`

  await fs.writeFile(
    path.join(skillDir, 'README.md'),
    readme,
    'utf-8'
  )

  return {
    skillName,
    skillDir,
    version: currentVersion.version
  }
}

// 主函数
async function migrate() {
  console.log('🚀 开始迁移传统工具到 Skills 系统\n')

  const logs = []
  const log = (msg) => {
    console.log(msg)
    logs.push(`[${new Date().toISOString()}] ${msg}`)
  }

  try {
    // 1. 读取传统工具数据
    log('📖 读取传统工具数据...')
    const toolsData = await fs.readFile(toolsFile, 'utf-8')
    const tools = JSON.parse(toolsData)

    log(`   找到 ${tools.length} 个工具`)

    // 2. 创建 skills 目录
    await fs.mkdir(skillsDir, { recursive: true })

    // 3. 统计信息
    const stats = {
      total: tools.length,
      builtin: tools.filter(t => t.builtin).length,
      custom: tools.filter(t => !t.builtin).length,
      enabled: tools.filter(t => t.enabled).length,
      disabled: tools.filter(t => !t.enabled).length,
      migrated: 0,
      failed: 0
    }

    log(`\n📊 工具统计:`)
    log(`   总计: ${stats.total}`)
    log(`   内置: ${stats.builtin}`)
    log(`   自定义: ${stats.custom}`)
    log(`   已启用: ${stats.enabled}`)
    log(`   已停用: ${stats.disabled}`)

    // 4. 迁移每个工具
    log(`\n🔄 开始迁移...\n`)

    const results = []

    for (const tool of tools) {
      // 跳过已归档的工具
      if (tool.archived) {
        log(`  ⏭️  跳过已归档: ${tool.key}`)
        continue
      }

      try {
        const result = await generateSkill(tool)
        stats.migrated++
        results.push({
          success: true,
          tool: tool.key,
          skill: result.skillName,
          builtin: tool.builtin,
          enabled: tool.enabled
        })
        log(`  ✅ 成功: ${tool.key} -> skills/${result.skillName}`)
      } catch (error) {
        stats.failed++
        results.push({
          success: false,
          tool: tool.key,
          error: error.message
        })
        log(`  ❌ 失败: ${tool.key} - ${error.message}`)
      }
    }

    // 5. 生成迁移报告
    log(`\n📝 生成迁移报告...\n`)

    const report = `# 工具迁移报告

迁移时间: ${new Date().toLocaleString()}

## 统计

- 总工具数: ${stats.total}
- 成功迁移: ${stats.migrated}
- 迁移失败: ${stats.failed}
- 内置工具: ${stats.builtin}
- 自定义工具: ${stats.custom}

## 迁移结果

${results.map(r => {
  if (r.success) {
    return `- ✅ **${r.tool}** → \`skills/${r.skill}\` (${r.builtin ? '内置' : '自定义'}, ${r.enabled ? '已启用' : '已停用'})`
  } else {
    return `- ❌ **${r.tool}**: ${r.error}`
  }
}).join('\n')}

## 后续步骤

1. 检查迁移后的 Skills 是否正常工作
2. 对于内置工具（包含 builtin() 调用），需要手动实现具体逻辑
3. 运行测试验证功能一致性
4. 更新文档和配置

## 内置工具需要注意

以下工具原为内置实现，迁移后需要手动补充逻辑：

${results
  .filter(r => r.success && r.builtin)
  .map(r => `- \`${r.skill}\``)
  .join('\n')}

建议保留 Legacy Adapter 作为过渡方案。

## 验证命令

\`\`\`bash
# 测试 Skill Platform
npm run test:skills

# 端到端测试
npm run test:integration
\`\`\`
`

    const reportPath = path.join(dataDir, 'MIGRATION_REPORT.md')
    await fs.writeFile(reportPath, report, 'utf-8')

    log(`✅ 迁移完成！`)
    log(`\n📊 最终统计:`)
    log(`   成功: ${stats.migrated}`)
    log(`   失败: ${stats.failed}`)
    log(`\n📄 报告已保存: ${reportPath}`)

    // 保存日志
    await fs.writeFile(migrationLog, logs.join('\n'), 'utf-8')

  } catch (error) {
    log(`\n❌ 迁移过程出错: ${error.message}`)
    log(error.stack)

    // 保存错误日志
    await fs.writeFile(migrationLog, logs.join('\n'), 'utf-8')

    process.exit(1)
  }
}

// 运行迁移
migrate()
