# 界面整合方案：从工具列表到 Skills 系统

如何将现有的 AgentToolManager.vue 改造为支持新的 Skills 架构。

---

## 📋 现状分析

### 原有工具系统

**数据来源**：
- 存储在数据库中（SQLite）
- 通过 `agentToolsList` IPC 调用获取
- 每个工具独立管理，包含多个版本

**界面功能**：
```
工具列表
├─ 内置工具（builtin）
├─ 自定义工具（custom）
├─ 已停用工具（disabled）
└─ 每个工具
   ├─ 基本信息（名称、描述、风险等级）
   ├─ 参数 Schema
   ├─ Python 实现代码
   ├─ 版本历史
   └─ 测试功能
```

**文件位置**：
- `src/local-ai/AgentToolManager.vue` - 界面组件
- `electron/main/agent/tools.ts` - 后端逻辑
- `electron/main/agent/tool-store.ts` - 数据存储

---

## 🎯 新 Skills 系统

### 数据来源

**文件系统**：
```
skills/
├─ file-operations/          # Skill 目录
│  ├─ skill.json            # 配置文件
│  ├─ index.py              # 实现代码
│  └─ README.md             # 说明文档
├─ git-operations/
│  ├─ skill.json
│  ├─ index.py
│  └─ README.md
└─ ...
```

**架构层次**：
```
SkillPlatform (加载和管理 Skills)
    ↓
CapabilityRegistry (统一注册和调用)
    ↓
AgentCore (自动规划和执行)
```

---

## 🔄 整合策略

### 方案 1: 完全替换（推荐）

将 AgentToolManager.vue 改为 AgentSkillManager.vue，完全基于新的 Skills 系统。

**优点**：
- 架构清晰，避免双重管理
- 完全利用新系统的能力
- 长期维护成本低

**缺点**：
- 需要迁移现有工具到 Skills
- 用户界面变化较大

### 方案 2: 双轨制（过渡）

保留原有工具系统，同时添加 Skills 管理界面。

**优点**：
- 平滑过渡，不影响现有功能
- 给用户时间适应

**缺点**：
- 维护两套系统
- 界面复杂度增加

### 方案 3: 统一视图（本文推荐实现）

在界面上统一展示，底层兼容两种来源。

**优点**：
- 用户体验统一
- 逐步迁移，风险可控
- 充分利用新架构

**缺点**：
- 需要适配层
- 初期开发工作量稍大

---

## 💡 推荐实现：统一视图方案

### 界面设计

```
┌──────────────────────────────────────────┐
│  能力管理                                 │
├──────────────────────────────────────────┤
│  [刷新]  [添加 Skill]                     │
│                                           │
│  Skills (新架构) ─────────────────────    │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ 📁 file-operations              │     │
│  │ Skill · Python Native           │     │
│  │ 3 个工具 · 已加载               │     │
│  │ [展开]  [管理]                  │     │
│  └─────────────────────────────────┘     │
│    └─ file.read    读取文件              │
│    └─ file.write   写入文件              │
│    └─ file.list    列出目录              │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ 🔧 git-operations               │     │
│  │ Skill · Python Native           │     │
│  │ 8 个工具 · 已加载               │     │
│  │ [展开]  [管理]                  │     │
│  └─────────────────────────────────┘     │
│                                           │
│  传统工具 (兼容模式) ──────────────────   │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ 🔨 my_custom_tool               │     │
│  │ 传统工具 · v3                   │     │
│  │ 高风险 · 已启用                 │     │
│  │ [编辑]  [禁用]                  │     │
│  └─────────────────────────────────┘     │
│                                           │
│  MCP 服务 ────────────────────────────   │
│                                           │
│  ┌─────────────────────────────────┐     │
│  │ 🌐 GitHub MCP                   │     │
│  │ MCP 服务 · 已连接               │     │
│  │ 5 个工具                        │     │
│  │ [查看]  [配置]                  │     │
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

---

## 🔧 实现步骤

### 第 1 步：扩展 IPC 接口

修改 `electron/main/index.ts` 添加新的 IPC handlers：

```typescript
import { SkillPlatform } from './agent/core/skill-platform'
import { CapabilityRegistry } from './agent/core/capability-registry'
import { PythonRuntimeManager } from './agent/core/python-runtime-manager'

