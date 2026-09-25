<script setup lang="ts">
import BrowserPluginCard from './BrowserPluginCard.vue'
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import {ElMessage} from 'element-plus'
const SkillCodeEditor = defineAsyncComponent(() => import('./SkillCodeEditor.vue'))
import AgentCapabilityRegistry from './AgentCapabilityRegistry.vue'
import {AppMessageBox as ElMessageBox} from './message-box'
import {
  Refresh,
  Check,
  VideoPlay,
  Search,
  EditPen,
  Document,
  Warning,
  MagicStick,
  FolderOpened,
  Plus,
  Operation
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
type Filter = string

// 状态
const skills = ref<SkillInfo[]>([])
const selectedSkill = ref<string>('')
const busy = ref(false)
const error = ref('')
const query = ref('')
const filter = ref<Filter>('all')
const section = ref<Section>('info')
const view = ref<'manage' | 'capabilities'>('manage')

// 编辑状态
const editingFile = ref<'skill.json' | 'index.py' | 'engine.py' | 'README.md'>('skill.json')
const skillJsonContent = ref('')
const indexPyContent = ref('')
const enginePyContent = ref<string | null>(null)
const readmeContent = ref('')
const baseline = ref('')

const editorContent = computed({
  get: () => editingFile.value === 'skill.json' ? skillJsonContent.value : editingFile.value === 'index.py' ? indexPyContent.value : editingFile.value === 'engine.py' ? enginePyContent.value || '' : readmeContent.value,
  set: (value: string) => {
    if (editingFile.value === 'skill.json') skillJsonContent.value = value
    else if (editingFile.value === 'index.py') indexPyContent.value = value
    else if (editingFile.value === 'engine.py') enginePyContent.value = value
    else readmeContent.value = value
  }
})

// 测试状态
const testTool = ref('')
const testArgs = ref('{}')
const testOutput = ref('')
const testWorkspace = ref('')

// 计算属性
const selected = computed(() => skills.value.find(s => s.name === selectedSkill.value))

const categories = computed(() => [...new Set(skills.value.map(skill => skill.category))])
const enabledCount = computed(() => skills.value.filter(skill => skill.loaded).length)
const currentTool = computed(() => selected.value?.tools.find(tool => tool.name === testTool.value))
const snapshot = () => JSON.stringify({skillJson: skillJsonContent.value, indexPy: indexPyContent.value, enginePy: enginePyContent.value, readme: readmeContent.value})

const filtered = computed(() => {
  const word = query.value.trim().toLowerCase()
  return skills.value.filter(skill => {
    // 过滤分类
    if (filter.value !== 'all' && skill.category !== filter.value) {
      return false
    }
    // 过滤搜索词
    if (word) {
      return [skill.name, skill.displayName, skill.description, ...skill.tools.flatMap(tool => [tool.name, tool.description])]
        .some(v => v.toLowerCase().includes(word))
    }
    return true
  })
})

const categoryLabel = (category: string) => {
  const labels: Record<string, string> = {
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

const dirty = computed(() => !!selected.value && snapshot() !== baseline.value)

async function load() {
  skills.value = await window.myplane.localAiStudio('skillsList')
  if (!testWorkspace.value) testWorkspace.value = await window.myplane.localAiStudio('getDefaultWorkspace')
}

async function refresh() {
  await run(async () => {
    await window.myplane.localAiStudio('skillsReload')
    await load()
    ElMessage.success('已刷新插件')
  })
}

async function loadSkillContent(skill: SkillInfo) {
  try {
    const content = await window.myplane.localAiStudio('skillGetContent', {
      skillName: skill.name
    })

    selectedSkill.value = skill.name
    editingFile.value = 'skill.json'
    skillJsonContent.value = JSON.stringify(content.skillJson, null, 2)
    indexPyContent.value = content.indexPy
    enginePyContent.value = content.enginePy
    readmeContent.value = content.readme

    baseline.value = snapshot()

    section.value = 'info'
    testTool.value = skill.tools[0]?.name || ''
    testArgs.value = '{}'
    testOutput.value = ''
  } catch (e) {
    throw new Error(`加载插件内容失败: ${e}`)
  }
}

async function selectSkill(skillName: string) {
  if (busy.value || skillName === selectedSkill.value) return

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

  const skill = skills.value.find(s => s.name === skillName)
  if (skill) {
    await run(() => loadSkillContent(skill))
  }
}

async function compileSkill() {
  if (!selected.value) return
  await run(async () => {
    await window.myplane.localAiStudio('skillCompile', {skillName: selected.value!.name, indexPy: indexPyContent.value, enginePy: enginePyContent.value})
    ElMessage.success('Python 编译通过')
  })
}

async function saveSkill() {
  if (!selected.value) return

  await run(async () => {
    try {
      const skillName = selected.value!.name
      const activeSection = section.value
      const activeFile = editingFile.value
      const skillJson = JSON.parse(skillJsonContent.value)

      await window.myplane.localAiStudio('skillSave', {
        skillName: selected.value!.name,
        skillJson,
        indexPy: indexPyContent.value,
        enginePy: enginePyContent.value,
        readme: readmeContent.value
      })

      await load()

      // 重新加载内容以更新 baseline
      const skill = skills.value.find(s => s.name === skillName)
      if (skill) {
        await loadSkillContent(skill)
      }

      section.value = activeSection
      editingFile.value = activeFile
      ElMessage.success('已保存并加载，可在对话中使用')
    } catch (e) {
      throw new Error(`保存失败: ${e}`)
    }
  })
}

async function testSkillTool() {
  if (!selected.value || !testTool.value || dirty.value) return

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

async function deleteSelectedSkill(){
  const skill=selected.value;if(!skill||busy.value)return
  try{await ElMessageBox.confirm(`删除“${skill.displayName}”后，其工具将不可用，插件文件会移到回收站。${dirty.value?'未保存的修改将丢失。':''}`,'删除插件',{type:'warning',confirmButtonText:'删除插件',cancelButtonText:'取消'})}catch{return}
  await run(async()=>{
    await window.myplane.localAiStudio('skillDelete',{skillName:skill.name})
    selectedSkill.value='';baseline.value='';testOutput.value=''
    await load()
    if(filtered.value[0])await loadSkillContent(filtered.value[0])
    ElMessage.success('插件已删除，文件已移到回收站')
  })
}

async function createNewSkill() {
  if (busy.value) return
  if (dirty.value) {
    try { await ElMessageBox.confirm('当前修改尚未保存，创建后将离开此插件。', '放弃未保存修改？', {confirmButtonText: '放弃修改', cancelButtonText: '继续编辑'}) } catch { return }
  }
  try {
    const { value: skillName } = await ElMessageBox.prompt(
      '输入插件标识（小写字母、数字、连字符）',
      '创建新插件',
      {
        confirmButtonText: '创建',
        cancelButtonText: '取消',
        inputPattern: /^[a-z][a-z0-9-]{0,63}$/,
        inputErrorMessage: '插件标识格式不正确'
      }
    )

    await run(async () => {
      await window.myplane.localAiStudio('skillCreate', {
        skillName: skillName.trim()
      })
      await load()
      const skill = skills.value.find(s => s.name === skillName.trim())
      if (skill) {
        await loadSkillContent(skill)
      }
      ElMessage.success(`插件 ${skillName} 已创建`)
    })
  } catch {
    // 用户取消
  }
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

onMounted(() => run(async () => {
  await load()
  if (skills.value[0]) await loadSkillContent(skills.value[0])
}))
async function createFromToolbar(){view.value='manage';await createNewSkill()}
defineExpose({ create: createFromToolbar })
</script>

<template>
  <main class="skill-manager" :aria-busy="busy">
    <nav class="skill-view-tabs" aria-label="插件页面">
      <button type="button" :class="{active:view==='manage'}" :aria-current="view==='manage'?'page':undefined" @click="view='manage'">插件管理</button>
      <button type="button" :class="{active:view==='capabilities'}" :aria-current="view==='capabilities'?'page':undefined" @click="view='capabilities'">可用能力</button>
    </nav>
    <p v-if="error" class="skill-error" role="alert">
      <Warning />
      <span>{{ error }}</span>
      <button @click="error = ''">关闭</button>
    </p>

    <BrowserPluginCard v-if="view==='manage'"/>
    <div v-show="view==='manage'" class="skill-layout">
      <!-- 左侧：插件列表 -->
      <aside class="skill-browser">
        <header class="browser-head">
          <div>
            <h2>插件管理</h2>
            <span>{{ skills.length }} 个插件 · {{ enabledCount }} 个已启用</span>
          </div>
          <button
            class="icon-action"
            :disabled="busy"
            title="刷新插件"
            @click="refresh"
          >
            <Refresh />
          </button>
        </header>

        <div class="browser-actions">
          <button class="primary-button" :disabled="busy" @click="createNewSkill">
            <Plus /> 新建插件
          </button>
        </div>

        <div class="skill-search">
          <Search />
          <input
            v-model="query"
            placeholder="搜索插件..."
            aria-label="搜索插件"
          />
        </div>

        <label class="skill-filters"><span>分类</span><select v-model="filter" aria-label="筛选插件分类"><option value="all">全部分类</option><option v-for="cat in categories" :key="cat" :value="cat">{{ categoryLabel(cat) }}</option></select><small>{{ filtered.length }} 项</small></label>

        <div class="skill-list">
          <button
            v-for="skill in filtered"
            :key="skill.name"
            :class="{
              active: selectedSkill === skill.name,
              'not-loaded': !skill.loaded
            }"
            :disabled="busy" :aria-pressed="selectedSkill === skill.name" @click="selectSkill(skill.name)"
          >
            <span class="skill-icon"><Operation /></span>
            <span class="skill-copy">
              <span class="skill-primary">
                <strong :title="skill.displayName">{{ skill.displayName }}</strong>
                <i :class="{ loaded: skill.loaded }" :title="skill.loaded ? '已启用' : '未启用'" />
              </span>
              <small>
                <code>{{ skill.name }}</code>
                <span>{{ skill.tools.length }} 个工具</span>
              </small>
            </span>
          </button>

          <div v-if="!filtered.length" class="empty-skills">
            <Search />
            <p>{{ busy ? '正在加载插件…' : skills.length ? '没有匹配的插件' : '还没有插件' }}</p>
            <button v-if="query || filter !== 'all'" class="text-button" @click="query = ''; filter = 'all'">
              清除筛选
            </button>
          </div>
        </div>
      </aside>

      <!-- 右侧：插件详情/编辑 -->
      <section class="skill-editor">
        <div v-if="!selected" class="empty-editor">
          <FolderOpened />
          <p>选择一个插件开始管理</p>
          <button class="primary-button" :disabled="busy" @click="createNewSkill">
            <Plus /> 创建新插件
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
              <button class="secondary-button plugin-delete" :disabled="busy" @click="deleteSelectedSkill">删除插件</button>
              <button class="secondary-button" :disabled="busy" @click="compileSkill">编译校验</button>
              <button
                class="primary-button"
                :disabled="busy || !dirty"
                @click="saveSkill"
              >
                <Check /> 保存并使用
              </button>
            </div>
          </header>

          <nav class="editor-tabs">
            <button
              :class="{ active: section === 'info' }"
              @click="section = 'info'"
            >
              <Document /> 概览
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
            <p class="skill-description">{{ selected.description || '尚未添加描述' }}</p>
            <div class="overview-badges"><span :class="{enabled:selected.loaded}">{{ selected.loaded ? '已启用' : '未启用' }}</span><span>{{ selected.runtime }}</span><span>{{ selected.tools.length }} 个工具</span></div>
            <section class="info-section">
              <h3>基本信息</h3>
              <dl>
                <dt>插件标识</dt>
                <dd><code>{{ selected.name }}</code></dd>

                <dt>显示名称</dt>
                <dd>{{ selected.displayName }}</dd>

                <dt>版本</dt>
                <dd>{{ selected.version }}</dd>

                <dt>分类</dt>
                <dd>{{ categoryLabel(selected.category) }}</dd>

                <dt>运行时</dt>
                <dd>{{ selected.runtime }}</dd>

                <dt>本地目录</dt>
                <dd class="skill-path">{{ selected.skillPath }}</dd>
              </dl>
            </section>

            <section class="info-section">
              <h3>提供的工具 ({{ selected.tools.length }})</h3>
              <div class="tools-list">
                <div v-for="tool in selected.tools" :key="tool.name" class="tool-card">
                  <div class="tool-heading"><code>{{ tool.name }}</code><button class="text-button" @click="testTool = tool.name; section = 'test'">测试 <VideoPlay /></button></div>
                  <p>{{ tool.description }}</p>
                  <details v-if="tool.inputSchema" class="tool-schema"><summary>参数说明</summary><pre>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre></details>
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
              <button v-if="enginePyContent !== null" :class="{ active: editingFile === 'engine.py' }" @click="editingFile = 'engine.py'">engine.py</button>
              <button
                :class="{ active: editingFile === 'README.md' }"
                @click="editingFile = 'README.md'"
              >
                README.md
              </button>
            </div>

            <div class="editor-toolbar">
              <span>{{ editingFile }} · {{ dirty ? '有未保存修改' : '已保存' }}</span>
              <button
                v-if="editingFile === 'skill.json'"
                class="text-button"
                :disabled="busy" @click="formatJson('skillJson')"
              >
                <MagicStick /> 格式化
              </button>
            </div>

            <SkillCodeEditor :key="selected.name" v-model="editorContent" :filename="editingFile" :readonly="busy" @save="saveSkill"/>
          </div>

          <!-- 测试面板 -->
          <div v-show="section === 'test'" class="editor-pane test-pane">
            <section class="test-section">
              <header>
                <h3>测试工具</h3>
                <button
                  class="primary-button"
                  :disabled="busy || !testTool || dirty"
                  @click="testSkillTool"
                >
                  <VideoPlay /> 运行测试
                </button>
              </header>

              <p class="test-hint">测试会实际执行工具，使用已保存的版本。{{ dirty ? '当前有修改，请先保存并使用。' : '' }}</p><p v-if="currentTool" class="test-hint">{{ currentTool.description }}</p><details v-if="currentTool?.inputSchema" class="tool-schema"><summary>查看参数格式</summary><pre>{{ JSON.stringify(currentTool.inputSchema, null, 2) }}</pre></details>
              <div class="test-controls">
                <label>
                  <span>选择工具</span>
                  <select v-model="testTool" :disabled="busy">
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
                  <input v-model="testWorkspace" :disabled="busy" placeholder="/path/to/workspace" />
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
                    :readonly="busy"
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
    <section v-if="view==='capabilities'" class="skill-capability-view" aria-label="可用能力"><AgentCapabilityRegistry/></section>
  </main>
</template>

<style scoped src="./skill-manager.css"></style>

<style scoped>button.plugin-delete{color:var(--s-danger);border-color:transparent}button.plugin-delete:hover{border-color:var(--s-danger)}</style>
