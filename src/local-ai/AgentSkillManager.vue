<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Refresh,
  Check,
  VideoPlay,
  Clock,
  Search,
  EditPen,
  Document,
  Warning,
  MagicStick,
  FolderOpened,
  Plus,
  Download,
  Upload
} from '@element-plus/icons-vue'

// 类型定义
interface SkillTool {
  name: string
  description: string
  inputSchema: any
}

interface SkillInfo {
  name: string
  displayName: string
  description: string
  version: string
  runtime: string
  category: string
  tools: SkillTool[]
  skillPath: string
  loaded: boolean
  metadata?: any
}

type Section = 'edit' | 'test' | 'info'
type Filter = 'all' | 'file' | 'git' | 'network' | 'system' | 'general'

// 状态
const skills = ref<SkillInfo[]>([])
const selectedSkill = ref<string>('')
const busy = ref(false)
const error = ref('')
const query = ref('')
const filter = ref<Filter>('all')
const section = ref<Section>('info')

// 编辑状态
const editingFile = ref<'skill.json' | 'index.py' | 'README.md'>('skill.json')
const skillJsonContent = ref('')
const indexPyContent = ref('')
const readmeContent = ref('')
const baseline = ref('')

// 测试状态
const testTool = ref('')
const testArgs = ref('{}')
const testOutput = ref('')
const testWorkspace = ref('')

// 计算属性
const selected = computed(() => skills.value.find(s => s.name === selectedSkill.value))

const counts = computed(() => ({
  all: skills.value.length,
  file: skills.value.filter(s => s.category === 'file').length,
  git: skills.value.filter(s => s.category === 'git').length,
  network: skills.value.filter(s => s.category === 'network').length,
  system: skills.value.filter(s => s.category === 'system').length,
  general: skills.value.filter(s => s.category === 'general').length
}))

const filtered = computed(() => {
  const word = query.value.trim().toLowerCase()
  return skills.value.filter(skill => {
    // 过滤分类
    if (filter.value !== 'all' && skill.category !== filter.value) {
      return false
    }
    // 过滤搜索词
    if (word) {
      return [skill.name, skill.displayName, skill.description]
        .some(v => v.toLowerCase().includes(word))
    }
    return true
  })
})

const categoryIcon = (category: string) => {
  const icons = {
    file: '📁',
    git: '🔧',
    network: '🌐',
    system: '⚙️',
    document: '📄',
    test: '🧪',
    general: '🔨'
  }
  return icons[category] || '📦'
}

const categoryLabel = (category: string) => {
  const labels = {
    file: '文件',
    git: 'Git',
    network: '网络',
    system: '系统',
    document: '文档',
    test: '测试',
    general: '通用'
  }
  return labels[category] || category
}

const dirty = computed(() => {
  if (!selected.value) return false
  const current = JSON.stringify({
    skillJson: skillJsonContent.value,
    indexPy: indexPyContent.value,
    readme: readmeContent.value
  })
  return current !== baseline.value
})

// 方法
async function load() {
  busy.value = true
  error.value = ''
  try {
    skills.value = await window.myplane.localAiStudio('skillsList')
    if (!testWorkspace.value) {
      testWorkspace.value = await window.myplane.localAiStudio('getDefaultWorkspace')
    }
  } catch (e) {
    error.value = String(e).replace(/^Error: /, '')
  } finally {
    busy.value = false
  }
}

async function refresh() {
  await run(async () => {
    await window.myplane.localAiStudio('skillsReload')
    await load()
    ElMessage.success('已刷新 Skills')
  })
}

async function loadSkillContent(skill: SkillInfo) {
  try {
    const content = await window.myplane.localAiStudio('skillGetContent', {
      skillName: skill.name
    })

    skillJsonContent.value = JSON.stringify(content.skillJson, null, 2)
    indexPyContent.value = content.indexPy
    readmeContent.value = content.readme

    baseline.value = JSON.stringify({
      skillJson: skillJsonContent.value,
      indexPy: indexPyContent.value,
      readme: readmeContent.value
    })

    section.value = 'info'
    testTool.value = skill.tools[0]?.name || ''
    testArgs.value = '{}'
    testOutput.value = ''
  } catch (e) {
    error.value = `加载 Skill 内容失败: ${e}`
  }
}

