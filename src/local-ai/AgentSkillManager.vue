<script setup lang="ts">
import BrowserPluginCard from './BrowserPluginCard.vue'
import StaticPreviewPluginCard from './StaticPreviewPluginCard.vue'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import {ElMessage} from 'element-plus'
const SkillCodeEditor = defineAsyncComponent(() => import('./SkillCodeEditor.vue'))
import AgentCapabilityRegistry from './AgentCapabilityRegistry.vue'
import {AppMessageBox as ElMessageBox} from './message-box'
import {
  Refresh,
  QuestionFilled,
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
interface SkillEntry extends SkillInfo {
  sourceName?: string
  sourceDisplayName?: string
  focusedToolName?: string
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
const selectedBuiltin = ref<'browser' | 'preview' | ''>('')
const builtinPlugins = [
  {id:'browser' as const,name:'浏览器自动化',description:'网页浏览、交互与自动操作'},
  {id:'preview' as const,name:'静态网页预览',description:'本地网页预览服务'},
]
const visibleBuiltins = computed(() => (filter.value === 'all' || filter.value === 'builtin') ? builtinPlugins.filter(item => `${item.name} ${item.description}`.includes(query.value.trim())) : [])
function selectBuiltin(id: 'browser' | 'preview') { if (!busy.value && !dirty.value) selectedBuiltin.value = id }

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
const bundledToolSkills = new Set(['agent-tools', 'file-operations', 'git-operations'])
const categoryOrder = ['file', 'git', 'code', 'document', 'test', 'runtime', 'workflow', 'other']
const toolCategories: Record<string, string> = {
  inspect_project:'code', code_outline:'code', find_symbol:'code', find_references:'code', find_todos:'code', dependency_report:'code',
  read_document:'document', image_ocr:'document', pdf_ocr:'document', create_document:'document', create_spreadsheet:'document', replace_document_text:'document', update_spreadsheet_cells:'document',
  get_diagnostics:'test', run_test_case:'test', run_test:'test', inspect_build:'test', build_project:'test',
  process_status:'runtime', http_request:'runtime', run_command:'runtime', web_search:'runtime', web_fetch:'runtime',
  set_plan:'workflow'
}
function toolCategory(source: string, name: string) {
  if (source === 'git-operations' || name.startsWith('git_')) return 'git'
  if (source === 'file-operations') return 'file'
  return toolCategories[name] || 'file'
}
const entries = computed<SkillEntry[]>(() => skills.value.flatMap(skill => bundledToolSkills.has(skill.name)
  ? skill.tools.map(tool => ({...skill,name:`${skill.name}/${tool.name}`,displayName:tool.name,description:tool.description,category:toolCategory(skill.name,tool.name),tools:[tool],sourceName:skill.name,sourceDisplayName:skill.displayName,focusedToolName:tool.name}))
  : [{...skill,category:categoryOrder.includes(skill.category)?skill.category:'other'}]))
const selected = computed(() => entries.value.find(s => s.name === selectedSkill.value))

const categories = computed(() => categoryOrder.filter(category => entries.value.some(skill => skill.category === category)))
watch(categories, available => { if (filter.value !== 'all' && filter.value !== 'builtin' && !available.includes(filter.value)) filter.value = 'all' })
const toolCount = computed(() => entries.value.filter(skill => skill.focusedToolName).length)
const pluginCount = computed(() => entries.value.filter(skill => !skill.focusedToolName).length)
const currentTool = computed(() => selected.value?.tools.find(tool => tool.name === testTool.value))
const snapshot = () => JSON.stringify({skillJson: skillJsonContent.value, indexPy: indexPyContent.value, enginePy: enginePyContent.value, readme: readmeContent.value})

const filtered = computed(() => {
  const word = query.value.trim().toLowerCase()
  return entries.value.filter(skill => {
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
  }).sort((left,right) => categoryOrder.indexOf(left.category)-categoryOrder.indexOf(right.category) || left.displayName.localeCompare(right.displayName,'zh-CN'))
})
const grouped = computed(() => [
 ...categories.value.map(category => ({category,label: `${categoryLabel(category)}工具`,items:filtered.value.filter(skill => skill.focusedToolName && skill.category === category)})),
 {category:'plugins',label:'独立插件',items:filtered.value.filter(skill => !skill.focusedToolName)},
].filter(group => group.items.length))

const categoryLabel = (category: string) => {
  const labels: Record<string, string> = {
    file: '文件',
    git: 'Git',
    network: '网络',
    system: '系统',
    document: '文档',
    test: '测试',
    code: '代码与项目',
    runtime: '运行与网络',
    workflow: '任务',
    other: '其他插件'
  }
  return labels[category] || category
}

const dirty = computed(() => !!selected.value && snapshot() !== baseline.value)

async function load() {
  skills.value = await window.myplane.localAiStudio('skillsList')
  if (!testWorkspace.value) testWorkspace.value = await window.myplane.localAiStudio('getDefaultWorkspace')
}

async function openPluginHelp() {
  try {
    await window.myplane.openHelpDocument('plugins')
  } catch (error) {
    ElMessage.error(`打开插件帮助失败：${String(error).replace(/^Error: /, '')}`)
  }
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
      skillName: (skill as SkillEntry).sourceName || skill.name
    })

    selectedBuiltin.value = ''
    selectedSkill.value = skill.name
    editingFile.value = 'skill.json'
    skillJsonContent.value = JSON.stringify(content.skillJson, null, 2)
    indexPyContent.value = content.indexPy
    enginePyContent.value = content.enginePy
    readmeContent.value = content.readme

    baseline.value = snapshot()

    section.value = 'info'
    testTool.value = (skill as SkillEntry).focusedToolName || skill.tools[0]?.name || ''
    testArgs.value = '{}'
    testOutput.value = ''
  } catch (e) {
    throw new Error(`加载插件内容失败: ${e}`)
  }
}

