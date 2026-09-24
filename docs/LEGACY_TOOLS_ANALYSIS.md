# 传统工具系统存废分析

传统工具系统是否还有必要存在？

---

## 📊 功能对比

### 传统工具系统

**优势**：
- ✅ **版本管理完善** - 每次修改都保存版本，可以恢复任意历史版本
- ✅ **在线编辑方便** - 界面直接编辑 Python 代码和参数 Schema
- ✅ **测试功能集成** - 内置测试功能，可以立即验证
- ✅ **风险等级控制** - 细粒度的风险管理（read/write/high）
- ✅ **变更记录** - 每个版本都有变更说明

**劣势**：
- ❌ **架构独立** - 与新的 5 层架构不兼容
- ❌ **数据孤立** - 存储在数据库，不便于分享和备份
- ❌ **单工具粒度** - 每个工具独立管理，缺乏分组
- ❌ **扩展性差** - 只支持 Python，无法扩展到其他运行时
- ❌ **维护成本高** - 需要维护独立的存储、版本、测试系统

### 新 Skills 系统

**优势**：
- ✅ **架构统一** - 完全融入 5 层架构
- ✅ **模块化** - 一个 Skill 包含多个相关工具
- ✅ **易于分享** - 基于文件系统，可以 git 管理
- ✅ **标准化** - skill.json 标准格式，易于理解
- ✅ **可扩展** - 支持多种运行时（Python、Node.js、Go...）
- ✅ **团队协作** - 可以通过 git 协作开发 Skills

**劣势**：
- ❌ **版本管理弱** - 依赖 git，对非技术用户不友好
- ❌ **在线编辑缺失** - 需要外部编辑器（但可以添加）
- ❌ **测试功能缺失** - 目前没有内置测试界面（但可以添加）

---

## 🎯 建议：逐步淘汰传统工具

### 理由

**1. 架构一致性**
- 新架构已经是项目的核心方向
- 维护两套系统会增加代码复杂度
- 长期来看，传统工具会成为技术债

**2. 功能可替代性**
- 传统工具的核心功能都可以在 Skills 中实现
- 缺失的功能（版本管理、在线编辑）可以补充

**3. 用户体验统一**
- 单一入口更清晰
- 避免用户困惑"应该用哪个"
- 降低学习成本

**4. 未来扩展性**
- Skills 可以支持更多运行时
- 可以引入 Skill 市场
- 更容易与社区集成

---

## 🔄 迁移方案

### 阶段 1: 补充 Skills 系统功能（2-3 周）

#### 1.1 添加在线编辑功能

在 Skills 管理界面中添加代码编辑器：

```
┌──────────────────────────────────────┐
│  编辑 Skill: file-operations         │
├──────────────────────────────────────┤
│  skill.json                          │
│  ┌────────────────────────────────┐  │
│  │ {                              │  │
│  │   "name": "file-operations",   │  │
│  │   "displayName": "文件操作",   │  │
│  │   ...                          │  │
│  │ }                              │  │
│  └────────────────────────────────┘  │
│                                      │
│  index.py                            │
│  ┌────────────────────────────────┐  │
│  │ def file_read(args):           │  │
│  │     path = args['path']        │  │
│  │     ...                        │  │
│  └────────────────────────────────┘  │
│                                      │
│  [保存]  [测试]                      │
└──────────────────────────────────────┘
```

**实现**：
- 使用 Monaco Editor（VS Code 编辑器核心）
- 直接读写文件系统中的 Skill 文件
- 保存时自动重新加载 Skill

#### 1.2 添加测试功能

```typescript
// 在 SkillPlatform 中添加测试方法
async testSkillTool(
  skillName: string,
  toolName: string,
  args: any,
  context: ExecutionContext
): Promise<any> {
  const skill = this.skills.get(skillName)
  if (!skill) throw new Error(`Skill not found: ${skillName}`)

  const tool = skill.tools.find(t => t.name === toolName)
  if (!tool) throw new Error(`Tool not found: ${toolName}`)

  return await this.runtime.executeTool(
    skillName,
    toolName,
    args,
    context
  )
}
```