async function selectSkill(skillName: string) {
  if (skillName === selectedSkill.value) return

  if (dirty.value) {
    try {
      await ElMessageBox.confirm(
        '当前修改尚未保存，离开后将丢失。',
        '放弃未保存修改？',
        {
          confirmButtonText: '放弃修改',
          cancelButtonText: '继续编辑',
          type: 'warning'
        }
      )
    } catch {
      return
    }
  }

  selectedSkill.value = skillName
  const skill = skills.value.find(s => s.name === skillName)
  if (skill) {
    await loadSkillContent(skill)
  }
}

async function saveSkill() {
  if (!selected.value) return

  await run(async () => {
    try {
      const skillJson = JSON.parse(skillJsonContent.value)

      await window.myplane.localAiStudio('skillSave', {
        skillName: selected.value!.name,
        skillJson,
        indexPy: indexPyContent.value,
        readme: readmeContent.value
      })

      await refresh()

      // 重新加载内容以更新 baseline
      const skill = skills.value.find(s => s.name === selected.value!.name)
      if (skill) {
        await loadSkillContent(skill)
      }

      ElMessage.success('Skill 已保存')
    } catch (e) {
      throw new Error(`保存失败: ${e}`)
    }
  })
}

async function testSkillTool() {
  if (!selected.value || !testTool.value) return

  await run(async () => {
    try {
      const args = JSON.parse(testArgs.value)

      const result = await window.myplane.localAiStudio('skillTestTool', {
        skillName: selected.value!.name,
        toolName: testTool.value,
        args,
        workspace: testWorkspace.value
      })

      try {
        testOutput.value = JSON.stringify(JSON.parse(result.output), null, 2)
      } catch {
        testOutput.value = result.output
      }

      testOutput.value += `\n\n耗时: ${result.elapsedMs}ms`
    } catch (e) {
      testOutput.value = `测试失败:\n${e}`
    }
  })
}

async function createNewSkill() {
  try {
    const { value: skillName } = await ElMessageBox.prompt(
      '输入 Skill 标识（小写字母、数字、连字符）',
      '创建新 Skill',
      {
        confirmButtonText: '创建',
        cancelButtonText: '取消',
        inputPattern: /^[a-z][a-z0-9-]{0,63}$/,
        inputErrorMessage: 'Skill 标识格式不正确'
      }
    )

    await run(async () => {
      await window.myplane.localAiStudio('skillCreate', {
        skillName: skillName.trim()
      })
      await refresh()
      selectedSkill.value = skillName.trim()
      const skill = skills.value.find(s => s.name === skillName.trim())
      if (skill) {
        await loadSkillContent(skill)
      }
      ElMessage.success(`Skill ${skillName} 已创建`)
    })
  } catch {
    // 用户取消
  }
}

async function importSkill() {
  ElMessage.info('导入功能开发中...')
}

async function exportSkill() {
  if (!selected.value) return
  ElMessage.info('导出功能开发中...')
}

function formatJson(field: 'skillJson' | 'args') {
  try {
    if (field === 'skillJson') {
      const parsed = JSON.parse(skillJsonContent.value)
      skillJsonContent.value = JSON.stringify(parsed, null, 2)
    } else {
      const parsed = JSON.parse(testArgs.value)
      testArgs.value = JSON.stringify(parsed, null, 2)
    }
  } catch (e) {
    error.value = `JSON 格式错误: ${e}`
  }
}

async function run(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await work()
  } catch (e) {
    error.value = String(e).replace(/^Error: /, '')
  } finally {
    busy.value = false
  }
}

onMounted(() => run(load))
</script>

