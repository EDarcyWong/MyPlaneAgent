# Electron 界面集成方案

如何在 Electron 应用中展示和管理 Skills、MCP 服务和 Agent 功能。

---

## 🎨 界面设计概览

### 主要功能模块

```
┌─────────────────────────────────────────┐
│  MyPlaneAgent 主界面                     │
├─────────────────────────────────────────┤
│  [Agent 对话]  [Skills]  [MCP]  [任务]  │
└─────────────────────────────────────────┘
```

---

## 1. 💬 Agent 对话界面

### 功能描述
用户通过自然语言与 Agent 交互，Agent 自动规划和执行任务。

### 界面元素

```
┌──────────────────────────────────────┐
│  Agent 助手                           │
├──────────────────────────────────────┤
│  用户: 分析项目代码结构                │
│                                       │
│  Agent: 📋 已生成执行计划:            │
│    1. 列出核心目录文件                 │
│    2. 读取 package.json               │
│    3. 获取 Git 状态                   │
│                                       │
│  ⚡ 执行中... (2/3)                   │
│                                       │
│  ✓ 任务完成 (耗时: 156ms)             │
│                                       │
│  结果:                                │
│  - 核心文件: 11 个                    │
│  - Git 状态: 已提交                   │
│                                       │
├──────────────────────────────────────┤
│  [输入框: 输入你的任务...]      [发送] │
└──────────────────────────────────────┘
```

### 实现代码

```typescript
// renderer/components/AgentChat.tsx
import { useState } from 'react'

export function AgentChat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [executing, setExecuting] = useState(false)

  const handleSubmit = async () => {
    setExecuting(true)
    
    // 通过 IPC 调用主进程
    const result = await window.electron.ipcRenderer.invoke('agent:execute', {
      description: input,
      workspace: process.cwd()
    })

    setMessages([...messages, {
      type: 'user',
      content: input
    }, {
      type: 'agent',
      plan: result.plan,
      result: result
    }])

    setExecuting(false)
    setInput('')
  }

  return (
    <div className="agent-chat">
      <div className="messages">
        {messages.map((msg, i) => (
          <Message key={i} message={msg} />
        ))}
      </div>
      
      {executing && <ExecutionProgress />}
      
      <div className="input-area">
        <input 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的任务..."
        />
        <button onClick={handleSubmit}>发送</button>
      </div>
    </div>
  )
}

// 显示执行计划
function Message({ message }) {
  if (message.type === 'user') {
    return <div className="user-message">{message.content}</div>
  }

  return (
    <div className="agent-message">
      <div className="plan">
        📋 执行计划:
        {message.plan.steps.map((step, i) => (
          <div key={i}>
            {i + 1}. {step.capability}
          </div>
        ))}
      </div>
      
      <div className="result">
        {message.result.success ? '✓' : '✗'} 
        任务完成 (耗时: {message.result.elapsedMs}ms)
      </div>
    </div>
  )
}
```

---

## 2. 🧩 Skills 管理界面

### 功能描述
展示所有已加载的 Skills，查看详情，启用/禁用。

### 界面元素

```
┌──────────────────────────────────────────┐
│  Skills 管理                              │
├──────────────────────────────────────────┤
│  [刷新]  [添加新 Skill]                   │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ 📁 file-operations              │     │
│  │ 文件处理                         │     │
│  │ 状态: ✓ 已加载  工具数: 3       │     │
│  │ [查看详情]  [禁用]              │     │
│  └─────────────────────────────────┘     │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ 🔧 git-operations               │     │
│  │ Git 操作                        │     │
│  │ 状态: ✓ 已加载  工具数: 8       │     │
│  │ [查看详情]  [禁用]              │     │
│  └─────────────────────────────────┘     │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ 📊 data-processing              │     │
│  │ 数据处理                         │     │
│  │ 状态: ⚠️ 未加载                 │     │
│  │ [加载]  [删除]                  │     │
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

### Skill 详情弹窗

```
┌──────────────────────────────────────────┐
│  file-operations                          │
├──────────────────────────────────────────┤
│  名称: 文件处理                           │
│  版本: 1.0.0                             │
│  分类: file                              │
│  运行时: python-native                   │
│                                           │
│  工具列表:                                │
│  ✓ file.read    - 读取文件               │
│  ✓ file.write   - 写入文件               │
│  ✓ file.list    - 列出目录               │
│                                           │
│  权限:                                    │
│  ✓ 文件系统读取                          │
│  ✓ 文件系统写入                          │
│  ✗ 网络访问                              │
│  ✗ 进程执行                              │
│                                           │
│  [测试]  [编辑]  [关闭]                  │
└──────────────────────────────────────────┘
```

### 实现代码

```typescript
// renderer/components/SkillsManager.tsx
import { useState, useEffect } from 'react'

