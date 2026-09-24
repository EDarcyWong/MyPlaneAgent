# 迁移指南：从旧版 MyPlaneAgent 迁移到新架构

## 概述

本指南帮助你将现有代码从旧的单体架构迁移到新的模块化 5 层架构。

## 主要变化

### 1. 工具调用方式

**旧版 (直接调用)**:
```typescript
import { readFile, writeFile } from './tools/file'
import { gitStatus, gitCommit } from './tools/git'

const content = await readFile('test.txt')
await writeFile('output.txt', content)
const status = await gitStatus()
```

**新版 (通过 Capability Registry)**:
```typescript
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'

const registry = new CapabilityRegistry(skillPlatform, mcpAdapter)
await registry.initialize()

// 执行能力
const result = await registry.execute({
  capability: 'file.read',
  args: { path: 'test.txt' }
})

await registry.execute({
  capability: 'file.write',
  args: { path: 'output.txt', content: result.output.content }
})

const status = await registry.execute({
  capability: 'git.status',
  args: { workspace: process.cwd() }
})
```

### 2. 使用 Legacy Adapter (快速兼容)

如果你有大量旧代码，可以使用 Legacy Adapter 实现快速兼容：

```typescript
import { LegacyAdapter } from './electron/main/agent/core/legacy-adapter'
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'

// 初始化
const registry = new CapabilityRegistry(skillPlatform)
const adapter = LegacyAdapter.initialize(registry)

// 旧代码无需修改，直接调用
const content = await adapter.executeTool('readFile', { path: 'test.txt' })
await adapter.executeTool('writeFile', { path: 'output.txt', content })
```

**映射表**:
| 旧工具名 | 新能力名 |
|---------|---------|
| `readFile` | `file.read` |
| `writeFile` | `file.write` |
| `listFiles` | `file.list` |
| `gitStatus` | `git.status` |
| `gitAdd` | `git.add` |
| `gitCommit` | `git.commit` |
| `gitPush` | `git.push` |
| `gitPull` | `git.pull` |
| `gitLog` | `git.log` |
| `gitDiff` | `git.diff` |
| `gitBranch` | `git.branch` |

### 3. Agent 任务执行

**旧版 (手动编排)**:
```typescript
async function analyzeProject() {
  // 手动分解任务
  const files = await listFiles('src')
  
  // 手动处理每个文件
  for (const file of files) {
    const content = await readFile(file)
    // 分析内容...
  }
  
  // 手动错误处理
  try {
    await gitCommit('Analysis complete')
  } catch (error) {
    console.error('Failed:', error)
    // 手动重试逻辑...
  }
}
```

**新版 (智能 Agent)**:
```typescript
import { AgentCore } from './electron/main/agent/core/agent-core'
import { AgentTask } from './electron/shared/types'

const agent = new AgentCore(registry, modelClient, memory, {
  mode: 'auto',
  maxReplanAttempts: 2
})

const task: AgentTask = {
  id: 'analyze-1',
  description: '分析 src 目录下的所有 TypeScript 文件，统计代码行数，并生成报告',
  context: {
    workspace: process.cwd(),
    userIntent: '代码质量分析'
  },
  createdAt: Date.now()
}

// Agent 自动规划和执行
const result = await agent.run(task)

if (result.success) {
  console.log('分析完成:', result.outputs)
} else {
  console.error('分析失败:', result.errors)
}
```

## 迁移步骤

### 第 1 步：设置基础设施

```typescript
// 1. 初始化 Python Runtime
import { PythonRuntimeManager } from './electron/main/agent/core/python-runtime-manager'

const dataDir = path.join(__dirname, '.agent-data')
const runtime = new PythonRuntimeManager(dataDir, {
  maxWorkers: 8,
  idleTimeout: 300000
})

// 2. 初始化 Skill Platform
import { SkillPlatform } from './electron/main/agent/core/skill-platform'

const skillsDir = path.join(__dirname, 'skills')
const platform = new SkillPlatform(skillsDir, runtime)
await platform.initialize()

// 3. 初始化 MCP Adapter (可选)
import { MCPAdapter } from './electron/main/agent/core/mcp-adapter'

const mcpAdapter = new MCPAdapter()
// 添加需要的 MCP 服务器...

// 4. 初始化 Capability Registry
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'

const registry = new CapabilityRegistry(platform, mcpAdapter)
await registry.initialize()

console.log(`已加载 ${registry.list().length} 个能力`)
```