<template>
  <main class="skill-manager">
    <p v-if="error" class="skill-error" role="alert">
      <Warning />
      <span>{{ error }}</span>
      <button @click="error = ''">关闭</button>
    </p>

    <div class="skill-layout">
      <!-- 左侧：Skill 列表 -->
      <aside class="skill-browser">
        <header class="browser-head">
          <div>
            <h2>Skills 管理</h2>
            <span>{{ counts.all }} 个 Skill · Python Native</span>
          </div>
          <button
            class="icon-action"
            :disabled="busy"
            title="刷新 Skills"
            @click="refresh"
          >
            <Refresh />
          </button>
        </header>

        <div class="browser-actions">
          <button class="primary-button" @click="createNewSkill">
            <Plus /> 新建 Skill
          </button>
          <button class="secondary-button" @click="importSkill">
            <Upload /> 导入
          </button>
        </div>

        <div class="skill-search">
          <Search />
          <input
            v-model="query"
            placeholder="搜索 Skill..."
            aria-label="搜索 Skill"
          />
        </div>

        <div class="skill-filters">
          <button
            v-for="cat in ['all', 'file', 'git', 'network', 'system', 'general'] as const"
            :key="cat"
            :class="{ active: filter === cat }"
            @click="filter = cat"
          >
            {{ cat === 'all' ? '全部' : categoryLabel(cat) }}
            <span>{{ counts[cat] }}</span>
          </button>
        </div>

        <div class="skill-list">
          <button
            v-for="skill in filtered"
            :key="skill.name"
            :class="{
              active: selectedSkill === skill.name,
              'not-loaded': !skill.loaded
            }"
            @click="selectSkill(skill.name)"
          >
            <span class="skill-icon">{{ categoryIcon(skill.category) }}</span>
            <span class="skill-copy">
              <span class="skill-primary">
                <strong>{{ skill.displayName }}</strong>
                <i :class="{ loaded: skill.loaded }" />
              </span>
              <small>
                <code>{{ skill.name }}</code>
                <span>{{ skill.tools.length }} 个工具</span>
              </small>
            </span>
          </button>

          <div v-if="!filtered.length" class="empty-skills">
            <Search />
            <p>没有匹配的 Skill</p>
            <button v-if="query" class="text-button" @click="query = ''">
              清除搜索
            </button>
          </div>
        </div>
      </aside>

      <!-- 右侧：Skill 详情/编辑 -->
      <section class="skill-editor">
        <div v-if="!selected" class="empty-editor">
          <FolderOpened />
          <p>选择一个 Skill 开始管理</p>
          <button class="primary-button" @click="createNewSkill">
            <Plus /> 创建新 Skill
          </button>
        </div>

        <template v-else>
          <header class="editor-head">
            <div>
              <div class="editor-title">
                <h2>{{ selected.displayName }}</h2>
                <span v-if="dirty" class="unsaved">未保存</span>
                <span v-else class="saved">{{ selected.version }}</span>
              </div>
              <p>{{ selected.name }} · {{ categoryLabel(selected.category) }}</p>
            </div>
            <div class="editor-actions">
              <button
                class="secondary-button"
                :disabled="busy"
                @click="exportSkill"
              >
                <Download /> 导出
              </button>
              <button
                class="primary-button"
                :disabled="busy || !dirty"
                @click="saveSkill"
              >
                <Check /> 保存
              </button>
            </div>
          </header>

          <nav class="editor-tabs">
            <button
              :class="{ active: section === 'info' }"
              @click="section = 'info'"
            >
              <Document /> 信息
            </button>
            <button
              :class="{ active: section === 'edit' }"
              @click="section = 'edit'"
            >
              <EditPen /> 编辑
            </button>
            <button
              :class="{ active: section === 'test' }"
              @click="section = 'test'"
            >
              <VideoPlay /> 测试
            </button>
          </nav>

          <!-- 信息面板 -->
          <div v-show="section === 'info'" class="editor-pane info-pane">
            <section class="info-section">
              <h3>基本信息</h3>
              <dl>
                <dt>Skill 标识</dt>
                <dd><code>{{ selected.name }}</code></dd>

                <dt>显示名称</dt>
                <dd>{{ selected.displayName }}</dd>

                <dt>版本</dt>
                <dd>{{ selected.version }}</dd>

                <dt>分类</dt>
                <dd>{{ categoryLabel(selected.category) }}</dd>

                <dt>运行时</dt>
                <dd>{{ selected.runtime }}</dd>

                <dt>描述</dt>
                <dd>{{ selected.description }}</dd>
              </dl>
            </section>

            <section class="info-section">
              <h3>包含的工具 ({{ selected.tools.length }})</h3>
              <div class="tools-list">
                <div v-for="tool in selected.tools" :key="tool.name" class="tool-card">
                  <code>{{ tool.name }}</code>
                  <p>{{ tool.description }}</p>
                </div>
              </div>
            </section>
          </div>

          <!-- 编辑面板 -->
          <div v-show="section === 'edit'" class="editor-pane edit-pane">
            <div class="file-tabs">
              <button
                :class="{ active: editingFile === 'skill.json' }"
                @click="editingFile = 'skill.json'"
              >
                skill.json
              </button>
              <button
                :class="{ active: editingFile === 'index.py' }"
                @click="editingFile = 'index.py'"
              >
                index.py
              </button>
              <button
                :class="{ active: editingFile === 'README.md' }"
                @click="editingFile = 'README.md'"
              >
                README.md
              </button>
            </div>

            <div class="editor-toolbar">
              <span>{{ editingFile }}</span>
              <button
                v-if="editingFile === 'skill.json'"
                class="text-button"
                @click="formatJson('skillJson')"
              >
                <MagicStick /> 格式化
              </button>
            </div>

            <textarea
              v-if="editingFile === 'skill.json'"
              v-model="skillJsonContent"
              spellcheck="false"
              class="code-editor"
            />
            <textarea
              v-else-if="editingFile === 'index.py'"
              v-model="indexPyContent"
              spellcheck="false"
              class="code-editor"
            />
            <textarea
              v-else
              v-model="readmeContent"
              spellcheck="false"
              class="code-editor"
            />
          </div>

          <!-- 测试面板 -->
          <div v-show="section === 'test'" class="editor-pane test-pane">
            <section class="test-section">
              <header>
                <h3>测试工具</h3>
                <button
                  class="primary-button"
                  :disabled="busy || !testTool"
                  @click="testSkillTool"
                >
                  <VideoPlay /> 运行测试
                </button>
              </header>

              <div class="test-controls">
                <label>
                  <span>选择工具</span>
                  <select v-model="testTool">
                    <option value="">选择要测试的工具</option>
                    <option
                      v-for="tool in selected.tools"
                      :key="tool.name"
                      :value="tool.name"
                    >
                      {{ tool.name }}
                    </option>
                  </select>
                </label>

                <label>
                  <span>工作目录</span>
                  <input v-model="testWorkspace" placeholder="/path/to/workspace" />
                </label>

                <label>
                  <span>
                    参数 JSON
                    <button class="text-button" @click="formatJson('args')">
                      <MagicStick /> 格式化
                    </button>
                  </span>
                  <textarea
                    v-model="testArgs"
                    rows="10"
                    spellcheck="false"
                  />
                </label>
              </div>

              <div v-if="testOutput" class="test-result">
                <header>
                  <strong>执行结果</strong>
                  <button class="text-button" @click="testOutput = ''">
                    清除
                  </button>
                </header>
                <pre>{{ testOutput }}</pre>
              </div>
            </section>
          </div>
        </template>
      </section>
    </div>
  </main>
