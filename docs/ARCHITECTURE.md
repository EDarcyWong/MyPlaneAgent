# MyPlaneAgent 架构文档

## 概述

MyPlaneAgent 采用模块化的 5 层架构，从单体应用转变为可扩展的智能 Agent 系统。

## 架构层次

```
┌─────────────────────────────────────────┐
│         Agent Core (核心层)              │
│  - 任务规划 (Planner)                    │
│  - 执行引擎 (Executor)                   │
│  - 记忆管理 (Memory)                     │
│  - 模型客户端 (Model Client)             │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│    Capability Registry (能力注册表)      │
│  - 统一接口                              │
│  - 能力路由                              │
│  - 权限检查                              │
└─────────────────────────────────────────┘
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
┌──────────────────┐  ┌──────────────────┐
│  Skill Platform  │  │   MCP Adapter    │
│  - Skill 加载    │  │  - MCP 服务管理  │
│  - 工具执行      │  │  - 工具调用      │
└──────────────────┘  └──────────────────┘
        ↓                       ↓
┌──────────────────┐  ┌──────────────────┐
│ Python Runtime   │  │   MCP Servers    │
│  - 进程池        │  │  - 外部服务      │
│  - JSON-RPC      │  │  - 标准协议      │
└──────────────────┘  └──────────────────┘
        ↓
┌──────────────────┐
│ Python Workers   │
│  - Skill 实现    │
│  - 隔离执行      │
└──────────────────┘
```

## 核心组件

### 1. Agent Core (核心层)

**职责**: 智能任务编排和执行

**主要模块**:

- **AgentCore** (`agent-core.ts`): 主控制器，实现 plan → execute → replan 循环
  - 状态管理: idle/planning/executing/replanning/error
  - 事件系统: 12 种事件类型
  - 失败重试: 最多 3 次重新规划

- **AgentPlanner** (`agent-planner.ts`): LLM 驱动的任务规划
  - 将用户任务分解为执行步骤
  - 生成 JSON 格式的执行计划
  - 验证依赖关系和循环引用
  - 失败后自动重新规划

- **AgentExecutor** (`agent-executor.ts`): 顺序执行计划步骤
  - 检查步骤依赖 (dependsOn)
  - 支持可选步骤 (optional)
  - 返回详细的执行结果

- **AgentMemory** (`agent-memory.ts`): 短期记忆管理
  - 存储最近 100 条执行记录
  - 持久化到 agent-memory.json
  - 为规划器提供历史成功案例

- **ModelClient** (`model-client.ts`): 大模型客户端适配器
  - 支持 OpenAI、Anthropic、DeepSeek、Ollama
  - 重试机制 (最多 3 次)
  - 统一的消息接口

### 2. Capability Registry (能力注册表)

**职责**: 统一的能力管理和路由

**位置**: `electron/main/agent/core/capability-registry.ts`

**功能**:
- 从 Skill Platform 和 MCP Adapter 收集所有能力
- 提供统一的 `execute()` 接口
- 根据 runtime 类型路由到正确的执行器:
  - `python-native` → Skill Platform
  - `mcp` → MCP Adapter
  - `builtin` → 内置功能

**能力格式**:
```typescript
interface Capability {
  name: string              // 唯一标识，如 "file.read" 或 "mcp.example.echo"
  category: string          // 类别，如 "file", "git"
  description: string       // 功能描述
  parameters: ParameterDef[]
  runtime: 'python-native' | 'mcp' | 'builtin'
}
```

### 3. Skill Platform (技能平台)

**职责**: Python Native Skill 的管理和执行

**位置**: `electron/main/agent/core/skill-platform.ts`

**流程**:
1. **初始化**: 扫描 `skills/` 目录
2. **加载**: 读取每个 Skill 的 `skill.json`
3. **验证**: 检查必需字段和权限声明
4. **注册**: 将 Skill 的工具注册为 Capability
5. **执行**: 通过 Python Runtime Manager 调用 Skill

**Skill 结构**:
```
skills/
├── file-operations/
│   ├── skill.json          # 元数据
│   └── index.py            # 实现
└── git-operations/
    ├── skill.json
    └── index.py
```

**skill.json 格式**:
```json
{
  "name": "file-operations",
  "displayName": "文件处理",
  "version": "1.0.0",
  "category": "file",
  "runtime": "python-native",
  "entrypoint": "index.py",
  "tools": [
    {
      "name": "read",
      "description": "读取文件内容",
      "parameters": [
        {
          "name": "path",
          "type": "string",
          "required": true
        }
      ]
    }
  ],
  "permissions": {
    "fileSystem": ["read", "write"],
    "network": false,
    "process": false
  }
}
```

### 4. Python Runtime Manager (Python 运行时)

**职责**: 管理 Python 进程池和 JSON-RPC 通信

**位置**: `electron/main/agent/core/python-runtime-manager.ts`

**特性**:
- **进程池**: 最多 8 个 Worker 并发
- **进程复用**: Worker 可以执行多个请求
- **空闲超时**: 5 分钟无活动后清理
- **venv 隔离**: 支持 Skill 独立依赖
- **JSON-RPC**: 标准化的进程间通信