export function SkillsManager() {
  const [skills, setSkills] = useState([])

  useEffect(() => {
    loadSkills()
  }, [])

  const loadSkills = async () => {
    const result = await window.electron.ipcRenderer.invoke('skills:list')
    setSkills(result)
  }

  const handleRefresh = async () => {
    await window.electron.ipcRenderer.invoke('skills:reload')
    await loadSkills()
  }

  return (
    <div className="skills-manager">
      <div className="toolbar">
        <button onClick={handleRefresh}>刷新</button>
        <button onClick={() => {}}>添加新 Skill</button>
      </div>

      <div className="skills-list">
        {skills.map(skill => (
          <SkillCard key={skill.name} skill={skill} />
        ))}
      </div>
    </div>
  )
}

function SkillCard({ skill }) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <>
      <div className="skill-card">
        <div className="skill-icon">
          {skill.category === 'file' ? '📁' : '🔧'}
        </div>
        
        <div className="skill-info">
          <h3>{skill.name}</h3>
          <p>{skill.displayName}</p>
          <div className="skill-meta">
            状态: {skill.loaded ? '✓ 已加载' : '⚠️ 未加载'}
            {' '}
            工具数: {skill.tools.length}
          </div>
        </div>

        <div className="skill-actions">
          <button onClick={() => setShowDetails(true)}>
            查看详情
          </button>
          <button onClick={() => {}}>
            {skill.loaded ? '禁用' : '启用'}
          </button>
        </div>
      </div>

      {showDetails && (
        <SkillDetailsModal 
          skill={skill} 
          onClose={() => setShowDetails(false)} 
        />
      )}
    </>
  )
}
```

---

## 3. 🔌 MCP 服务管理界面

### 功能描述
管理 MCP 服务器连接，查看可用工具。

### 界面元素

```
┌──────────────────────────────────────────┐
│  MCP 服务                                 │
├──────────────────────────────────────────┤
│  [添加服务]  [刷新]                       │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ 🌐 GitHub MCP                   │     │
│  │ 状态: ✓ 已连接                  │     │
│  │ 工具: 5 个                      │     │
│  │ [查看工具]  [断开]  [配置]      │     │
│  └─────────────────────────────────┘     │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ 🗄️  Postgres MCP                │     │
│  │ 状态: ⚠️ 未连接                 │     │
│  │ 错误: 连接超时                   │     │
│  │ [重试]  [删除]  [配置]          │     │
│  └─────────────────────────────────┘     │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ ➕ 添加新的 MCP 服务器           │     │
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

### 添加 MCP 服务弹窗

```
┌──────────────────────────────────────────┐
│  添加 MCP 服务器                          │
├──────────────────────────────────────────┤
│  服务 ID:                                 │
│  [github-mcp________________]             │
│                                           │
│  显示名称:                                │
│  [GitHub MCP________________]             │
│                                           │
│  命令:                                    │
│  [npx_____________________]              │
│                                           │
│  参数:                                    │
│  [-y, @modelcontextprotocol/server-      │
│   github_______________________]          │
│                                           │
│  环境变量:                                │
│  GITHUB_TOKEN: [***************]          │
│                                           │
│  [测试连接]  [取消]  [添加]               │
└──────────────────────────────────────────┘
```

### 实现代码