</template>

<style scoped>
.skill-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.skill-error {
  background: #fef0f0;
  color: #f56c6c;
  padding: 12px 16px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #fbc4c4;
}

.skill-error button {
  margin-left: auto;
  padding: 4px 12px;
  background: transparent;
  border: 1px solid #f56c6c;
  color: #f56c6c;
  border-radius: 4px;
  cursor: pointer;
}

.skill-layout {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧浏览器 */
.skill-browser {
  width: 320px;
  background: white;
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

.browser-head h2 {
  margin: 0 0 4px 0;
  font-size: 18px;
}

.browser-head span {
  font-size: 13px;
  color: #666;
}

.icon-action {
  padding: 8px;
  background: transparent;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-action:hover:not(:disabled) {
  background: #f5f5f5;
}

.icon-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.browser-actions {
  padding: 12px 20px;
  display: flex;
  gap: 8px;
  border-bottom: 1px solid #e0e0e0;
}

.primary-button {
  flex: 1;
  padding: 8px 16px;
  background: #409eff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 14px;
}

.primary-button:hover:not(:disabled) {
  background: #66b1ff;
}

.primary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-button {
  padding: 8px 16px;
  background: white;
  color: #606266;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.secondary-button:hover:not(:disabled) {
  background: #f5f5f5;
}

.skill-search {
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #e0e0e0;
}

.skill-search input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
}

.skill-filters {
  display: flex;
  flex-wrap: wrap;
  padding: 12px 20px;
  gap: 8px;
  border-bottom: 1px solid #e0e0e0;
}

.skill-filters button {
  padding: 6px 12px;
  background: white;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.skill-filters button.active {
  background: #409eff;
  color: white;
  border-color: #409eff;
}

.skill-filters button span {
  opacity: 0.7;
  font-size: 12px;
}

.skill-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.skill-list > button {
  width: 100%;
  padding: 12px;
  margin-bottom: 6px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: all 0.2s;
}

.skill-list > button:hover {
  background: #f5f5f5;
  border-color: #409eff;
}

.skill-list > button.active {
  background: #ecf5ff;
  border-color: #409eff;
}

.skill-list > button.not-loaded {
  opacity: 0.6;
}

.skill-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.skill-copy {
  flex: 1;
  min-width: 0;
}

.skill-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.skill-primary strong {
  font-size: 14px;
}

.skill-primary i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ddd;
}

.skill-primary i.loaded {
  background: #67c23a;
}

.skill-copy small {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #909399;
}

.skill-copy code {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
}

.empty-skills {
  text-align: center;
  padding: 40px 20px;
  color: #909399;
}

.empty-skills svg {
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  opacity: 0.3;
}

/* 右侧编辑器 */
.skill-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  overflow: hidden;
}

.empty-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #909399;
  gap: 16px;
}