// 全局实例
let skillPlatform: SkillPlatform | null = null
let capabilityRegistry: CapabilityRegistry | null = null

// 初始化 Skills 系统
async function initializeSkillsSystem() {
  const dataDir = path.join(app.getPath('userData'), 'agent-data')
  const skillsDir = path.join(app.getPath('userData'), 'skills')

  const runtime = new PythonRuntimeManager(dataDir)
  skillPlatform = new SkillPlatform(skillsDir, runtime)
  await skillPlatform.initialize()

  capabilityRegistry = new CapabilityRegistry(skillPlatform)
  await capabilityRegistry.initialize()
}

// 新增 IPC handlers
ipcMain.handle('skills:list', async () => {
  if (!skillPlatform) return []
  
  return skillPlatform.listSkills().map(skill => ({
    type: 'skill',
    id: skill.name,
    name: skill.displayName,
    description: skill.description,
    category: skill.category,
    runtime: skill.runtime,
    tools: skill.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    })),
    loaded: true,
    source: 'python-native'
  }))
})

ipcMain.handle('skills:reload', async () => {
  if (!skillPlatform) return
  
  await skillPlatform.initialize()
  await capabilityRegistry?.initialize()
})

ipcMain.handle('capabilities:listAll', async () => {
  if (!capabilityRegistry) return []
  
  const capabilities = capabilityRegistry.list()
  
  // 按来源分组
  return capabilities.map(cap => ({
    name: cap.name,
    description: cap.description,
    source: cap.name.startsWith('mcp.') ? 'mcp' : 'skill',
    category: cap.category || 'general'
  }))
})

// 在 app.whenReady() 中调用
app.whenReady().then(async () => {
  await initializeSkillsSystem()
  // ... 其他初始化
})
```

---

### 第 2 步：创建统一数据模型

新建 `electron/shared/capabilities.ts`：

```typescript
// 统一的能力项类型
export interface CapabilityItem {
  type: 'skill' | 'legacy-tool' | 'mcp'
  id: string
  name: string
  description: string
  source: string // 'python-native' | 'mcp' | 'legacy'
  tools: ToolInfo[]
  enabled: boolean
  metadata?: Record<string, any>
}

export interface ToolInfo {
  name: string
  description: string
  parameters: any
  risk?: 'read' | 'write' | 'high'
}

// Skill 类型
export interface SkillCapability extends CapabilityItem {
  type: 'skill'
  category: string
  runtime: 'python-native'
  skillPath: string
}

// 传统工具类型
export interface LegacyToolCapability extends CapabilityItem {
  type: 'legacy-tool'
  version: number
  risk: 'read' | 'write' | 'high'
  builtin: boolean
}

// MCP 服务类型
export interface MCPCapability extends CapabilityItem {
  type: 'mcp'
  serverId: string
  connected: boolean
}
```

---

### 第 3 步：创建适配器层

新建 `electron/main/agent/capability-adapter.ts`：

```typescript
import type { 
  CapabilityItem, 
  SkillCapability, 
  LegacyToolCapability,
  MCPCapability 
} from '../../shared/capabilities'
import { SkillPlatform } from './core/skill-platform'
import { MCPAdapter } from './core/mcp-adapter'

/**
 * 统一不同来源的能力项
 */
export class CapabilityAdapter {
  constructor(
    private skillPlatform: SkillPlatform,
    private mcpAdapter: MCPAdapter,
    private legacyToolStore: any // 原有的 tool store
  ) {}

