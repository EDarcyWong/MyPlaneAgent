/**
 * 迁移示例 3: 创建自定义 Skill
 *
 * 展示如何将现有的工具函数封装为 Skill
 */

import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ============================================================
// 场景: 有一个现有的数据处理工具集
// ============================================================

/**
 * 旧代码: 直接用 TypeScript 实现的工具函数
 */
class OldDataTools {
  // CSV 解析
  static parseCSV(content: string): string[][] {
    return content.split('\n').map(line => line.split(','))
  }

  // JSON 格式化
  static formatJSON(data: any): string {
    return JSON.stringify(data, null, 2)
  }

  // 数据验证
  static validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  // 数据统计
  static calculateStats(numbers: number[]): {
    sum: number
    avg: number
    min: number
    max: number
  } {
    return {
      sum: numbers.reduce((a, b) => a + b, 0),
      avg: numbers.reduce((a, b) => a + b, 0) / numbers.length,
      min: Math.min(...numbers),
      max: Math.max(...numbers)
    }
  }
}

// ============================================================
// 迁移步骤
// ============================================================

async function createDataProcessingSkill() {
  console.log('📦 创建自定义 Skill: data-processing')
  console.log('=' .repeat(60))

  const skillDir = path.join(__dirname, '..', 'skills', 'data-processing')

  // 步骤 1: 创建目录
  console.log('\n[1/3] 创建 Skill 目录...')
  try {
    await fs.mkdir(skillDir, { recursive: true })
    console.log(`✓ 目录创建: ${skillDir}`)
  } catch (error) {
    console.log(`✓ 目录已存在`)
  }

  // 步骤 2: 创建 skill.json
  console.log('\n[2/3] 创建 skill.json...')

  const skillJson = {
    name: 'data-processing',
    displayName: '数据处理',
    version: '1.0.0',
    category: 'data',
    runtime: 'python-native',
    entrypoint: 'index.py',
    description: '数据处理工具集：CSV解析、JSON格式化、数据验证和统计',
    tools: [
      {
        name: 'parse_csv',
        description: '解析 CSV 文本为二维数组',
        parameters: [
          {
            name: 'content',
            type: 'string',
            description: 'CSV 文本内容',
            required: true
          },
          {
            name: 'delimiter',
            type: 'string',
            description: '分隔符（默认逗号）',
            required: false
          }
        ]
      },
      {
        name: 'format_json',
        description: '格式化 JSON 数据',
        parameters: [
          {
            name: 'data',
            type: 'object',
            description: '要格式化的数据',
            required: true
          },
          {
            name: 'indent',
            type: 'number',
            description: '缩进空格数（默认2）',
            required: false
          }
        ]
      },
      {
        name: 'validate_email',
        description: '验证邮箱地址格式',
        parameters: [
          {
            name: 'email',
            type: 'string',
            description: '邮箱地址',
            required: true
          }
        ]
      },
      {
        name: 'calculate_stats',
        description: '计算数字数组的统计信息',
        parameters: [
          {
            name: 'numbers',
            type: 'array',
            description: '数字数组',
            required: true
          }
        ]
      }
    ],
    permissions: {
      fileSystem: false,
      network: false,
      process: false
    }
  }

  const skillJsonPath = path.join(skillDir, 'skill.json')
  await fs.writeFile(skillJsonPath, JSON.stringify(skillJson, null, 2))
  console.log(`✓ 文件创建: skill.json`)

  // 步骤 3: 创建 index.py
  console.log('\n[3/3] 创建 index.py...')

  const pythonCode = `#!/usr/bin/env python3
"""
数据处理 Skill
将 TypeScript 工具迁移为 Python Native Skill
"""

import sys
import json
import re

def tool_parse_csv(args):
    """解析 CSV 文本"""
    content = args['content']
    delimiter = args.get('delimiter', ',')

    lines = content.strip().split('\\n')
    rows = [line.split(delimiter) for line in lines]

    return {
        "rows": rows,
        "row_count": len(rows),
        "column_count": len(rows[0]) if rows else 0
    }

def tool_format_json(args):
    """格式化 JSON"""
    data = args['data']
    indent = args.get('indent', 2)

    formatted = json.dumps(data, indent=indent, ensure_ascii=False)

    return {
        "formatted": formatted,
        "length": len(formatted)
    }

def tool_validate_email(args):
    """验证邮箱格式"""
    email = args['email']

    # 简单的邮箱验证正则
    pattern = r'^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
    is_valid = bool(re.match(pattern, email))

    return {
        "email": email,
        "valid": is_valid
    }

def tool_calculate_stats(args):
    """计算统计信息"""
    numbers = args['numbers']

    if not numbers:
        return {"error": "Empty array"}

    total = sum(numbers)
    count = len(numbers)

    return {
        "sum": total,
        "avg": total / count,
        "min": min(numbers),
        "max": max(numbers),
        "count": count
    }

# JSON-RPC 主循环
print("READY", flush=True)

for line in sys.stdin:
    try:
        request = json.loads(line)
        tool = request['params']['tool']
        args = request['params']['args']

        # 路由到对应的工具
        if tool == 'parse_csv':
            result = tool_parse_csv(args)
        elif tool == 'format_json':
            result = tool_format_json(args)
        elif tool == 'validate_email':
            result = tool_validate_email(args)
        elif tool == 'calculate_stats':
            result = tool_calculate_stats(args)
        else:
            result = {"error": f"Unknown tool: {tool}"}

        # 返回结果
        response = {
            "jsonrpc": "2.0",
            "result": result,
            "id": request['id']
        }
        print(json.dumps(response), flush=True)

    except Exception as e:
        # 错误处理
        error_response = {
            "jsonrpc": "2.0",
            "error": {
                "code": -32000,
                "message": str(e)
            },
            "id": request.get('id')
        }
        print(json.dumps(error_response), flush=True)
`

  const indexPyPath = path.join(skillDir, 'index.py')
  await fs.writeFile(indexPyPath, pythonCode)
  console.log(`✓ 文件创建: index.py`)

  // 步骤 4: 创建 README
  console.log('\n[4/4] 创建 README.md...')

  const readme = `# Data Processing Skill

数据处理工具集，从旧的 TypeScript 工具迁移而来。

## 工具列表

### 1. parse_csv
解析 CSV 文本为二维数组

**参数**:
- \`content\`: CSV 文本内容
- \`delimiter\`: 分隔符（可选，默认逗号）

**返回**:
- \`rows\`: 二维数组
- \`row_count\`: 行数
- \`column_count\`: 列数

### 2. format_json
格式化 JSON 数据

**参数**:
- \`data\`: 要格式化的数据
- \`indent\`: 缩进空格数（可选，默认2）

**返回**:
- \`formatted\`: 格式化后的 JSON 字符串
- \`length\`: 字符串长度

### 3. validate_email
验证邮箱地址格式

**参数**:
- \`email\`: 邮箱地址

**返回**:
- \`email\`: 原邮箱
- \`valid\`: 是否有效

### 4. calculate_stats
计算数字数组的统计信息

**参数**:
- \`numbers\`: 数字数组

**返回**:
- \`sum\`: 总和
- \`avg\`: 平均值
- \`min\`: 最小值
- \`max\`: 最大值
- \`count\`: 数量

## 使用示例

\`\`\`typescript
// 解析 CSV
const result = await registry.execute({
  capability: 'data.parse_csv',
  args: { content: 'a,b,c\\n1,2,3' }
})

// 验证邮箱
const validation = await registry.execute({
  capability: 'data.validate_email',
  args: { email: 'test@example.com' }
})

// 计算统计
const stats = await registry.execute({
  capability: 'data.calculate_stats',
  args: { numbers: [1, 2, 3, 4, 5] }
})
\`\`\`

## 迁移说明

原 TypeScript 工具:
- \`OldDataTools.parseCSV()\`
- \`OldDataTools.formatJSON()\`
- \`OldDataTools.validateEmail()\`
- \`OldDataTools.calculateStats()\`

现在统一为 Skill，通过 Capability Registry 调用。
`

  const readmePath = path.join(skillDir, 'README.md')
  await fs.writeFile(readmePath, readme)
  console.log(`✓ 文件创建: README.md`)

  console.log('\n✅ Skill 创建完成！')
  console.log(`\n位置: ${skillDir}`)
  console.log('\n包含文件:')
  console.log('  - skill.json (元数据)')
  console.log('  - index.py (实现)')
  console.log('  - README.md (文档)')

  console.log('\n使用方法:')
  console.log('  1. 重新启动应用或重新加载 Skills')
  console.log('  2. 通过 Capability Registry 调用:')
  console.log('     await registry.execute({')
  console.log('       capability: "data.parse_csv",')
  console.log('       args: { content: "..." }')
  console.log('     })')
}