```typescript
// renderer/components/MCPManager.tsx
import { useState, useEffect } from 'react'

export function MCPManager() {
  const [servers, setServers] = useState([])

  useEffect(() => {
    loadServers()
  }, [])

  const loadServers = async () => {
    const result = await window.electron.ipcRenderer.invoke('mcp:list')
    setServers(result)
  }

  const handleAddServer = async (config) => {
    await window.electron.ipcRenderer.invoke('mcp:add', config)
    await loadServers()
  }

  return (
    <div className="mcp-manager">
      <div className="toolbar">
        <button onClick={() => {}}>添加服务</button>
        <button onClick={loadServers}>刷新</button>
      </div>

      <div className="servers-list">
        {servers.map(server => (
          <MCPServerCard key={server.id} server={server} />
        ))}
      </div>
    </div>
  )
}

function MCPServerCard({ server }) {
  return (
    <div className="mcp-card">
      <div className="mcp-icon">🌐</div>
      
      <div className="mcp-info">
        <h3>{server.name}</h3>
        <div className="mcp-status">
          状态: {server.connected ? '✓ 已连接' : '⚠️ 未连接'}
        </div>
        <div className="mcp-tools">
          工具: {server.tools?.length || 0} 个
        </div>
      </div>

      <div className="mcp-actions">
        <button onClick={() => {}}>查看工具</button>
        <button onClick={() => {}}>
          {server.connected ? '断开' : '连接'}
        </button>
        <button onClick={() => {}}>配置</button>
      </div>
    </div>
  )
}
```

---

## 4. 📋 任务历史界面

### 功能描述
查看 Agent 执行过的所有任务，包括计划和结果。

### 界面元素

```
┌──────────────────────────────────────────┐
│  任务历史                                 │
├──────────────────────────────────────────┤
│  [清空]  [导出]                           │
│                                           │
│  今天                                     │
│  ┌─────────────────────────────────┐     │
│  │ ✓ 分析项目代码结构               │     │
│  │ 14:32  耗时: 156ms               │     │
│  │ 3个步骤  [查看详情]              │     │
│  └─────────────────────────────────┘     │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ ✓ 检查 Git 状态并提交            │     │
│  │ 14:25  耗时: 245ms               │     │
│  │ 5个步骤  [查看详情]              │     │
│  └─────────────────────────────────┘     │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ ✗ 部署到生产环境                 │     │
│  │ 14:18  失败: 权限不足            │     │
│  │ 已重试2次  [查看详情]  [重试]    │     │
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

### 任务详情弹窗

```
┌──────────────────────────────────────────┐
│  任务详情                                 │
├──────────────────────────────────────────┤
│  任务 ID: analyze-1                      │
│  描述: 分析项目代码结构                   │
│  状态: ✓ 成功                            │
│  开始时间: 2024-09-24 14:32:15          │
│  耗时: 156ms                             │
│                                           │
│  执行计划:                                │
│  1. ✓ file.list (32ms)                  │
│     列出核心目录文件                      │
│                                           │
│  2. ✓ file.read (5ms)                   │
│     读取 package.json                    │
│                                           │
│  3. ✓ git.status (119ms)                │
│     获取 Git 状态                        │
│                                           │
│  结果:                                    │
│  {                                       │
│    "files": 11,                         │
│    "gitStatus": "clean"                 │
│  }                                       │
│                                           │
│  [复制结果]  [再次执行]  [关闭]          │
└──────────────────────────────────────────┘
```

---

## 5. 🎯 能力总览界面

### 功能描述
统一展示所有可用能力（来自 Skills 和 MCP）。

### 界面元素

```
┌──────────────────────────────────────────┐
│  可用能力                                 │
├──────────────────────────────────────────┤
│  [全部]  [文件]  [Git]  [网络]  [数据]   │
│  搜索: [_________________]  🔍           │
│                                           │
│  文件操作 (3)                             │
│  ├─ file.read      读取文件               │
│  ├─ file.write     写入文件               │
│  └─ file.list      列出目录               │
│                                           │
│  Git 操作 (8)                            │
│  ├─ git.status     查看状态               │
│  ├─ git.add        添加文件               │
│  ├─ git.commit     提交更改               │
│  └─ ...                                  │
│                                           │
│  GitHub (via MCP) (5)                    │
│  ├─ github.create_issue    创建Issue     │
│  ├─ github.list_prs        列出PR        │
│  └─ ...                                  │
│                                           │
│  总计: 16 个能力                         │
└──────────────────────────────────────────┘
```

---

## 6. 📊 统计和监控界面

### 功能描述
展示系统运行状态和统计信息。

### 界面元素

```
┌──────────────────────────────────────────┐
│  系统状态                                 │
├──────────────────────────────────────────┤
│  运行时状态                               │
│  ├─ Python Workers: 2/8 (活跃/最大)     │
│  ├─ 内存使用: 128 MB                     │
│  └─ CPU 使用: 5%                         │
│                                           │
│  今日统计                                 │
│  ├─ 任务执行: 23 次                      │
│  ├─ 成功率: 95.7%                        │
│  ├─ 平均耗时: 187ms                      │
│  └─ 能力调用: 67 次                      │
│                                           │
│  Skills 状态                             │
│  ├─ 已加载: 2                            │
│  ├─ 可用工具: 11                         │
│  └─ 错误: 0                              │
│                                           │
│  MCP 服务                                │
│  ├─ 已连接: 1                            │
│  ├─ 可用工具: 5                          │
│  └─ 错误: 0                              │
└──────────────────────────────────────────┘
```

---

## 7. 🔧 主进程集成 (IPC Handlers)

### electron/main/ipc-handlers.ts

```typescript
import { ipcMain } from 'electron'
import { PythonRuntimeManager } from './agent/core/python-runtime-manager'
import { SkillPlatform } from './agent/core/skill-platform'
import { CapabilityRegistry } from './agent/core/capability-registry'
import { MCPAdapter } from './agent/core/mcp-adapter'
import { AgentCore } from './agent/core/agent-core'
import { ModelClient } from './agent/core/model-client'
import { AgentMemory } from './agent/core/agent-memory'
import { getModelConfig } from './agent-config'
import type { AgentTask } from './shared/types'