  /**
   * 获取所有能力项
   */
  async listAll(): Promise<CapabilityItem[]> {
    const [skills, legacyTools, mcpServers] = await Promise.all([
      this.listSkills(),
      this.listLegacyTools(),
      this.listMCPServers()
    ])

    return [...skills, ...legacyTools, ...mcpServers]
  }

  /**
   * 获取 Skills
   */
  private async listSkills(): Promise<SkillCapability[]> {
    const skills = this.skillPlatform.listSkills()

    return skills.map(skill => ({
      type: 'skill',
      id: `skill:${skill.name}`,
      name: skill.displayName,
      description: skill.description,
      source: 'python-native',
      category: skill.category,
      runtime: skill.runtime,
      skillPath: skill.name,
      tools: skill.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      })),
      enabled: true,
      metadata: {
        version: skill.version
      }
    }))
  }

  /**
   * 获取传统工具
   */
  private async listLegacyTools(): Promise<LegacyToolCapability[]> {
    const tools = await this.legacyToolStore.list()

    return tools.map(tool => ({
      type: 'legacy-tool',
      id: `legacy:${tool.key}`,
      name: tool.current.name || tool.key,
      description: tool.current.description,
      source: 'legacy',
      version: tool.activeVersion,
      risk: tool.current.risk,
      builtin: tool.builtin,
      tools: [{
        name: tool.key,
        description: tool.current.description,
        parameters: tool.current.parameters,
        risk: tool.current.risk
      }],
      enabled: tool.enabled
    }))
  }

  /**
   * 获取 MCP 服务
   */
  private async listMCPServers(): Promise<MCPCapability[]> {
    // TODO: 从 MCPAdapter 获取服务器列表
    return []
  }

  /**
   * 切换能力启用状态
   */
  async toggle(id: string, enabled: boolean): Promise<void> {
    const [type, key] = id.split(':')

    if (type === 'legacy') {
      await this.legacyToolStore.toggle(key, enabled)
    } else if (type === 'skill') {
      // Skills 默认启用，可以添加禁用逻辑
      throw new Error('Skill toggle not yet implemented')
    } else if (type === 'mcp') {
      // MCP 连接/断开
      throw new Error('MCP toggle not yet implemented')
    }
  }
}
```

---

### 第 4 步：修改 Vue 组件

修改 `src/local-ai/AgentToolManager.vue`：

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, FolderOpened, Tools, Link } from '@element-plus/icons-vue'
import type { CapabilityItem } from '../../electron/shared/capabilities'

type Filter = 'all' | 'skills' | 'legacy' | 'mcp'

const capabilities = ref<CapabilityItem[]>([])
const selectedId = ref('')
const busy = ref(false)
const error = ref('')
const query = ref('')
const filter = ref<Filter>('all')
const expandedIds = ref<Set<string>>(new Set())

const counts = computed(() => ({
  all: capabilities.value.length,
  skills: capabilities.value.filter(c => c.type === 'skill').length,
  legacy: capabilities.value.filter(c => c.type === 'legacy-tool').length,
  mcp: capabilities.value.filter(c => c.type === 'mcp').length
}))

const filtered = computed(() => {
  const word = query.value.trim().toLowerCase()
  
  return capabilities.value.filter(item => {
    // 过滤类型
    if (filter.value !== 'all') {
      if (filter.value === 'skills' && item.type !== 'skill') return false
      if (filter.value === 'legacy' && item.type !== 'legacy-tool') return false
      if (filter.value === 'mcp' && item.type !== 'mcp') return false
    }

    // 过滤搜索词
    if (word) {
      return [item.name, item.description]
        .some(v => v.toLowerCase().includes(word))
    }

    return true
  })
})

const isExpanded = (id: string) => expandedIds.value.has(id)

const toggleExpand = (id: string) => {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id)
  } else {
    expandedIds.value.add(id)
  }
}

async function load() {
  busy.value = true
  try {
    capabilities.value = await window.myplane.localAiStudio('capabilitiesListAll')
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}

async function refresh() {
  await window.myplane.localAiStudio('skillsReload')
  await load()
}

const typeIcon = (type: string) => {
  return {
    'skill': '📁',
    'legacy-tool': '🔨',
    'mcp': '🌐'
  }[type] || '❓'
}

const typeLabel = (type: string) => {
  return {
    'skill': 'Skill',
    'legacy-tool': '传统工具',
    'mcp': 'MCP 服务'
  }[type] || '未知'
}

async function toggleCapability(item: CapabilityItem) {
  busy.value = true
  try {
    await window.myplane.localAiStudio('capabilityToggle', {
      id: item.id,
      enabled: !item.enabled
    })
    await load()
    ElMessage.success(item.enabled ? '已停用' : '已启用')
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}

onMounted(() => load())
</script>

<template>
  <main class="capability-manager">
    <p v-if="error" class="error-banner">{{ error }}</p>

    <div class="layout">
      <!-- 左侧列表 -->
      <aside class="browser">
        <header class="browser-head">
          <div>
            <h2>能力管理</h2>
            <span>{{ counts.all }} 项 · Skills + 工具 + MCP</span>
          </div>
          <button 
            class="icon-action" 
            :disabled="busy" 
            @click="refresh"
          >
            <Refresh />
          </button>
        </header>

        <!-- 搜索 -->
        <div class="search-box">
          <input 
            v-model="query" 
            placeholder="搜索能力..."
          />
        </div>

        <!-- 过滤器 -->
        <div class="filters">
          <button
            :class="{ active: filter === 'all' }"
            @click="filter = 'all'"
          >
            全部 <span>{{ counts.all }}</span>
          </button>
          <button
            :class="{ active: filter === 'skills' }"
            @click="filter = 'skills'"
          >
            Skills <span>{{ counts.skills }}</span>
          </button>
          <button
            :class="{ active: filter === 'legacy' }"
            @click="filter = 'legacy'"
          >
            传统 <span>{{ counts.legacy }}</span>
          </button>
          <button
            :class="{ active: filter === 'mcp' }"
            @click="filter = 'mcp'"
          >
            MCP <span>{{ counts.mcp }}</span>
          </button>
        </div>

        <!-- 能力列表 -->
        <div class="capability-list">
          <div 
            v-for="item in filtered" 
            :key="item.id"
            class="capability-card"
            :class="{ expanded: isExpanded(item.id) }"
          >
            <!-- 主卡片 -->
            <div class="card-main">
              <div class="card-icon">{{ typeIcon(item.type) }}</div>
              
              <div class="card-info">
                <h3>{{ item.name }}</h3>
                <p>{{ typeLabel(item.type) }} · {{ item.tools.length }} 个工具</p>
              </div>

              <div class="card-actions">
                <button 
                  v-if="item.type !== 'skill'"
                  @click.stop="toggleCapability(item)"
                >
                  {{ item.enabled ? '停用' : '启用' }}
                </button>
                <button 
                  v-if="item.tools.length > 0"
                  @click.stop="toggleExpand(item.id)"
                >
                  {{ isExpanded(item.id) ? '收起' : '展开' }}
                </button>
              </div>
            </div>

            <!-- 工具列表（展开时） -->
            <div v-if="isExpanded(item.id)" class="card-tools">
              <div 
                v-for="tool in item.tools" 
                :key="tool.name"
                class="tool-item"
              >
                <code>{{ tool.name }}</code>
                <span>{{ tool.description }}</span>
              </div>
            </div>
          </div>

          <div v-if="!filtered.length" class="empty-state">
            <p>没有匹配的能力</p>
          </div>
        </div>
      </aside>

      <!-- 右侧详情（可选） -->
      <section class="details">
        <p class="placeholder">选择一项查看详情</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.capability-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.browser {
  width: 400px;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
}

.browser-head {
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.search-box {
  padding: 10px 20px;
}

.search-box input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
}

.filters {
  display: flex;
  padding: 10px 20px;
  gap: 8px;
  border-bottom: 1px solid #e0e0e0;
}

.filters button {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
  cursor: pointer;
}

.filters button.active {
  background: #409eff;
  color: white;
  border-color: #409eff;
}

.capability-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.capability-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 10px;
  overflow: hidden;
}

.card-main {
  display: flex;
  align-items: center;
  padding: 15px;
  gap: 12px;
}

.card-icon {
  font-size: 24px;
}

.card-info {
  flex: 1;
}

.card-info h3 {
  margin: 0 0 4px 0;
  font-size: 14px;
}

.card-info p {
  margin: 0;
  font-size: 12px;
  color: #666;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.card-actions button {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
}

.card-tools {
  border-top: 1px solid #e0e0e0;
  padding: 10px 15px;
  background: #f9f9f9;
}

.tool-item {
  padding: 8px;
  display: flex;
  gap: 12px;
  align-items: center;
}

.tool-item code {
  background: #e0e0e0;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
  min-width: 100px;
}

.tool-item span {
  font-size: 13px;
  color: #666;
}

.details {
  flex: 1;
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder {
  color: #999;
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #999;
}
</style>
```