### 第 2 步：迁移简单工具调用

**迁移前**:
```typescript
// old-code.ts
import { readFile, writeFile } from './tools/file'

export async function copyFile(src: string, dest: string) {
  const content = await readFile(src)
  await writeFile(dest, content)
}
```

**迁移后 (方案 A - Legacy Adapter)**:
```typescript
// new-code-legacy.ts
import { LegacyAdapter } from './electron/main/agent/core/legacy-adapter'

export async function copyFile(src: string, dest: string) {
  const adapter = LegacyAdapter.getInstance()
  const result = await adapter.executeTool('readFile', { path: src })
  await adapter.executeTool('writeFile', { 
    path: dest, 
    content: result.content 
  })
}
```

**迁移后 (方案 B - 直接使用 Registry)**:
```typescript
// new-code-direct.ts
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'

export async function copyFile(
  registry: CapabilityRegistry,
  src: string, 
  dest: string
) {
  const result = await registry.execute({
    capability: 'file.read',
    args: { path: src }
  })
  
  await registry.execute({
    capability: 'file.write',
    args: { path: dest, content: result.output.content }
  })
}
```

### 第 3 步：迁移复杂业务逻辑

**迁移前**:
```typescript
// old-workflow.ts
export async function deployProject() {
  // 1. 检查 git 状态
  const status = await gitStatus()
  if (status.modified.length > 0) {
    throw new Error('有未提交的修改')
  }
  
  // 2. 运行测试
  const testResult = await runTests()
  if (!testResult.success) {
    throw new Error('测试失败')
  }
  
  // 3. 构建项目
  await buildProject()
  
  // 4. 部署
  await deploy()
  
  // 5. 创建 tag
  await gitTag(`v${version}`)
}
```

**迁移后 (使用 Agent)**:
```typescript
// new-workflow.ts
import { AgentCore } from './electron/main/agent/core/agent-core'
import { AgentTask } from './electron/shared/types'

export async function deployProject(
  agent: AgentCore,
  version: string
) {
  const task: AgentTask = {
    id: `deploy-${Date.now()}`,
    description: `
      部署项目 v${version}:
      1. 检查 git 状态，确保没有未提交的修改
      2. 运行测试，确保所有测试通过
      3. 构建项目
      4. 执行部署
      5. 创建 git tag v${version}
    `,
    context: {
      workspace: process.cwd(),
      version,
      userIntent: '部署新版本'
    },
    createdAt: Date.now()
  }
  
  // Agent 自动规划执行步骤，处理错误和重试
  const result = await agent.run(task)
  
  if (!result.success) {
    throw new Error(`部署失败: ${result.errors?.join(', ')}`)
  }
  
  return result
}
```

### 第 4 步：创建自定义 Skill

如果旧代码中有特定的工具或功能，可以将其封装为 Skill。

**例子：将旧的数据库工具迁移为 Skill**

1. 创建 Skill 目录:
```bash
mkdir -p skills/database-operations
```

2. 编写 `skill.json`:
```json
{
  "name": "database-operations",
  "displayName": "数据库操作",
  "version": "1.0.0",
  "category": "database",
  "runtime": "python-native",
  "entrypoint": "index.py",
  "tools": [
    {
      "name": "query",
      "description": "执行 SQL 查询",
      "parameters": [
        {
          "name": "sql",
          "type": "string",
          "description": "SQL 语句",
          "required": true
        },
        {
          "name": "params",
          "type": "object",
          "description": "查询参数",
          "required": false
        }
      ]
    }
  ],
  "permissions": {
    "network": true
  }
}
```

