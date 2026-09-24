# Skills 管理界面和迁移工具实施指南

如何将传统工具系统完全迁移到新的 Skills 系统。

---

## 📦 已完成的文件

### 1. 迁移脚本
**文件**: `tools/migrate-legacy-tools.js`

**功能**:
- 读取 `data/agent-tools.json` 中的所有传统工具
- 为每个工具生成一个独立的 Skill 目录
- 包含 `skill.json`、`index.py`、`README.md`
- 自动推断分类（file、git、network、system 等）
- 生成完整的迁移报告

**使用方法**:
```bash
node tools/migrate-legacy-tools.js
```

**输出**:
- `data/skills/<skill-name>/` - 每个 Skill 目录
- `data/MIGRATION_REPORT.md` - 迁移报告
- `data/migration.log` - 详细日志

---

### 2. Skills 管理界面
**文件**: `src/local-ai/AgentSkillManager.vue`

**功能**:
- ✅ Skills 列表（按分类筛选、搜索）
- ✅ 在线编辑（skill.json、index.py、README.md）
- ✅ 测试功能（选择工具、输入参数、查看输出）
- ✅ 创建新 Skill
- ✅ 导入/导出 Skill（预留）
- ✅ 实时状态显示

**界面布局**:
```
┌─────────────────────────────────────────┐
│ [Skills 列表]        [详情/编辑/测试]   │
│                                          │
│ - 搜索                  信息面板:        │
│ - 分类过滤              - 基本信息       │
│ - Skill 卡片           - 工具列表       │
│   • 名称                                 │
│   • 分类                编辑面板:        │
│   • 工具数              - skill.json    │
│                         - index.py      │
│                         - README.md     │
│                                          │
│                         测试面板:        │
│                         - 选择工具       │
│                         - 输入参数       │
│                         - 查看结果       │
└─────────────────────────────────────────┘
```

---

### 3. IPC Handlers
**文件**: `electron/main/skills-ipc-handlers.ts`

**提供的接口**:
```typescript
// 列出所有 Skills
skillsList(): SkillInfo[]

// 重新加载 Skills
skillsReload(): void

// 获取 Skill 文件内容
skillGetContent(skillName: string): {
  skillJson: object
  indexPy: string
  readme: string
}

// 保存 Skill
skillSave(skillName: string, skillJson: object, indexPy: string, readme: string): void

// 测试 Skill 工具
skillTestTool(skillName: string, toolName: string, args: object, workspace: string): {
  output: string
  elapsedMs: number
}

// 创建新 Skill
skillCreate(skillName: string): void

// 获取默认工作目录
getDefaultWorkspace(): string
```

---

## 🔧 实施步骤

### 步骤 1: 添加 package.json 脚本

在 `package.json` 中添加:

```json
{
  "scripts": {
    "migrate-tools": "node tools/migrate-legacy-tools.js"
  }
}
```

---

### 步骤 2: 集成 IPC Handlers

在 `electron/main/local-ai-studio.ts` 中添加：

#### 2.1 导入依赖
```typescript
import { SkillPlatform } from './agent/core/skill-platform.js'
import { PythonRuntimeManager } from './agent/core/python-runtime-manager.js'
import { promises as fs } from 'fs'
```

#### 2.2 添加类属性
```typescript
export class LocalAiStudio {
  // ... 现有属性
  private skillPlatform: SkillPlatform | null = null
  private runtimeManager: PythonRuntimeManager | null = null

  // ... 其他代码
}
```

#### 2.3 添加初始化方法
```typescript
async initializeSkills() {
  const dataDir = path.join(app.getPath('userData'), 'agent-data')
  const skillsDir = path.join(dataDir, 'skills')

  this.runtimeManager = new PythonRuntimeManager(dataDir)
  this.skillPlatform = new SkillPlatform(skillsDir, this.runtimeManager)
  await this.skillPlatform.initialize()
}
```

#### 2.4 添加 case 处理
将 `skills-ipc-handlers.ts` 中的所有 case 复制到 `handle()` 方法的 switch 语句中（约 2424 行之后）。

---

### 步骤 3: 添加路由入口

在 `src/LocalAiStudio.vue` 中添加导航：

```vue
<template>
  <div class="studio">
    <nav>
      <!-- 现有导航 -->
      <button @click="currentView = 'tools'">工具管理</button>
      <button @click="currentView = 'skills'">Skills</button>
    </nav>

    <main>
      <AgentToolManager v-if="currentView === 'tools'" />
      <AgentSkillManager v-if="currentView === 'skills'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import AgentToolManager from './local-ai/AgentToolManager.vue'
import AgentSkillManager from './local-ai/AgentSkillManager.vue'
import { ref } from 'vue'

const currentView = ref('skills') // 默认显示 Skills
</script>
```

---

### 步骤 4: 运行迁移