// ============================================================
// 迁移清单
// ============================================================

function printMigrationChecklist() {
  console.log('\n\n📋 Skill 迁移清单')
  console.log('=' .repeat(60))

  console.log('\n✅ 准备阶段:')
  console.log('  □ 识别要迁移的工具函数')
  console.log('  □ 评估工具的依赖关系')
  console.log('  □ 确定 Skill 的分类（category）')
  console.log('  □ 设计工具的参数和返回值')

  console.log('\n✅ 创建阶段:')
  console.log('  □ 创建 Skill 目录')
  console.log('  □ 编写 skill.json 元数据')
  console.log('  □ 实现 index.py（或其他语言）')
  console.log('  □ 添加错误处理')
  console.log('  □ 编写测试用例')

  console.log('\n✅ 集成阶段:')
  console.log('  □ 重新加载 Skill Platform')
  console.log('  □ 验证 Skill 是否注册成功')
  console.log('  □ 测试每个工具的调用')
  console.log('  □ 更新调用代码')

  console.log('\n✅ 文档阶段:')
  console.log('  □ 编写 README.md')
  console.log('  □ 添加使用示例')
  console.log('  □ 记录迁移映射关系')
  console.log('  □ 更新项目文档')

  console.log('\n💡 最佳实践:')
  console.log('  1. 一个 Skill 包含相关的工具集')
  console.log('  2. 使用清晰的命名（category.tool）')
  console.log('  3. 完整的参数验证和错误处理')
  console.log('  4. 详细的文档和示例')
  console.log('  5. 保持向后兼容（可选）')
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('📚 自定义 Skill 创建示例')
  console.log('=' .repeat(60))

  // 创建示例 Skill
  await createDataProcessingSkill()

  // 显示迁移清单
  printMigrationChecklist()

  console.log('\n\n✅ 示例完成')
  console.log('\n下一步:')
  console.log('  1. 查看生成的 Skill 文件')
  console.log('  2. 根据实际需求修改')
  console.log('  3. 重启应用加载新 Skill')
  console.log('  4. 测试并验证功能')
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('错误:', error)
    process.exit(1)
  })