3. 实现 `index.py`:
```python
import sys
import json
import sqlite3

def tool_query(args):
    """执行 SQL 查询"""
    sql = args['sql']
    params = args.get('params', {})
    
    # 连接数据库（简化示例）
    conn = sqlite3.connect('app.db')
    cursor = conn.cursor()
    
    try:
        cursor.execute(sql, params)
        if sql.strip().upper().startswith('SELECT'):
            rows = cursor.fetchall()
            return {"rows": rows, "count": len(rows)}
        else:
            conn.commit()
            return {"affected": cursor.rowcount}
    finally:
        conn.close()

# JSON-RPC 循环
print("READY", flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        method = request['params']['tool']
        args = request['params']['args']
        
        if method == 'query':
            result = tool_query(args)
        else:
            result = {"error": f"Unknown tool: {method}"}
        
        response = {
            "jsonrpc": "2.0",
            "result": result,
            "id": request['id']
        }
        print(json.dumps(response), flush=True)
    except Exception as e:
        error_response = {
            "jsonrpc": "2.0",
            "error": {"code": -32000, "message": str(e)},
            "id": request.get('id')
        }
        print(json.dumps(error_response), flush=True)
```

4. 使用新 Skill:
```typescript
// 自动加载（Skill Platform 会扫描 skills/ 目录）
const result = await registry.execute({
  capability: 'database.query',
  args: {
    sql: 'SELECT * FROM users WHERE active = ?',
    params: { active: true }
  }
})

console.log(`找到 ${result.output.count} 个活跃用户`)
```

### 第 5 步：集成 MCP 服务

如果需要集成外部服务（如 GitHub、Slack 等），使用 MCP Adapter。

```typescript
import { MCPAdapter } from './electron/main/agent/core/mcp-adapter'

const mcpAdapter = new MCPAdapter()

// 添加 GitHub MCP 服务器
await mcpAdapter.addServer({
  id: 'github',
  name: 'GitHub',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN
  }
})

// 使用 GitHub 工具
const result = await registry.execute({
  capability: 'mcp.github.create_issue',
  args: {
    owner: 'myorg',
    repo: 'myrepo',
    title: 'Bug report',
    body: 'Found a bug...'
  }
})
```

## 常见问题

### Q1: 我的旧代码依赖很多同步函数，怎么办？

新架构是异步的。你需要：
1. 将同步调用改为异步: `const result = await registry.execute(...)`
2. 或使用 Legacy Adapter 的同步包装（计划中）

### Q2: 性能会受影响吗？

进程间通信有轻微开销（通常 < 10ms），但带来的好处：
- 更好的隔离性
- 更容易扩展
- 更稳定（单个 Skill 崩溃不影响整体）
- 支持并发执行

### Q3: 如何调试 Skill 执行问题？

1. 查看日志:
```typescript
// 所有组件都有详细日志
[SkillPlatform] Loaded skill: file-operations
[Runtime] Spawning worker for file-operations
[Worker file-operations] Ready
```

2. 直接测试 Skill:
```bash
cd skills/file-operations
python index.py
# 输入 JSON-RPC 请求测试
```

3. 使用事件监听:
```typescript
agent.on(event => {
  if (event.type === 'capability_executed') {
    console.log('执行:', event.capability, event.result)
  }
})
```

### Q4: 可以混用旧代码和新架构吗？

可以！推荐的迁移策略：
1. 保留旧代码不动
2. 使用 Legacy Adapter 包装旧工具
3. 新功能使用新架构开发
4. 逐步将核心功能迁移为 Skill

### Q5: 如何处理需要大量依赖的 Skill？

使用 venv 隔离：

```json
{
  "name": "ml-operations",
  "runtime": "python-native",
  "venv": "./venv",  // 指定 venv 路径
  "requirements": [
    "numpy>=1.24.0",
    "pandas>=2.0.0",
    "scikit-learn>=1.3.0"
  ]
}
```

Runtime Manager 会自动：
1. 检查 venv 是否存在
2. 不存在则创建并安装依赖
3. 使用 venv 中的 Python 运行

## 迁移检查清单