```bash
# 1. 备份现有数据
cp data/agent-tools.json data/agent-tools.json.backup

# 2. 运行迁移脚本
npm run migrate-tools

# 3. 查看迁移报告
cat data/MIGRATION_REPORT.md

# 4. 启动应用测试
npm run dev
```

---

### 步骤 5: 验证迁移结果

#### 5.1 检查 Skills 目录
```bash
ls -la data/skills/
```

应该看到每个传统工具对应的目录。

#### 5.2 在界面中验证
1. 打开应用
2. 进入 "Skills" 标签
3. 检查是否所有工具都已显示
4. 尝试编辑一个 Skill
5. 测试一个简单的工具（如 file.read）

#### 5.3 运行集成测试
```bash
npm run test:skills
npm run test:integration
```

---

## ⚠️ 注意事项

### 内置工具需要特殊处理

迁移脚本会标记包含 `builtin()` 调用的工具。这些工具需要：

1. **选项 A: 重新实现**
   - 手动实现 `execute()` 函数
   - 参考原内置实现的行为

2. **选项 B: 保留 Legacy Adapter**
   - 通过 Legacy Adapter 调用原实现
   - 作为过渡方案

示例（选项 B）：
```python
# index.py
from legacy_adapter import call_legacy_tool

def my_tool(args, context):
    """通过 Legacy Adapter 调用原内置实现"""
    return call_legacy_tool('my_tool', args, context)

TOOLS = {
    'my_tool': my_tool
}
```

---

### 数据备份

迁移前务必备份：
```bash
# 备份工具数据
cp data/agent-tools.json data/agent-tools.json.backup

# 备份整个 data 目录（推荐）
cp -r data data.backup.$(date +%Y%m%d)
```

---

### 渐进式迁移

不必一次性迁移所有工具，可以分批进行：

1. **第一批**: 迁移简单的自定义工具
2. **第二批**: 迁移文件、Git 等常用工具
3. **第三批**: 迁移复杂的内置工具

每批迁移后充分测试。

---

## 📊 迁移后的清理

### 等待 2-4 周稳定期后：

#### 1. 隐藏传统工具入口
```vue
<!-- LocalAiStudio.vue -->
<button v-if="false" @click="currentView = 'tools'">
  工具管理（旧）
</button>
```

#### 2. 添加弃用警告
```vue
<!-- AgentToolManager.vue -->
<div class="deprecation-banner">
  ⚠️ 传统工具系统已弃用，请使用新的 Skills 系统
</div>
```

#### 3. 完全移除（v3.0）
```bash
# 删除文件
rm electron/main/agent/tools.ts
rm electron/main/agent/tool-store.ts
rm src/local-ai/AgentToolManager.vue

# 删除数据
rm data/agent-tools.json
```

---

## 🧪 测试清单

- [ ] 迁移脚本成功运行
- [ ] 所有工具都生成了对应的 Skill
- [ ] Skills 界面正常显示
- [ ] 可以浏览 Skill 列表
- [ ] 搜索和过滤功能正常
- [ ] 可以查看 Skill 详情
- [ ] 可以编辑 skill.json
- [ ] 可以编辑 index.py
- [ ] 可以编辑 README.md
- [ ] 保存功能正常
- [ ] 测试功能正常（选择工具、输入参数、查看结果）
- [ ] 创建新 Skill 功能正常
- [ ] 重新加载功能正常
- [ ] Agent 能正常调用 Skills 中的工具
- [ ] Legacy Adapter 仍能工作（向后兼容）

---

## 📝 FAQ

**Q: 迁移后原有的工具版本历史会丢失吗？**

A: 版本历史会保存在 README.md 中作为参考。如需完整的版本管理，建议使用 Git。

**Q: 迁移后 Agent 能立即使用新的 Skills 吗？**

A: 是的。CapabilityRegistry 会自动从 SkillPlatform 加载工具。

**Q: 如果迁移出错怎么办？**

A: 
1. 恢复备份：`cp data/agent-tools.json.backup data/agent-tools.json`
2. 删除 Skills 目录：`rm -rf data/skills`
3. 查看日志：`cat data/migration.log`
4. 修复问题后重新运行迁移

**Q: 可以同时保留两套系统吗？**

A: 可以。在过渡期可以并行运行，但长期建议只保留 Skills 系统。

**Q: 内置工具怎么处理？**

A: 
- 简单的内置工具可以重新实现
- 复杂的暂时通过 Legacy Adapter 调用
- 逐步替换为纯 Skills 实现

---

## 🎯 下一步

迁移完成后，建议：

1. ✅ 在团队内部试用 2 周
2. ✅ 收集反馈，优化界面
3. ✅ 补充文档和使用教程
4. ✅ 逐步重新实现内置工具
5. ✅ 在 v3.0 完全移除传统工具

---

## 📞 支持

如有问题，请查看：
- `docs/LEGACY_TOOLS_ANALYSIS.md` - 详细分析
- `docs/INTERFACE_MIGRATION.md` - 界面整合方案
- `data/MIGRATION_REPORT.md` - 迁移报告（迁移后生成）
