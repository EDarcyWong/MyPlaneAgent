# MyPlaneAgent 使用示例

本文档提供了新架构下的常见使用场景和代码示例。

## 目录

- [基础使用](#基础使用)
- [创建自定义 Skill](#创建自定义-skill)
- [集成 MCP 服务](#集成-mcp-服务)
- [Agent 任务示例](#agent-任务示例)
- [高级用法](#高级用法)

## 基础使用

### 1. 初始化系统

```typescript
import path from 'path'
import { PythonRuntimeManager } from './electron/main/agent/core/python-runtime-manager'
import { SkillPlatform } from './electron/main/agent/core/skill-platform'
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'
import { MCPAdapter } from './electron/main/agent/core/mcp-adapter'
import { ModelClient } from './electron/main/agent/core/model-client'
import { AgentMemory } from './electron/main/agent/core/agent-memory'
import { AgentCore } from './electron/main/agent/core/agent-core'
import { getModelConfig } from './agent-config'

async function initialize() {
  // 1. 配置路径
  const dataDir = path.join(__dirname, '.agent-data')
  const skillsDir = path.join(__dirname, 'skills')

  // 2. 初始化 Python Runtime
  const runtime = new PythonRuntimeManager(dataDir, {
    maxWorkers: 8,
    idleTimeout: 300000  // 5 分钟
  })

  // 3. 初始化 Skill Platform
  const platform = new SkillPlatform(skillsDir, runtime)
  await platform.initialize()
  console.log(`已加载 ${platform.listSkills().length} 个 Skill`)

  // 4. 初始化 MCP Adapter（可选）
  const mcpAdapter = new MCPAdapter()
  
  // 5. 初始化 Capability Registry
  const registry = new CapabilityRegistry(platform, mcpAdapter)
  await registry.initialize()
  console.log(`已注册 ${registry.list().length} 个能力`)

  // 6. 初始化 Model Client
  const config = getModelConfig()
  const modelClient = new ModelClient({
    connection: config.connection,
    model: config.model
  })

  // 7. 初始化 Agent Memory
  const memory = new AgentMemory(dataDir)

  // 8. 初始化 Agent Core
  const agent = new AgentCore(registry, modelClient, memory, {
    mode: 'auto',
    maxReplanAttempts: 2,
    autoApprove: true,
    temperature: 0.2
  })

  return { runtime, platform, registry, mcpAdapter, agent }
}

// 使用
const { agent, registry } = await initialize()
```

### 2. 直接调用能力

```typescript
// 文件操作
const readResult = await registry.execute({
  capability: 'file.read',
  args: { path: 'package.json' }
})
console.log('文件内容:', readResult.output.content)

await registry.execute({
  capability: 'file.write',
  args: {
    path: 'output.txt',
    content: 'Hello, World!'
  }
})

const listResult = await registry.execute({
  capability: 'file.list',
  args: { path: 'src' }
})
console.log('文件列表:', listResult.output.files)

// Git 操作
const statusResult = await registry.execute({
  capability: 'git.status',
  args: { workspace: process.cwd() }
})
console.log('Git 状态:', statusResult.output)

await registry.execute({
  capability: 'git.add',
  args: {
    workspace: process.cwd(),
    files: ['output.txt']
  }
})

await registry.execute({
  capability: 'git.commit',
  args: {
    workspace: process.cwd(),
    message: 'Add output file'
  }
})
```

### 3. 查询可用能力

```typescript
// 列出所有能力
const allCapabilities = registry.list()
console.log(`共 ${allCapabilities.length} 个能力:`)
allCapabilities.forEach(cap => {
  console.log(`- ${cap.name}: ${cap.description}`)
})

// 按类别查询
const fileCapabilities = registry.listByCategory('file')
console.log('文件操作能力:', fileCapabilities.map(c => c.name))

// 查询特定能力
const capability = registry.get('file.read')
console.log('能力详情:', capability)
```

## 创建自定义 Skill

### 示例 1: 文本处理 Skill

**1. 创建目录和 skill.json**

```bash
mkdir -p skills/text-processing
```

```json
{
  "name": "text-processing",
  "displayName": "文本处理",
  "version": "1.0.0",
  "category": "text",
  "runtime": "python-native",
  "entrypoint": "index.py",
  "tools": [
    {
      "name": "count_words",
      "description": "统计文本中的单词数",
      "parameters": [
        {
          "name": "text",
          "type": "string",
          "description": "要统计的文本",
          "required": true
        }
      ]
    },
    {
      "name": "extract_emails",
      "description": "从文本中提取所有邮箱地址",
      "parameters": [
        {
          "name": "text",
          "type": "string",
          "description": "包含邮箱的文本",
          "required": true
        }
      ]
    },
    {
      "name": "summarize",
      "description": "生成文本摘要",
      "parameters": [
        {
          "name": "text",
          "type": "string",
          "description": "要总结的文本",
          "required": true
        },
        {
          "name": "max_length",
          "type": "number",
          "description": "最大长度（字符数）",
          "required": false
        }
      ]
    }
  ],
  "permissions": {
    "fileSystem": false,
    "network": false,
    "process": false
  }
}
```

**2. 实现 index.py**

```python
import sys
import json
import re

def tool_count_words(args):
    """统计单词数"""
    text = args['text']
    words = re.findall(r'\b\w+\b', text)
    return {
        "count": len(words),
        "unique_count": len(set(words)),
        "words": words
    }

def tool_extract_emails(args):
    """提取邮箱地址"""
    text = args['text']
    pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
    emails = re.findall(pattern, text)
    return {
        "emails": list(set(emails)),
        "count": len(set(emails))
    }

def tool_summarize(args):
    """生成摘要（简单实现：取前 N 个字符）"""
    text = args['text']
    max_length = args.get('max_length', 200)
    
    if len(text) <= max_length:
        return {"summary": text}
    
    # 简单截断到最后一个句子
    truncated = text[:max_length]
    last_period = truncated.rfind('.')
    if last_period > 0:
        summary = truncated[:last_period + 1]
    else:
        summary = truncated + "..."
    
    return {"summary": summary}

# JSON-RPC 主循环
print("READY", flush=True)

for line in sys.stdin:
    try:
        request = json.loads(line)
        tool = request['params']['tool']
        args = request['params']['args']
        
        # 路由到对应的工具
        if tool == 'count_words':
            result = tool_count_words(args)
        elif tool == 'extract_emails':
            result = tool_extract_emails(args)
        elif tool == 'summarize':
            result = tool_summarize(args)
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
```

**3. 使用新 Skill**

```typescript
// 重新加载 Skill Platform
await platform.initialize()

// 使用文本处理能力
const wordCount = await registry.execute({
  capability: 'text.count_words',
  args: {
    text: 'Hello world! This is a test. Hello again.'
  }
})
console.log('单词统计:', wordCount.output)
// { count: 8, unique_count: 7, words: [...] }

const emails = await registry.execute({
  capability: 'text.extract_emails',
  args: {
    text: 'Contact us at hello@example.com or support@test.org'
  }
})
console.log('邮箱:', emails.output.emails)
// ['hello@example.com', 'support@test.org']

const summary = await registry.execute({
  capability: 'text.summarize',
  args: {
    text: 'Very long text...',
    max_length: 100
  }
})
console.log('摘要:', summary.output.summary)
```

### 示例 2: HTTP 请求 Skill

```json
{
  "name": "http-client",
  "displayName": "HTTP 客户端",
  "version": "1.0.0",
  "category": "network",
  "runtime": "python-native",
  "entrypoint": "index.py",
  "tools": [
    {
      "name": "get",
      "description": "发送 GET 请求",
      "parameters": [
        {
          "name": "url",
          "type": "string",
          "required": true
        },
        {
          "name": "headers",
          "type": "object",
          "required": false
        }
      ]
    },
    {
      "name": "post",
      "description": "发送 POST 请求",
      "parameters": [
        {
          "name": "url",
          "type": "string",
          "required": true
        },
        {
          "name": "data",
          "type": "object",
          "required": false
        },
        {
          "name": "headers",
          "type": "object",
          "required": false
        }
      ]
    }
  ],
  "permissions": {
    "network": true
  },
  "requirements": [
    "requests>=2.31.0"
  ]
}
```

```python
import sys
import json
import requests

def tool_get(args):
    url = args['url']
    headers = args.get('headers', {})
    
    response = requests.get(url, headers=headers, timeout=30)
    return {
        "status": response.status_code,
        "headers": dict(response.headers),
        "body": response.text
    }

def tool_post(args):
    url = args['url']
    data = args.get('data', {})
    headers = args.get('headers', {})
    
    response = requests.post(url, json=data, headers=headers, timeout=30)
    return {
        "status": response.status_code,
        "headers": dict(response.headers),
        "body": response.text
    }

# JSON-RPC 主循环
print("READY", flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        tool = request['params']['tool']
        args = request['params']['args']
        
        if tool == 'get':
            result = tool_get(args)
        elif tool == 'post':
            result = tool_post(args)
        else:
            result = {"error": f"Unknown tool: {tool}"}
        
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

## 集成 MCP 服务

### 示例 1: GitHub 集成

```typescript
import { MCPAdapter } from './electron/main/agent/core/mcp-adapter'

// 添加 GitHub MCP 服务器
await mcpAdapter.addServer({
  id: 'github',
  name: 'GitHub MCP Server',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN
  }
})

// 重新初始化 Registry 以加载 MCP 能力
await registry.initialize()

// 使用 GitHub 能力
const issues = await registry.execute({
  capability: 'mcp.github.list_issues',
  args: {
    owner: 'myorg',
    repo: 'myrepo',
    state: 'open'
  }
})

await registry.execute({
  capability: 'mcp.github.create_issue',
  args: {
    owner: 'myorg',
    repo: 'myrepo',
    title: 'Bug: Something is broken',
    body: 'Detailed description...',
    labels: ['bug', 'high-priority']
  }
})
```

### 示例 2: Slack 集成

```typescript
await mcpAdapter.addServer({
  id: 'slack',
  name: 'Slack MCP Server',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-slack'],
  env: {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN
  }
})

// 发送消息
await registry.execute({
  capability: 'mcp.slack.post_message',
  args: {
    channel: '#general',
    text: 'Hello from MyPlaneAgent!',
    thread_ts: undefined  // 可选：回复某条消息
  }
})

// 列出频道
const channels = await registry.execute({
  capability: 'mcp.slack.list_channels',
  args: {}
})
```

## Agent 任务示例

### 示例 1: 代码分析任务

```typescript
import { AgentTask } from './electron/shared/types'

const task: AgentTask = {
  id: 'analyze-code-1',
  description: `
    分析项目代码:
    1. 列出 src/ 目录下的所有 .ts 文件
    2. 统计每个文件的行数
    3. 查找包含 TODO 注释的文件
    4. 生成分析报告并保存到 code-report.txt
  `,
  context: {
    workspace: process.cwd(),
    userIntent: '代码质量检查'
  },
  createdAt: Date.now()
}

// 监听执行事件
agent.on(event => {
  if (event.type === 'plan_created') {
    console.log('执行计划:')
    event.plan?.steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step.capability}`)
    })
  } else if (event.type === 'execution_completed') {
    console.log('执行完成!')
  }
})

const result = await agent.run(task)

if (result.success) {
  console.log('分析报告已生成')
  console.log('结果:', result.outputs[result.outputs.length - 1])
} else {
  console.error('分析失败:', result.errors)
}
```

### 示例 2: 自动化部署任务

```typescript
const deployTask: AgentTask = {
  id: `deploy-${Date.now()}`,
  description: `
    部署应用到生产环境:
    1. 检查 git 状态，确保没有未提交的修改
    2. 拉取最新代码 (git pull)
    3. 检查是否有新的 commits
    4. 如果有更新，执行以下步骤:
       a. 运行测试 (npm test)
       b. 构建项目 (npm run build)
       c. 创建备份
       d. 部署到服务器
       e. 创建 git tag: v${version}
       f. 发送 Slack 通知到 #deployments 频道
    5. 如果没有更新，跳过部署
  `,
  context: {
    workspace: '/path/to/project',
    version: '1.2.3',
    environment: 'production'
  },
  createdAt: Date.now()
}

const result = await agent.run(deployTask)
```

### 示例 3: 数据迁移任务

```typescript
const migrationTask: AgentTask = {
  id: 'migrate-data-1',
  description: `
    数据迁移任务:
    1. 从旧数据库读取所有用户数据
    2. 转换数据格式（字段名映射）
    3. 验证数据完整性
    4. 批量写入新数据库
    5. 生成迁移报告（成功/失败记录）
    6. 发送报告邮件给管理员
  `,
  context: {
    workspace: process.cwd(),
    oldDb: 'mysql://old-host/db',
    newDb: 'postgresql://new-host/db',
    batchSize: 1000
  },
  createdAt: Date.now()
}

const result = await agent.run(migrationTask)
```

## 高级用法

### 1. 并发执行多个能力

```typescript
// 使用 Promise.all 并发执行
const [file1, file2, status] = await Promise.all([
  registry.execute({
    capability: 'file.read',
    args: { path: 'file1.txt' }
  }),
  registry.execute({
    capability: 'file.read',
    args: { path: 'file2.txt' }
  }),
  registry.execute({
    capability: 'git.status',
    args: { workspace: process.cwd() }
  })
])

console.log('File 1:', file1.output.content)
console.log('File 2:', file2.output.content)
console.log('Git Status:', status.output)
```

### 2. 错误处理和重试

```typescript
async function executeWithRetry(
  registry: CapabilityRegistry,
  request: any,
  maxRetries = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await registry.execute(request)
      if (result.success) {
        return result
      }
    } catch (error) {
      console.error(`尝试 ${attempt} 失败:`, error)
      if (attempt === maxRetries) {
        throw error
      }
      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }
}

const result = await executeWithRetry(registry, {
  capability: 'network.get',
  args: { url: 'https://api.example.com/data' }
})
```

### 3. 条件执行

```typescript
// 根据条件执行不同的能力
const status = await registry.execute({
  capability: 'git.status',
  args: { workspace: process.cwd() }
})

if (status.output.modified.length > 0) {
  console.log('有未提交的修改，先提交...')
  
  await registry.execute({
    capability: 'git.add',
    args: { workspace: process.cwd(), files: ['.'] }
  })
  
  await registry.execute({
    capability: 'git.commit',
    args: {
      workspace: process.cwd(),
      message: 'Auto-commit before deploy'
    }
  })
} else {
  console.log('工作区干净，可以继续')
}
```

### 4. 管道式处理

```typescript
// 读取 → 处理 → 保存
const fileContent = await registry.execute({
  capability: 'file.read',
  args: { path: 'input.txt' }
})

const wordCount = await registry.execute({
  capability: 'text.count_words',
  args: { text: fileContent.output.content }
})

const report = `
文件: input.txt
单词数: ${wordCount.output.count}
唯一单词数: ${wordCount.output.unique_count}
`

await registry.execute({
  capability: 'file.write',
  args: {
    path: 'report.txt',
    content: report
  }
})
```

### 5. 自定义事件处理

```typescript
// 监听所有事件
agent.on(event => {
  switch (event.type) {
    case 'planning_started':
      console.log('🧠 开始思考...')
      break
    case 'plan_created':
      console.log('📋 计划已生成')
      break
    case 'execution_started':
      console.log('⚡ 开始执行')
      break
    case 'replanning_started':
      console.log('🔄 重新规划:', event.reason)
      break
    case 'task_completed':
      console.log('✅ 任务完成')
      break
    case 'task_failed':
      console.error('❌ 任务失败:', event.error)
      break
  }
})

// 记录执行统计
let executionCount = 0
let totalTime = 0

agent.on(event => {
  if (event.type === 'capability_executed') {
    executionCount++
    totalTime += event.result?.elapsedMs || 0
    console.log(`执行统计: ${executionCount} 次, 平均 ${totalTime / executionCount}ms`)
  }
})
```

### 6. 内存查询和学习

```typescript
import { AgentMemory } from './electron/main/agent/core/agent-memory'

const memory = new AgentMemory(dataDir)

// 查询历史记录
const similar = await memory.query('文件分析任务', 5)
console.log('找到相似任务:', similar.length)

similar.forEach(entry => {
  console.log(`- ${entry.description}`)
  console.log(`  步骤数: ${entry.plan.steps.length}`)
  console.log(`  耗时: ${entry.elapsedMs}ms`)
})

// 从成功任务中学习
if (result.success) {
  await memory.learnFromSuccess(task, result.plan, result.elapsedMs)
  console.log('已保存成功经验')
}

// 获取统计信息
const stats = memory.getStats()
console.log('记忆统计:')
console.log(`- 总记录: ${stats.total}`)
console.log(`- 成功率: ${(stats.successRate * 100).toFixed(1)}%`)
console.log(`- 平均步骤数: ${stats.averageSteps.toFixed(1)}`)
console.log(`- 平均耗时: ${stats.averageTime}ms`)
```

### 7. 测试和模拟

```typescript
// 使用 Mock Model Client 进行测试
import { MockModelClient } from './mock-model-client'

const mockClient = new MockModelClient({ connection: {}, model: 'mock' })
const testAgent = new AgentCore(registry, mockClient, memory, {
  mode: 'auto',
  maxReplanAttempts: 1
})

// 测试任务
const testTask: AgentTask = {
  id: 'test-1',
  description: '测试任务：列出文件',
  context: { workspace: process.cwd() },
  createdAt: Date.now()
}

const result = await testAgent.run(testTask)
expect(result.success).toBe(true)
```

## 完整示例：构建 CI/CD 工作流

```typescript
import { setupAgent } from './setup-agent'

async function cicdWorkflow(branch: string = 'main') {
  const { agent } = await setupAgent()
  
  const task = {
    id: `cicd-${Date.now()}`,
    description: `
      持续集成/部署流程:
      
      阶段 1: 准备
      1. 检查 git 状态
      2. 切换到 ${branch} 分支
      3. 拉取最新代码
      
      阶段 2: 测试
      4. 运行单元测试
      5. 运行集成测试
      6. 生成测试覆盖率报告
      
      阶段 3: 构建
      7. 清理旧的构建产物
      8. 执行生产构建
      9. 验证构建产物
      
      阶段 4: 部署
      10. 创建版本标签
      11. 推送到远程仓库
      12. 触发部署脚本
      
      阶段 5: 通知
      13. 发送 Slack 通知到 #deployments
      14. 创建 GitHub Release
      15. 更新文档站点
    `,
    context: {
      workspace: process.cwd(),
      branch,
      environment: 'production'
    },
    createdAt: Date.now()
  }
  
  // 监听进度
  let currentStage = ''
  agent.on(event => {
    if (event.type === 'plan_created') {
      console.log('\n📋 执行计划:')
      event.plan?.steps.forEach((step, i) => {
        console.log(`  ${i + 1}. ${step.capability}`)
      })
    } else if (event.type === 'capability_executed') {
      console.log(`✓ ${event.capability}`)
    }
  })
  
  // 执行工作流
  console.log('🚀 开始 CI/CD 流程...\n')
  const result = await agent.run(task)
  
  if (result.success) {
    console.log('\n✅ CI/CD 流程完成!')
    return true
  } else {
    console.error('\n❌ CI/CD 流程失败:', result.errors)
    return false
  }
}

// 运行
cicdWorkflow('main')
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('崩溃:', error)
    process.exit(1)
  })
```

## 总结

这些示例展示了新架构的核心用法：

1. **直接调用能力**: 适合简单、确定性的任务
2. **创建 Skill**: 封装可复用的功能
3. **集成 MCP**: 连接外部服务
4. **使用 Agent**: 处理复杂、需要智能规划的任务

选择哪种方式取决于：
- 任务复杂度
- 是否需要智能规划
- 是否需要自动错误恢复
- 是否需要记忆和学习

更多信息请参考：
- [架构文档](./ARCHITECTURE.md)
- [迁移指南](./MIGRATION.md)