- [ ] 设置基础设施（Runtime, Platform, Registry）
- [ ] 配置环境变量（.env 文件）
- [ ] 识别需要迁移的工具调用
- [ ] 选择迁移策略（Legacy Adapter vs 直接使用 Registry）
- [ ] 迁移简单工具调用
- [ ] 将复杂业务逻辑改为 Agent 任务
- [ ] 创建自定义 Skill（如果需要）
- [ ] 集成 MCP 服务（如果需要）
- [ ] 测试所有迁移的功能
- [ ] 更新文档和注释
- [ ] 移除旧代码（可选）

## 示例：完整迁移案例

### 旧版代码

```typescript
// old-app.ts
import { readFile, writeFile } from './tools/file'
import { gitStatus, gitCommit } from './tools/git'

export async function processFiles(inputDir: string, outputDir: string) {
  // 1. 检查 git 状态
  const status = await gitStatus()
  console.log('Git status:', status)
  
  // 2. 读取所有文件
  const files = await listFiles(inputDir)
  
  // 3. 处理每个文件
  for (const file of files) {
    const content = await readFile(file)
    const processed = content.toUpperCase() // 简单处理
    await writeFile(
      file.replace(inputDir, outputDir),
      processed
    )
  }
  
  // 4. 提交更改
  await gitCommit('Processed files')
  
  return files.length
}
```

### 新版代码（Agent 方式）

```typescript
// new-app.ts
import { AgentCore } from './electron/main/agent/core/agent-core'
import { setupAgent } from './setup-agent'  // 封装初始化逻辑

export async function processFiles(inputDir: string, outputDir: string) {
  // 初始化 Agent（可以复用）
  const agent = await setupAgent()
  
  // 定义任务
  const task = {
    id: `process-${Date.now()}`,
    description: `
      处理文件任务:
      1. 检查 git 状态
      2. 列出 ${inputDir} 目录下的所有文件
      3. 读取每个文件内容，转换为大写
      4. 保存到 ${outputDir} 目录
      5. 提交更改到 git，消息为 "Processed files"
    `,
    context: {
      workspace: process.cwd(),
      inputDir,
      outputDir
    },
    createdAt: Date.now()
  }
  
  // 执行任务
  const result = await agent.run(task)
  
  if (!result.success) {
    throw new Error(`任务失败: ${result.errors?.join(', ')}`)
  }
  
  // 从结果中提取文件数量
  const fileCount = result.outputs.find(
    o => o.capability === 'file.list'
  )?.output?.files?.length || 0
  
  return fileCount
}

// setup-agent.ts
import { PythonRuntimeManager } from './electron/main/agent/core/python-runtime-manager'
import { SkillPlatform } from './electron/main/agent/core/skill-platform'
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'
import { ModelClient } from './electron/main/agent/core/model-client'
import { AgentMemory } from './electron/main/agent/core/agent-memory'
import { AgentCore } from './electron/main/agent/core/agent-core'
import { getModelConfig } from './agent-config'

let cachedAgent: AgentCore | null = null

export async function setupAgent(): Promise<AgentCore> {
  if (cachedAgent) return cachedAgent
  
  const dataDir = path.join(__dirname, '.agent-data')
  const skillsDir = path.join(__dirname, 'skills')
  
  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)
  await platform.initialize()
  
  const registry = new CapabilityRegistry(platform)
  await registry.initialize()
  
  const config = getModelConfig()
  const modelClient = new ModelClient(config)
  const memory = new AgentMemory(dataDir)
  
  cachedAgent = new AgentCore(registry, modelClient, memory, {
    mode: 'auto',
    maxReplanAttempts: 2
  })
  
  return cachedAgent
}
```

## 总结

迁移策略：
1. **快速兼容**: 使用 Legacy Adapter，最小改动
2. **渐进式**: 新功能用新架构，旧功能保持不变
3. **完全重构**: 将所有逻辑迁移到 Agent 和 Skill

选择哪种策略取决于：
- 项目规模
- 时间预算
- 对新特性的需求（如智能规划、自动重试）

建议从核心功能开始，逐步扩展到边缘功能。