**通信协议**:
```
Node.js → Python:
{
  "jsonrpc": "2.0",
  "method": "execute",
  "params": {
    "tool": "read",
    "args": { "path": "test.txt" }
  },
  "id": 1
}

Python → Node.js:
{
  "jsonrpc": "2.0",
  "result": { "content": "file content" },
  "id": 1
}
```

### 5. MCP Adapter (MCP 适配器)

**职责**: 集成外部 MCP 服务

**位置**: 
- `electron/main/agent/core/mcp-adapter.ts` (适配器)
- `electron/main/agent/core/mcp-client.ts` (客户端)

**功能**:
- 管理多个 MCP 服务器连接
- 将 MCP 工具转换为 Capability
- 处理 MCP 协议的初始化和工具调用
- 能力命名: `mcp.{serverId}.{toolName}`

**添加 MCP 服务器**:
```typescript
await mcpAdapter.addServer({
  id: 'github',
  name: 'GitHub MCP Server',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github']
})
```

### 6. Legacy Adapter (兼容层)

**职责**: 向后兼容旧代码

**位置**: `electron/main/agent/core/legacy-adapter.ts`

**映射表**:
```typescript
{
  'readFile' → 'file.read',
  'writeFile' → 'file.write',
  'listFiles' → 'file.list',
  'gitStatus' → 'git.status',
  ...
}
```

## 执行流程

### 完整任务执行流程

```
用户任务
   ↓
[AgentCore.run()]
   ↓
1. Planning (规划阶段)
   ├─ AgentPlanner.plan()
   ├─ 调用 ModelClient.complete()
   ├─ LLM 生成执行计划 (JSON)
   ├─ 解析和验证计划
   └─ 返回 AgentPlan
   ↓
2. Execution (执行阶段)
   ├─ AgentExecutor.execute()
   ├─ 遍历每个步骤
   │   ├─ 检查依赖 (dependsOn)
   │   ├─ CapabilityRegistry.execute()
   │   │   ├─ 判断 runtime 类型
   │   │   ├─ python-native → SkillPlatform.executeTool()
   │   │   │   └─ PythonRuntimeManager.execute()
   │   │   │       └─ JSON-RPC → Python Worker
   │   │   └─ mcp → MCPAdapter.execute()
   │   │       └─ MCPClient.callTool()
   │   └─ 收集结果
   └─ 返回 ExecutionResult
   ↓
3. Check Result (检查结果)
   ├─ 成功 → 记录到 Memory → 返回
   └─ 失败 → Replan (重新规划)
       ├─ AgentPlanner.replan()
       ├─ 分析失败原因
       ├─ 生成新计划
       └─ 返回步骤 2 (最多重试 3 次)
```

## 数据流

### Skill 执行流程

```
Capability Request
{ name: "file.read", args: { path: "test.txt" } }
   ↓
CapabilityRegistry.execute()
   ↓
SkillPlatform.executeTool("file.read", args)
   ↓
PythonRuntimeManager.execute({
  skillName: "file-operations",
  toolName: "read",
  args: { path: "test.txt" }
})
   ↓
[分配或创建 Worker]
   ↓
JSON-RPC over stdin/stdout
   ↓
Python Worker (index.py)
   ├─ 解析请求
   ├─ 调用 tool_read()
   ├─ 读取文件
   └─ 返回结果
   ↓
Worker Pool
   ↓
Result { success: true, output: "content..." }
```

### MCP 工具执行流程

```
Capability Request
{ name: "mcp.github.create_issue", args: {...} }
   ↓
CapabilityRegistry.execute()
   ↓
MCPAdapter.execute()
   ↓
MCPClient.callTool("create_issue", args)
   ↓
JSON-RPC over stdio
   ↓
MCP Server (外部进程)
   ├─ 处理请求
   ├─ 调用 GitHub API
   └─ 返回结果
   ↓
Result
```

## 关键设计决策

### 1. 为什么使用 JSON-RPC？

- **标准化**: 行业标准协议，MCP 也使用它
- **语言无关**: 支持任何语言实现 Skill
- **简单**: 只需 stdin/stdout，无需网络
- **调试友好**: 纯文本，易于日志记录

### 2. 为什么使用进程池？

- **隔离**: 每个 Skill 在独立进程中运行
- **性能**: 避免频繁启动 Python 解释器
- **资源管理**: 控制并发数量和内存使用
- **容错**: 单个 Worker 崩溃不影响其他

### 3. 为什么需要 Capability Registry？

- **统一接口**: Agent Core 只需知道能力名称，不关心实现
- **灵活路由**: 轻松添加新的 runtime 类型
- **权限控制**: 集中管理能力访问
- **可测试性**: 可以 mock 整个 Registry

### 4. 为什么分离 Planner 和 Executor？

- **关注点分离**: 规划是 LLM 的工作，执行是确定性的
- **可测试性**: 可以用固定计划测试执行器
- **重用性**: 同一个计划可以重试执行
- **调试**: 可以查看和验证生成的计划

## 配置和部署

### 环境变量

创建 `.env` 文件:

```bash
# 选择模型提供商
AI_PROVIDER=openai              # openai, anthropic, deepseek, ollama

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=https://api.openai.com/v1

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# DeepSeek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# Ollama (本地)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b
```

### Agent 配置

```typescript
const agent = new AgentCore(
  registry,
  modelClient,
  memory,
  {
    mode: 'auto',              // 'auto' | 'manual' | 'supervised'
    maxReplanAttempts: 2,      // 最多重试次数
    autoApprove: false,        // 是否自动执行
    temperature: 0.2           // LLM 温度参数
  }
)
```

## 扩展指南

### 添加新的 Python Skill

1. 创建目录: `skills/my-skill/`
2. 编写 `skill.json`:
```json
{
  "name": "my-skill",
  "displayName": "My Skill",
  "version": "1.0.0",
  "category": "custom",
  "runtime": "python-native",
  "entrypoint": "index.py",
  "tools": [
    {
      "name": "do_something",
      "description": "Do something useful",
      "parameters": [...]
    }
  ]
}
```

3. 实现 `index.py`:
```python
import sys
import json

def tool_do_something(args):
    # 实现逻辑
    return {"result": "success"}

# JSON-RPC 处理循环
print("READY", flush=True)
for line in sys.stdin:
    request = json.loads(line)
    tool = request['params']['tool']
    args = request['params']['args']
    
    if tool == 'do_something':
        result = tool_do_something(args)
    
    response = {
        "jsonrpc": "2.0",
        "result": result,
        "id": request['id']
    }
    print(json.dumps(response), flush=True)
```

### 添加新的 MCP 服务器

```typescript
await mcpAdapter.addServer({
  id: 'my-service',
  name: 'My Service',
  command: 'node',
  args: ['path/to/mcp-server.js'],
  env: {
    API_KEY: process.env.MY_SERVICE_API_KEY
  }
})
```

### 添加新的 Runtime 类型

1. 在 `capability.ts` 中扩展类型:
```typescript
type RuntimeType = 'python-native' | 'mcp' | 'builtin' | 'nodejs'
```

2. 在 CapabilityRegistry 中添加路由:
```typescript
} else if (capability.runtime === 'nodejs') {
  return await this.nodejsAdapter.execute(request, signal)
```

3. 实现 Adapter

## 监控和调试

### 事件监听

```typescript
agent.on(event => {
  console.log(event.type, event)
})
```

### 事件类型:
- `task_created` - 任务创建
- `planning_started` - 开始规划
- `plan_created` - 计划生成
- `execution_started` - 开始执行
- `execution_completed` - 执行完成
- `replanning_started` - 开始重新规划
- `task_completed` - 任务完成
- `task_failed` - 任务失败
- `status_changed` - 状态变更
- `memory_stored` - 记忆存储
- `capability_registered` - 能力注册
- `capability_executed` - 能力执行

### 日志

所有组件使用前缀日志:
- `[AgentCore]` - 核心流程
- `[SkillPlatform]` - Skill 加载和执行
- `[Runtime]` - Python 运行时
- `[Worker xxx]` - Worker 进程
- `[MCP Client]` - MCP 通信
- `[Executor]` - 执行器

## 性能考虑

### Worker 池配置

```typescript
const runtime = new PythonRuntimeManager(dataDir, {
  maxWorkers: 8,           // 最大并发 Worker
  idleTimeout: 300000,     // 5 分钟空闲超时
  requestTimeout: 30000    // 30 秒请求超时
})
```

### Memory 优化

```typescript
const memory = new AgentMemory(dataDir, {
  maxEntries: 100,         // 最多存储 100 条记录
  persistInterval: 5000    // 每 5 秒持久化
})
```

## 安全性

### Skill 权限

每个 Skill 必须声明所需权限:

```json
{
  "permissions": {
    "fileSystem": ["read", "write"],  // 文件系统访问
    "network": true,                  // 网络访问
    "process": false                  // 子进程执行
  }
}
```

### 输入验证

- 所有工具参数都经过类型检查
- 文件路径经过规范化和沙箱检查
- Shell 命令参数经过转义

### 进程隔离

- 每个 Skill 在独立进程中运行
- Worker 崩溃不影响主进程
- 支持资源限制（未来）

## 测试

### 单元测试

```bash
npx tsx test-skill-platform.ts  # Skill 平台
npx tsx test-mcp.ts             # MCP 集成
npx tsx test-agent-core.py      # Agent 核心（Python）
```

### 集成测试

```bash
npx tsx test-e2e-real.ts        # 端到端测试
```

## 性能指标

典型执行时间:
- Skill 加载: < 100ms
- Worker 启动: < 500ms
- JSON-RPC 调用: < 10ms
- 文件操作: < 5ms
- Git 操作: < 100ms
- LLM 规划: 1-3s
- MCP 工具调用: 100-1000ms

## 未来规划

- [ ] 流式执行反馈
- [ ] 并行步骤执行
- [ ] Skill 热重载
- [ ] Worker 资源限制
- [ ] 远程 Skill 执行
- [ ] 可视化规划和执行
- [ ] A/B 测试不同的规划策略
- [ ] 长期记忆和向量搜索