let agentSystem: {
  runtime: PythonRuntimeManager
  platform: SkillPlatform
  registry: CapabilityRegistry
  mcpAdapter: MCPAdapter
  agent: AgentCore
} | null = null

// 初始化 Agent 系统
export async function initializeAgentSystem(dataDir: string, skillsDir: string) {
  const runtime = new PythonRuntimeManager(dataDir)
  const platform = new SkillPlatform(skillsDir, runtime)
  await platform.initialize()

  const registry = new CapabilityRegistry(platform)
  await registry.initialize()

  const mcpAdapter = new MCPAdapter()
  await registry.addMCPAdapter(mcpAdapter)

  const modelClient = new ModelClient(getModelConfig())
  const memory = new AgentMemory(dataDir)

  const agent = new AgentCore(registry, modelClient, memory, {
    mode: 'auto',
    maxReplanAttempts: 2
  })

  agentSystem = {
    runtime,
    platform,
    registry,
    mcpAdapter,
    agent
  }
}

// 注册 IPC handlers
export function registerIPCHandlers() {
  // Agent 执行
  ipcMain.handle('agent:execute', async (event, params: {
    description: string
    workspace: string
  }) => {
    if (!agentSystem) {
      throw new Error('Agent system not initialized')
    }

    const task: AgentTask = {
      id: `task-${Date.now()}`,
      description: params.description,
      context: {
        workspace: params.workspace,
        userIntent: params.description
      },
      createdAt: Date.now()
    }

    const controller = new AbortController()
    const result = await agentSystem.agent.run(task, controller.signal)

    return result
  })

  // Skills 管理
  ipcMain.handle('skills:list', async () => {
    if (!agentSystem) return []
    
    return agentSystem.platform.listSkills().map(skill => ({
      name: skill.name,
      displayName: skill.displayName,
      category: skill.category,
      tools: skill.tools,
      loaded: true
    }))
  })

  ipcMain.handle('skills:reload', async () => {
    if (!agentSystem) return
    
    await agentSystem.platform.initialize()
    await agentSystem.registry.initialize()
  })

  // MCP 管理
  ipcMain.handle('mcp:list', async () => {
    if (!agentSystem) return []
    
    // 返回 MCP 服务器列表
    return []
  })

  ipcMain.handle('mcp:add', async (event, config) => {
    if (!agentSystem) return
    
    await agentSystem.mcpAdapter.addServer(config)
  })

  // 能力查询
  ipcMain.handle('capabilities:list', async () => {
    if (!agentSystem) return []
    
    return agentSystem.registry.list()
  })

  // 任务历史
  ipcMain.handle('tasks:history', async () => {
    if (!agentSystem) return []
    
    // 返回任务历史
    return []
  })

  // 系统状态
  ipcMain.handle('system:status', async () => {
    if (!agentSystem) return null
    
    return {
      workers: {
        active: 0,
        max: 8
      },
      memory: process.memoryUsage(),
      skills: agentSystem.platform.listSkills().length,
      capabilities: agentSystem.registry.list().length
    }
  })
}
```

---

## 8. 📱 主界面布局

### electron/renderer/App.tsx

```typescript
import { useState } from 'react'
import { AgentChat } from './components/AgentChat'
import { SkillsManager } from './components/SkillsManager'
import { MCPManager } from './components/MCPManager'
import { TaskHistory } from './components/TaskHistory'
import { CapabilitiesList } from './components/CapabilitiesList'
import { SystemStatus } from './components/SystemStatus'