async function selectSkill(skillName: string) {
  if (busy.value || (skillName === selectedSkill.value && !selectedBuiltin.value)) return

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

  const skill = entries.value.find(s => s.name === skillName)
  if (skill) {
    await run(() => loadSkillContent(skill))
  }
}

async function compileSkill() {
  if (!selected.value) return
  await run(async () => {
    await window.myplane.localAiStudio('skillCompile', {skillName: selected.value!.sourceName || selected.value!.name, indexPy: indexPyContent.value, enginePy: enginePyContent.value})
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
        skillName: selected.value!.sourceName || selected.value!.name,
        skillJson,
        indexPy: indexPyContent.value,
        enginePy: enginePyContent.value,
        readme: readmeContent.value
      })

      await load()

      // 重新加载内容以更新 baseline
      const skill = entries.value.find(s => s.name === skillName)
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
        skillName: selected.value!.sourceName || selected.value!.name,
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
  if (entries.value[0]) await loadSkillContent(entries.value[0])
}))
async function createFromToolbar(){view.value='manage';await createNewSkill()}
defineExpose({ create: createFromToolbar })
</script>

<template>
  <main class="skill-manager" :aria-busy="busy">
    <nav class="skill-view-tabs" aria-label="插件页面">
      <button type="button" :class="{active:view==='manage'}" :aria-current="view==='manage'?'page':undefined" @click="view='manage'">插件与工具</button>
      <button type="button" :class="{active:view==='capabilities'}" :aria-current="view==='capabilities'?'page':undefined" @click="view='capabilities'">能力目录</button>
      <button type="button" class="icon-action plugin-help-button" aria-label="插件编辑与使用指南" title="打开插件编辑与使用指南" @click="openPluginHelp"><QuestionFilled aria-hidden="true" /></button>
    </nav>
    <p v-if="error" class="skill-error" role="alert">
      <Warning />
      <span>{{ error }}</span>
      <button @click="error = ''">关闭</button>
    </p>

    <div v-show="view==='manage'" class="skill-layout">
      <!-- 左侧：插件列表 -->
      <aside class="skill-browser">
        <header class="browser-head">
          <div>
            <h2>插件与工具</h2>
            <span>2 个内置插件 · {{ toolCount }} 个工具<span v-if="pluginCount"> · {{ pluginCount }} 个插件</span></span>
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
            placeholder="搜索插件或工具…"
            aria-label="搜索插件或工具"
          />
        </div>

        <label class="skill-filters"><span>分类</span><select v-model="filter" aria-label="筛选插件分类"><option value="all">全部分类</option><option value="builtin">内置插件</option><option v-for="cat in categories" :key="cat" :value="cat">{{ categoryLabel(cat) }}</option></select><small>{{ filtered.length + visibleBuiltins.length }} 项</small></label>

        <div class="skill-list">
          <div v-if="visibleBuiltins.length" class="skill-group-heading">内置插件<span>{{ visibleBuiltins.length }}</span></div>
          <button v-for="item in visibleBuiltins" :key="item.id" :data-builtin="item.id" :class="{active:selectedBuiltin===item.id}" :aria-pressed="selectedBuiltin===item.id" :disabled="busy || dirty" @click="selectBuiltin(item.id)"><span class="skill-icon"><Operation/></span><span class="skill-copy"><span class="skill-primary"><strong>{{ item.name }}</strong><span class="entry-kind">内置</span></span><small><span>{{ item.description }}</span></small></span></button>
          <template v-for="group in grouped" :key="group.category">
          <div class="skill-group-heading">{{ group.label }}<span>{{ group.items.length }}</span></div>
          <button
            v-for="skill in group.items"
            :key="skill.name"
            :class="{
              active: !selectedBuiltin && selectedSkill === skill.name,
              'not-loaded': !skill.loaded
            }"
            :disabled="busy" :aria-pressed="!selectedBuiltin && selectedSkill === skill.name" @click="selectSkill(skill.name)"
          >
            <span class="skill-icon"><Operation /></span>
            <span class="skill-copy">
              <span class="skill-primary">
                <strong :title="skill.displayName">{{ skill.displayName }}</strong>
                <i :class="{ loaded: skill.loaded }" :title="skill.loaded ? '已启用' : '未启用'" />
              </span>
              <small>
                <code v-if="!skill.focusedToolName">{{ skill.name }}</code>
                <span>{{ skill.focusedToolName ? skill.description : `${skill.tools.length} 个工具` }}</span>
              </small>
            </span>
          </button>
          </template>

          <div v-if="!filtered.length && !visibleBuiltins.length" class="empty-skills">
            <Search />
            <p>{{ busy ? '正在加载插件…' : entries.length ? '没有匹配的插件或工具' : '暂无匹配项' }}</p>
            <button v-if="query || filter !== 'all'" class="text-button" @click="query = ''; filter = 'all'">
              清除筛选
            </button>
          </div>
        </div>
        <p v-if="dirty" class="plugin-draft-note">有未保存修改，请先保存再切换内置插件。</p>
      </aside>

      <!-- 右侧：插件详情/编辑 -->
      <section class="skill-editor">
        <div v-if="selectedBuiltin" class="builtin-plugin-detail"><BrowserPluginCard v-if="selectedBuiltin==='browser'"/><StaticPreviewPluginCard v-else/></div>
        <div v-else-if="!selected" class="empty-editor">
          <FolderOpened />
          <p>选择一个插件或工具查看详情</p>
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
              <p>{{ selected.focusedToolName ? '插件工具' : '独立插件' }} · {{ categoryLabel(selected.category) }}<span v-if="selected.sourceName"> · 来自 {{ selected.sourceDisplayName }}</span></p>
            </div>
            <div class="editor-actions">
              <button v-if="!selected.focusedToolName" class="secondary-button plugin-delete" :disabled="busy" @click="deleteSelectedSkill">删除插件</button>
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
                <dt>{{ selected.focusedToolName ? '工具标识' : '插件标识' }}</dt>
                <dd><code>{{ selected.focusedToolName || selected.name }}</code></dd>

                <dt>显示名称</dt>
                <dd>{{ selected.displayName }}</dd>

                <dt>版本</dt>
                <dd>{{ selected.version }}</dd>

                <dt>分类</dt>
                <dd>{{ categoryLabel(selected.category) }}</dd>

                <dt v-if="selected.sourceName">来源插件</dt>
                <dd v-if="selected.sourceName">{{ selected.sourceDisplayName }}</dd>

                <dt>运行时</dt>
                <dd>{{ selected.runtime }}</dd>

                <dt>本地目录</dt>
                <dd class="skill-path">{{ selected.skillPath }}</dd>
              </dl>
            </section>

            <section class="info-section">
              <h3>{{ selected.focusedToolName ? '工具说明' : `提供的工具 (${selected.tools.length})` }}</h3>
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
            <p v-if="selected.focusedToolName" class="test-hint">这些文件由 Agent 内置工具共用，修改代码会影响列表中的其他内置工具。</p>
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
    <section v-if="view==='capabilities'" class="skill-capability-view" aria-label="可用能力"><p class="capability-explanation">能力目录汇总内置功能、插件和 MCP 提供的可调用能力；插件配置在“插件与工具”中管理。</p><AgentCapabilityRegistry/></section>
  </main>
</template>

<style scoped src="./skill-manager.css"></style>

<style scoped>button.plugin-delete{color:var(--s-danger);border-color:transparent}button.plugin-delete:hover{border-color:var(--s-danger)}</style>