---

### 第 5 步：注册新的 IPC 方法

修改 `electron/main/local-ai-studio.ts`，添加：

```typescript
import { CapabilityAdapter } from './agent/capability-adapter'

let capabilityAdapter: CapabilityAdapter | null = null

// 在初始化时创建
async function initialize() {
  // ... 原有初始化

  capabilityAdapter = new CapabilityAdapter(
    skillPlatform,
    mcpAdapter,
    toolStore
  )
}

// 添加到 handler 函数中
async function handler(method: string, ...args: any[]) {
  switch (method) {
    case 'capabilitiesListAll':
      return await capabilityAdapter?.listAll() || []

    case 'skillsReload':
      await skillPlatform?.initialize()
      await capabilityRegistry?.initialize()
      return

    case 'capabilityToggle':
      await capabilityAdapter?.toggle(args[0].id, args[0].enabled)
      return

    // ... 原有 cases
  }
}
```

---

## 📊 迁移路径

### 阶段 1: 并行运行（1 周）

- 保持原有 AgentToolManager.vue 不变
- 新建 AgentCapabilityManager.vue 实现统一视图
- 两个界面并存，供用户选择

### 阶段 2: 数据迁移（1-2 周）

- 提供工具：将传统工具转换为 Skill
- 批量迁移内置工具
- 用户迁移自定义工具

### 阶段 3: 功能对齐（1 周）

- 在新界面中补充原有功能：
  - 编辑 Skill 配置
  - 测试工具
  - 版本管理（如适用）

### 阶段 4: 切换默认（1 周）

- 新界面成为默认
- 原界面保留为"传统模式"
- 收集用户反馈

### 阶段 5: 完全迁移（2 周后）

- 移除旧界面
- 清理冗余代码
- 更新文档

---

## ✅ 测试清单

- [ ] Skills 正确显示
- [ ] 传统工具正确显示
- [ ] MCP 服务正确显示
- [ ] 启用/停用功能正常
- [ ] 搜索过滤正确
- [ ] 展开/收起工具列表
- [ ] 数据刷新正常
- [ ] 错误处理友好
- [ ] 性能满足要求（< 500ms 加载）

---

## 📝 总结

**推荐做法**：

1. ✅ 先实现统一视图（第 3 步到第 5 步）
2. ✅ 保持两套界面并行运行
3. ✅ 逐步迁移数据和用户
4. ✅ 最终移除旧系统

**关键优势**：

- 用户体验统一
- 充分利用新架构
- 平滑过渡，风险可控
- 长期维护成本低

需要我开始实现具体代码吗？