export function App() {
  const [activeTab, setActiveTab] = useState('agent')

  return (
    <div className="app">
      <nav className="sidebar">
        <h1>MyPlaneAgent</h1>
        
        <button 
          className={activeTab === 'agent' ? 'active' : ''}
          onClick={() => setActiveTab('agent')}
        >
          💬 Agent 对话
        </button>
        
        <button 
          className={activeTab === 'skills' ? 'active' : ''}
          onClick={() => setActiveTab('skills')}
        >
          🧩 Skills 管理
        </button>
        
        <button 
          className={activeTab === 'mcp' ? 'active' : ''}
          onClick={() => setActiveTab('mcp')}
        >
          🔌 MCP 服务
        </button>
        
        <button 
          className={activeTab === 'tasks' ? 'active' : ''}
          onClick={() => setActiveTab('tasks')}
        >
          📋 任务历史
        </button>
        
        <button 
          className={activeTab === 'capabilities' ? 'active' : ''}
          onClick={() => setActiveTab('capabilities')}
        >
          🎯 能力总览
        </button>
        
        <button 
          className={activeTab === 'status' ? 'active' : ''}
          onClick={() => setActiveTab('status')}
        >
          📊 系统状态
        </button>
      </nav>

      <main className="content">
        {activeTab === 'agent' && <AgentChat />}
        {activeTab === 'skills' && <SkillsManager />}
        {activeTab === 'mcp' && <MCPManager />}
        {activeTab === 'tasks' && <TaskHistory />}
        {activeTab === 'capabilities' && <CapabilitiesList />}
        {activeTab === 'status' && <SystemStatus />}
      </main>
    </div>
  )
}
```

---

## 9. 🎨 样式建议

### styles/main.css

```css
.app {
  display: flex;
  height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.sidebar {
  width: 200px;
  background: #2c3e50;
  color: white;
  padding: 20px;
}

.sidebar button {
  width: 100%;
  padding: 12px;
  margin: 5px 0;
  background: transparent;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.3s;
}

.sidebar button:hover {
  background: rgba(255, 255, 255, 0.1);
}

.sidebar button.active {
  background: #3498db;
}

.content {
  flex: 1;
  padding: 30px;
  overflow-y: auto;
  background: #ecf0f1;
}

/* Agent Chat */
.agent-chat {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

/* Skill Card */
.skill-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  margin: 10px 0;
  display: flex;
  align-items: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  transition: transform 0.2s;
}

.skill-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

/* 更多样式... */
```

---

## 10. 🚀 实施步骤

### 阶段 1: 基础界面 (1-2天)

1. 创建基础布局和路由
2. 实现 Agent 对话界面
3. 添加 IPC handlers

### 阶段 2: Skills 管理 (1天)

1. Skills 列表展示
2. Skill 详情查看
3. 刷新和重载功能

### 阶段 3: MCP 管理 (1天)

1. MCP 服务器列表
2. 添加/删除服务器
3. 工具查看

### 阶段 4: 增强功能 (1-2天)

1. 任务历史
2. 能力总览
3. 系统状态监控

### 阶段 5: 优化和测试 (1天)

1. 界面优化
2. 错误处理
3. 用户体验测试

---

## 11. 💡 用户体验优化

### 实时反馈

- Agent 执行时显示实时进度
- Skill 加载时显示加载动画
- 错误时显示友好提示

### 快捷操作

- 常用任务快捷按钮
- 历史任务一键重试
- 能力快速搜索

### 数据持久化

- 保存用户偏好设置
- 记住上次使用的 Skills
- 缓存 MCP 服务器配置

---

## 12. 📝 总结

这套界面设计方案：

✅ **完整覆盖** - 所有核心功能都有对应界面  
✅ **易于使用** - 清晰的导航和直观的操作  
✅ **可扩展** - 模块化设计，易于添加新功能  
✅ **实时反馈** - 用户能清楚看到系统状态  
✅ **专业美观** - 现代化的 UI 设计

**下一步建议**:

1. 先实现 Agent 对话界面（最核心）
2. 再实现 Skills 管理（使用频率高）
3. 最后完善其他功能

需要我帮你实现具体的某个界面吗？
