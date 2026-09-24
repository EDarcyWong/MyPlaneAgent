# 快速开始指南

5 分钟上手 MyPlaneAgent！

## 第 1 步：安装依赖

```bash
npm install
```

## 第 2 步：运行第一个测试

不需要任何配置，直接运行：

```bash
npx tsx test-e2e-real.ts
```

你将看到：

```
🚀 开始端到端真实测试...

=== 步骤 1: 配置大模型 ===
✓ 使用 Mock Model Client（测试模式）

=== 步骤 2: 初始化基础设施 ===
✓ Skill Platform 初始化完成
✓ MCP Adapter 初始化完成
✓ Capability Registry 初始化完成
  - 总能力数: 13

=== 步骤 3: 初始化 Agent Core ===
✓ Model Client 初始化完成
✓ Agent Memory 初始化完成
✓ Agent Core 初始化完成

=== 步骤 4: 执行测试任务 ===
任务: 列出 skills 目录下的所有文件，统计总共有多少个 Skill

📋 开始规划...
✓ 计划生成: 2 个步骤
⚡ 开始执行...
✓ 执行完成 (35ms)

=== 步骤 5: 验证结果 ===
状态: ✓ 成功

==================================================
✓ 端到端测试通过！
==================================================
```

## 第 3 步：配置真实 AI 模型（可选）

如果想使用真实的 AI 模型，创建 `.env` 文件：

### 选项 A: 使用 OpenAI

```bash
# .env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o
```

### 选项 B: 使用本地 Ollama

1. 安装 Ollama: https://ollama.ai/
2. 下载模型: `ollama pull qwen2.5:14b`
3. 配置环境变量:

```bash
# .env
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_BASE_URL=http://localhost:11434
```

## 第 4 步：编写第一个程序

创建 `my-first-agent.ts`:

```typescript
import path from 'path'
import { PythonRuntimeManager } from './electron/main/agent/core/python-runtime-manager'
import { SkillPlatform } from './electron/main/agent/core/skill-platform'
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'
import { ModelClient } from './electron/main/agent/core/model-client'
import { AgentMemory } from './electron/main/agent/core/agent-memory'
import { AgentCore } from './electron/main/agent/core/agent-core'
import { getModelConfig } from './agent-config'

async function main() {
  // 1. 初始化系统
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

  const agent = new AgentCore(registry, modelClient, memory, {
    mode: 'auto',
    maxReplanAttempts: 2
  })

  // 2. 定义任务
  const task = {
    id: 'my-first-task',
    description: '读取 package.json 文件并告诉我项目名称',
    context: {
      workspace: process.cwd()
    },
    createdAt: Date.now()
  }

  // 3. 执行任务
  console.log('开始执行任务...\n')
  
  agent.on(event => {
    if (event.type === 'plan_created') {
      console.log('执行计划:')
      event.plan?.steps.forEach((step, i) => {
        console.log(`  ${i + 1}. ${step.capability}`)
      })
      console.log('')
    }
  })

  const result = await agent.run(task)

  // 4. 查看结果
  if (result.success) {
    console.log('✅ 任务完成！')
    console.log('结果:', result.outputs[result.outputs.length - 1])
  } else {
    console.error('❌ 任务失败:', result.errors)
  }
}

main().catch(console.error)
```

运行：

```bash
npx tsx my-first-agent.ts
```

## 第 5 步：直接调用能力

如果不需要智能规划，可以直接调用能力：

```typescript
import { CapabilityRegistry } from './electron/main/agent/core/capability-registry'
// ... 初始化代码同上 ...

// 读取文件
const result = await registry.execute({
  capability: 'file.read',
  args: { path: 'package.json' }
})
console.log('文件内容:', result.output.content)

// Git 状态
const status = await registry.execute({
  capability: 'git.status',
  args: { workspace: process.cwd() }
})
console.log('Git 状态:', status.output)
```

## 第 6 步：创建自己的 Skill

1. 创建目录:

```bash
mkdir -p skills/hello-world
```

2. 创建 `skills/hello-world/skill.json`:

```json
{
  "name": "hello-world",
  "displayName": "Hello World",
  "version": "1.0.0",
  "category": "demo",
  "runtime": "python-native",
  "entrypoint": "index.py",
  "tools": [
    {
      "name": "greet",
      "description": "向某人打招呼",
      "parameters": [
        {
          "name": "name",
          "type": "string",
          "required": true
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

3. 创建 `skills/hello-world/index.py`:

```python
import sys
import json

def tool_greet(args):
    name = args['name']
    return {"message": f"Hello, {name}!"}

# JSON-RPC 主循环
print("READY", flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        tool = request['params']['tool']
        args = request['params']['args']
        
        if tool == 'greet':
            result = tool_greet(args)
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

4. 使用新 Skill:

```typescript
// 重新初始化以加载新 Skill
await platform.initialize()

// 调用
const result = await registry.execute({
  capability: 'demo.greet',
  args: { name: 'World' }
})
console.log(result.output.message)  // "Hello, World!"
```

## 常见任务示例

### 任务 1: 分析代码

```typescript
const task = {
  id: 'analyze-code',
  description: '分析 src 目录，统计 TypeScript 文件数量和总行数',
  context: { workspace: process.cwd() },
  createdAt: Date.now()
}

const result = await agent.run(task)
```

### 任务 2: Git 工作流

```typescript
const task = {
  id: 'git-workflow',
  description: `
    Git 工作流:
    1. 检查当前 git 状态
    2. 如果有修改，添加所有文件并提交
    3. 推送到远程仓库
  `,
  context: { workspace: process.cwd() },
  createdAt: Date.now()
}

const result = await agent.run(task)
```

### 任务 3: 文件批处理

```typescript
const task = {
  id: 'batch-process',
  description: `
    批量处理文件:
    1. 列出 docs 目录下的所有 .md 文件
    2. 读取每个文件
    3. 统计总字数
    4. 生成报告并保存到 report.txt
  `,
  context: { workspace: process.cwd() },
  createdAt: Date.now()
}

const result = await agent.run(task)
```

## 下一步

- 📚 阅读 [架构文档](./docs/ARCHITECTURE.md) 了解系统设计
- 📖 查看 [完整示例](./docs/EXAMPLES.md) 学习高级用法
- 🔧 参考 [迁移指南](./docs/MIGRATION.md) 迁移现有代码

## 获取帮助

- 查看文档: `docs/` 目录
- 运行测试: `npx tsx test-*.ts`
- 查看示例: Skills 在 `skills/` 目录

## 提示

- 💡 开发时使用 Mock Model Client（无需 API key）
- 💡 生产环境使用真实 AI 模型
- 💡 从简单任务开始，逐步尝试复杂场景
- 💡 利用事件监听了解执行过程

祝你使用愉快！ 🚀