在界面中添加测试面板：

```
┌──────────────────────────────────────┐
│  测试工具: file.read                 │
├──────────────────────────────────────┤
│  输入参数:                            │
│  {                                   │
│    "path": "/tmp/test.txt"          │
│  }                                   │
│                                      │
│  [运行测试]                           │
│                                      │
│  输出结果:                            │
│  {                                   │
│    "content": "hello world",        │
│    "size": 11                       │
│  }                                   │
│                                      │
│  耗时: 23ms                          │
└──────────────────────────────────────┘
```

#### 1.3 添加版本管理（基于 Git）

利用项目已有的 git 工具：

```typescript
// 自动提交 Skill 变更
async saveSkillWithVersion(
  skillName: string,
  changeNote: string
): Promise<void> {
  // 保存文件
  await this.saveSkill(skillName)

  // Git 提交
  await gitAdd(`skills/${skillName}/*`)
  await gitCommit(`Update skill: ${skillName} - ${changeNote}`)
}

// 查看版本历史
async getSkillVersions(skillName: string): Promise<SkillVersion[]> {
  const commits = await gitLog(`skills/${skillName}`)
  return commits.map(c => ({
    version: c.hash,
    message: c.message,
    timestamp: c.timestamp
  }))
}

// 恢复到某个版本
async restoreSkillVersion(
  skillName: string,
  version: string
): Promise<void> {
  await gitCheckout(version, `skills/${skillName}`)
  await this.reloadSkill(skillName)
}
```

### 阶段 2: 迁移工具（1-2 周）

#### 2.1 提供自动迁移工具

```typescript
// tools/migrate-legacy-tools.ts
import { ToolStore } from '../electron/main/agent/tool-store'
import { createSkillFromTool } from './skill-generator'

async function migrateLegacyTools() {
  const toolStore = new ToolStore(dataDir)
  const tools = await toolStore.list()

  for (const tool of tools) {
    console.log(`Migrating: ${tool.key}`)

    const skillDir = path.join(skillsDir, tool.key)
    await fs.mkdir(skillDir, { recursive: true })

    // 生成 skill.json
    const skillConfig = {
      name: tool.key,
      displayName: tool.current.name || tool.key,
      description: tool.current.description,
      version: `1.0.${tool.activeVersion}`,
      runtime: 'python-native',
      category: 'general',
      tools: [{
        name: tool.key,
        description: tool.current.description,
        inputSchema: tool.current.parameters
      }]
    }
    await fs.writeFile(
      path.join(skillDir, 'skill.json'),
      JSON.stringify(skillConfig, null, 2)
    )

    // 生成 index.py
    const pythonCode = `
${tool.current.python}

# Tool mapping for SkillPlatform
TOOLS = {
    '${tool.key}': execute
}
`
    await fs.writeFile(
      path.join(skillDir, 'index.py'),
      pythonCode
    )

    // 生成 README.md
    const readme = `# ${tool.current.name || tool.key}

${tool.current.description}

## 版本历史

${tool.versions.map(v => `- v${v.version}: ${v.changeNote || '无说明'} (${new Date(v.createdAt).toLocaleString()})`).join('\n')}

## 风险等级

${tool.current.risk}

## 超时设置

${tool.current.timeoutMs}ms
`
    await fs.writeFile(
      path.join(skillDir, 'README.md'),
      readme
    )

    console.log(`✓ Migrated: ${tool.key}`)
  }

  console.log(`\nMigration complete: ${tools.length} tools`)
}
```

运行迁移：
```bash
npm run migrate-tools
```

#### 2.2 在界面中提示迁移

```vue
<!-- 在 AgentToolManager.vue 中添加迁移提示 -->
<div v-if="legacyToolsCount > 0" class="migration-banner">
  <div class="banner-content">
    <Warning />
    <div>
      <strong>传统工具系统即将弃用</strong>
      <p>您有 {{ legacyToolsCount }} 个传统工具。建议迁移到新的 Skills 系统以获得更好的体验。</p>
    </div>
    <button @click="startMigration" class="primary-button">
      开始迁移
    </button>
  </div>
</div>
```

### 阶段 3: 标记弃用（1 周）

```vue
<!-- 在传统工具列表中添加弃用标记 -->
<div class="deprecated-notice">
  ⚠️ 此工具使用传统系统，建议迁移到 Skills
  <button @click="migrateThisTool(tool)">迁移此工具</button>
</div>
```

更新文档，说明传统工具将在下一个大版本中移除。

### 阶段 4: 移除（v3.0.0）

- 删除 `electron/main/agent/tools.ts`
- 删除 `electron/main/agent/tool-store.ts`
- 删除数据库中的工具表
- 清理相关 IPC handlers
- 更新文档

---

## 📅 时间表

```
现在 (v2.0)
├─ 阶段 1: 补充 Skills 功能 (2-3 周)
│  ├─ 在线编辑
│  ├─ 测试功能
│  └─ 版本管理
│
v2.1 (1 个月后)
├─ 阶段 2: 迁移工具 (1-2 周)
│  ├─ 自动迁移工具
│  ├─ 界面提示
│  └─ 用户迁移
│
v2.2 (2 个月后)
├─ 阶段 3: 标记弃用 (1 周)
│  ├─ 添加弃用警告
│  └─ 更新文档
│
v3.0 (3-4 个月后)
└─ 阶段 4: 完全移除
   └─ 清理代码
```

---

## 💡 过渡期策略

### 对于普通用户

**选项 1: 一键迁移（推荐）**
```
┌────────────────────────────────────┐
│  迁移传统工具到 Skills             │
├────────────────────────────────────┤
│  将自动迁移以下工具：              │
│  ✓ my_tool_1                      │
│  ✓ my_tool_2                      │
│  ✓ custom_analyzer                │
│                                    │
│  迁移后：                          │
│  • 所有功能保持不变                │
│  • 可以继续使用                    │
│  • 获得更好的组织方式              │
│                                    │
│  [开始迁移]  [稍后提醒]            │
└────────────────────────────────────┘
```

**选项 2: 手动迁移**
- 提供详细文档
- 逐个工具迁移
- 保留原工具直到确认新 Skill 工作正常

### 对于开发者

**选项 1: 使用迁移脚本**
```bash
npm run migrate-tools
```

**选项 2: 手动创建 Skill**
- 参考 `examples/migration-example-3-create-skill.ts`
- 更灵活的控制
- 可以重组和优化工具结构

---

## ✅ 决策建议

### 短期（现在 - v2.1）

**保留传统工具**，但：
1. ✅ 补充 Skills 系统的缺失功能
2. ✅ 提供迁移工具
3. ✅ 在界面中推荐使用 Skills

### 中期（v2.1 - v2.2）

**标记弃用**，但：
1. ⚠️ 在传统工具界面显示弃用警告
2. ⚠️ 新用户默认只看到 Skills
3. ⚠️ 文档说明将在 v3.0 移除

### 长期（v3.0+）

**完全移除**：
1. ❌ 删除所有传统工具代码
2. ❌ 清理数据库表
3. ✅ 只保留 Skills 系统

---

## 🎯 最终结论

**传统工具系统应该被淘汰**，理由：

1. **架构统一** - 新 5 层架构是未来方向
2. **维护成本** - 两套系统维护成本过高
3. **用户体验** - 单一系统更清晰
4. **扩展性** - Skills 可以支持更多场景

**但需要谨慎处理过渡**：

1. ✅ 补充 Skills 缺失功能
2. ✅ 提供自动迁移工具
3. ✅ 给用户充足的适应时间
4. ✅ 保持向后兼容（至少 2-3 个版本）

**推荐时间表**：
- **v2.1** (1 个月内): 功能补充 + 迁移工具
- **v2.2** (2 个月内): 标记弃用
- **v3.0** (3-4 个月内): 完全移除

这样既能保持架构清晰，又能给用户平滑的迁移体验。