.empty-editor svg {
  width: 64px;
  height: 64px;
  opacity: 0.3;
}

.editor-head {
  padding: 20px 24px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.editor-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.editor-title h2 {
  margin: 0;
  font-size: 20px;
}

.unsaved, .saved {
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
}

.unsaved {
  background: #fef0f0;
  color: #f56c6c;
}

.saved {
  background: #f0f9ff;
  color: #409eff;
}

.editor-actions {
  display: flex;
  gap: 8px;
}

.editor-tabs {
  display: flex;
  border-bottom: 1px solid #e0e0e0;
}

.editor-tabs button {
  padding: 12px 24px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #606266;
  transition: all 0.2s;
}

.editor-tabs button:hover {
  color: #409eff;
}

.editor-tabs button.active {
  color: #409eff;
  border-bottom-color: #409eff;
}

.editor-pane {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

/* 信息面板 */
.info-section {
  margin-bottom: 32px;
}

.info-section h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: #303133;
}

.info-section dl {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px;
  margin: 0;
}

.info-section dt {
  color: #909399;
  font-size: 14px;
}

.info-section dd {
  margin: 0;
  color: #303133;
  font-size: 14px;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-card {
  padding: 12px 16px;
  background: #f5f5f5;
  border-radius: 8px;
}

.tool-card code {
  display: block;
  font-size: 13px;
  color: #409eff;
  margin-bottom: 6px;
}

.tool-card p {
  margin: 0;
  font-size: 13px;
  color: #606266;
}

/* 编辑面板 */
.edit-pane {
  display: flex;
  flex-direction: column;
  padding: 0;
}

.file-tabs {
  display: flex;
  border-bottom: 1px solid #e0e0e0;
  padding: 0 24px;
}

.file-tabs button {
  padding: 12px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  color: #606266;
}

.file-tabs button.active {
  color: #409eff;
  border-bottom-color: #409eff;
}

.editor-toolbar {
  padding: 12px 24px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.editor-toolbar span {
  font-size: 13px;
  color: #909399;
  font-family: monospace;
}

.text-button {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
}

.text-button:hover {
  color: #409eff;
  border-color: #409eff;
}

.code-editor {
  flex: 1;
  padding: 16px 24px;
  border: none;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  background: #fafafa;
}

/* 测试面板 */
.test-section {
  max-width: 800px;
}

.test-section > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.test-section h3 {
  margin: 0;
  font-size: 16px;
}

.test-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.test-controls label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-controls label > span {
  font-size: 14px;
  color: #606266;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.test-controls input,
.test-controls select,
.test-controls textarea {
  padding: 8px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}

.test-controls textarea {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  resize: vertical;
}

.test-result {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.test-result > header {
  padding: 12px 16px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.test-result pre {
  padding: 16px;
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
}
</style>
