<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Search, Refresh, InfoFilled, Check, Close, Warning, Connection } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

interface Capability {
  name: string
  category: string
  source: 'builtin' | 'skill' | 'mcp'
  description: string
  parameters?: Array<{
    name: string
    type: string
    required: boolean
    description?: string
  }>
  enabled: boolean
  status?: 'active' | 'inactive' | 'error'
}

const capabilities = ref<Capability[]>([])
const loading = ref(true)
const searchQuery = ref('')
const selectedCategory = ref<string>('all')
const selectedSource = ref<string>('all')
const expandedCapability = ref<string | null>(null)

// 分类统计
const categories = computed(() => {
  const counts: Record<string, number> = {}
  capabilities.value.forEach(cap => {
    counts[cap.category] = (counts[cap.category] || 0) + 1
  })
  return [
    { id: 'all', name: '全部', count: capabilities.value.length },
    ...Object.entries(counts).map(([id, count]) => ({
      id,
      name: getCategoryName(id),
      count
    }))
  ]
})

// 来源统计
const sources = computed(() => {
  const counts: Record<string, number> = { builtin: 0, skill: 0, mcp: 0 }
  capabilities.value.forEach(cap => {
    counts[cap.source]++
  })
  return [
    { id: 'all', name: '全部来源', count: capabilities.value.length },
    { id: 'builtin', name: '内置能力', count: counts.builtin },
    { id: 'skill', name: '插件工具', count: counts.skill },
    { id: 'mcp', name: 'MCP 工具', count: counts.mcp }
  ]
})

// 过滤后的能力列表
const filteredCapabilities = computed(() => {
  return capabilities.value.filter(cap => {
    // 分类过滤
    if (selectedCategory.value !== 'all' && cap.category !== selectedCategory.value) {
      return false
    }
    // 来源过滤
    if (selectedSource.value !== 'all' && cap.source !== selectedSource.value) {
      return false
    }
    // 搜索过滤
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      return (
        cap.name.toLowerCase().includes(query) ||
        cap.description.toLowerCase().includes(query) ||
        cap.category.toLowerCase().includes(query)
      )
    }
    return true
  })
})

// 按分类分组
const groupedCapabilities = computed(() => {
  const groups: Record<string, Capability[]> = {}
  filteredCapabilities.value.forEach(cap => {
    if (!groups[cap.category]) {
      groups[cap.category] = []
    }
    groups[cap.category].push(cap)
  })
  return Object.entries(groups).map(([category, items]) => ({
    category,
    name: getCategoryName(category),
    items
  }))
})

// 获取分类名称
function getCategoryName(category: string): string {
  const names: Record<string, string> = {
    file: '文件操作',
    git: 'Git 操作',
    document: '文档处理',
    web: '网络访问',
    code: '代码分析',
    test: '测试工具',
    custom: '自定义',
    mcp: 'MCP 工具'
  }
  return names[category] || category
}

// 获取来源图标类
function getSourceClass(source: string): string {
  const classes: Record<string, string> = {
    builtin: 'source-builtin',
    skill: 'source-skill',
    mcp: 'source-mcp'
  }
  return classes[source] || ''
}

// 获取来源名称
function getSourceName(source: string): string {
  const names: Record<string, string> = {
    builtin: '内置',
    skill: '插件',
    mcp: 'MCP'
  }
  return names[source] || source
}

// 获取状态图标
function getStatusIcon(status?: string) {
  if (status === 'active') return Check
  if (status === 'error') return Warning
  return Close
}

// 加载能力列表
async function loadCapabilities() {
  loading.value = true
  try {
    const result = await window.myplane.localAiStudio('agentCoreListCapabilities')
    capabilities.value = result || []
  } catch (error) {
    ElMessage.error(`加载失败: ${error}`)
    capabilities.value = []
  } finally {
    loading.value = false
  }
}

// 展开/收起能力详情
function toggleExpand(name: string) {
  expandedCapability.value = expandedCapability.value === name ? null : name
}

// 刷新
async function refresh() {
  await loadCapabilities()
  ElMessage.success('已刷新')
}

onMounted(() => {
  loadCapabilities()
})
</script>

<template>
  <div class="capability-registry">
    <!-- 头部 -->
    <header class="registry-header">
      <div class="header-info">
        <h2>可用能力</h2>
        <p>查看 Agent 当前可调用的插件与 MCP 工具</p>
      </div>
      <button class="refresh-btn" @click="refresh" :disabled="loading">
        <Refresh :class="{ spinning: loading }" />
        刷新
      </button>
    </header>

    <!-- 搜索和过滤 -->
    <div class="registry-controls">
      <div class="search-box">
        <Search />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索能力名称或描述..."
          aria-label="搜索能力"
        />
      </div>

      <div class="filter-tabs">
        <div class="filter-group">
          <label>分类：</label>
          <button
            v-for="cat in categories"
            :key="cat.id"
            :class="{ active: selectedCategory === cat.id }"
            @click="selectedCategory = cat.id"
          >
            {{ cat.name }} <span class="count">{{ cat.count }}</span>
          </button>
        </div>

        <div class="filter-group">
          <label>来源：</label>
          <button
            v-for="src in sources"
            :key="src.id"
            :class="{ active: selectedSource === src.id }"
            @click="selectedSource = src.id"
          >
            {{ src.name }} <span class="count">{{ src.count }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 能力列表 -->
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>加载能力列表...</p>
    </div>

    <div v-else-if="filteredCapabilities.length === 0" class="empty-state">
      <InfoFilled />
      <p>{{ searchQuery ? '没有找到匹配的能力' : selectedCategory !== 'all' || selectedSource !== 'all' ? '当前筛选条件下没有能力' : '暂无可用能力' }}</p>
    </div>

    <div v-else class="capabilities-list">
      <div v-for="group in groupedCapabilities" :key="group.category" class="capability-group">
        <h3 class="group-title">{{ group.name }}</h3>

        <div class="capability-items">
          <div
            v-for="capability in group.items"
            :key="capability.name"
            class="capability-card"
            :class="{
              expanded: expandedCapability === capability.name,
              disabled: !capability.enabled
            }"
          >
            <div class="capability-header" @click="toggleExpand(capability.name)">
              <div class="capability-info">
                <div class="capability-title">
                  <strong>{{ capability.name }}</strong>
                  <span class="capability-source" :class="getSourceClass(capability.source)">
                    {{ getSourceName(capability.source) }}
                  </span>
                  <span v-if="capability.status" class="capability-status" :class="`status-${capability.status}`">
                    <component :is="getStatusIcon(capability.status)" />
                  </span>
                </div>
                <p class="capability-description">{{ capability.description }}</p>
              </div>

              <div class="capability-actions" @click.stop>
                <span
                  class="toggle-btn"
                  :class="{ enabled: capability.enabled }"
                  :title="capability.enabled ? '已启用' : '已停用'"
                >
                  <Check v-if="capability.enabled" />
                  <Close v-else />
                </span>
              </div>
            </div>

            <!-- 展开的详情 -->
            <div v-if="expandedCapability === capability.name" class="capability-details">
              <div v-if="capability.parameters && capability.parameters.length > 0" class="parameters-section">
                <h4>参数列表</h4>
                <table class="parameters-table">
                  <thead>
                    <tr>
                      <th>参数名</th>
                      <th>类型</th>
                      <th>必需</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="param in capability.parameters" :key="param.name">
                      <td><code>{{ param.name }}</code></td>
                      <td><span class="param-type">{{ param.type }}</span></td>
                      <td>
                        <span v-if="param.required" class="required-badge">必需</span>
                        <span v-else class="optional-badge">可选</span>
                      </td>
                      <td>{{ param.description || '-' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="metadata-section">
                <div class="metadata-item">
                  <label>分类：</label>
                  <span>{{ getCategoryName(capability.category) }}</span>
                </div>
                <div class="metadata-item">
                  <label>来源：</label>
                  <span>{{ getSourceName(capability.source) }}</span>
                </div>
                <div class="metadata-item">
                  <label>状态：</label>
                  <span :class="`status-text-${capability.status}`">
                    {{ capability.status === 'active' ? '正常' : capability.status === 'error' ? '错误' : '未激活' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.capability-registry {
  --studio-bg: var(--s-bg);
  --studio-text: var(--s-text);
  --studio-text-muted: var(--s-dim);
  --studio-border: var(--s-border);
  --studio-input-bg: var(--s-panel);
  --studio-button-bg: var(--s-panel);
  --studio-button-hover: var(--s-muted);
  --studio-card-bg: var(--s-panel);
  --studio-primary: var(--s-accent);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--studio-bg);
  color: var(--studio-text);
}

.registry-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px;
  border-bottom: 1px solid var(--studio-border);
}

.header-info h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.header-info p {
  margin: 0;
  font-size: 14px;
  color: var(--studio-text-muted);
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--studio-button-bg);
  border: 1px solid var(--studio-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--studio-button-hover);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-btn svg,
.search-box svg {
  width: 16px;
  height: 16px;
  flex: none;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.registry-controls {
  padding: 16px 24px;
  border-bottom: 1px solid var(--studio-border);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--studio-input-bg);
  border: 1px solid var(--studio-border);
  border-radius: 6px;
  margin-bottom: 16px;
}

.search-box input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  font-size: 14px;
  color: var(--studio-text);
}

.filter-tabs {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--studio-text-muted);
}

.filter-group button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--studio-border);
  border-radius: 16px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.filter-group button:hover {
  background: var(--studio-button-hover);
}

.filter-group button.active {
  background: var(--studio-primary);
  color: white;
  border-color: var(--studio-primary);
}

.count {
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  font-size: 11px;
}

.filter-group button.active .count {
  background: rgba(255, 255, 255, 0.2);
}

.capabilities-list {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.capability-group {
  margin-bottom: 32px;
}

.group-title {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: var(--studio-text);
}

.capability-items {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.capability-card {
  background: var(--studio-card-bg);
  border: 1px solid var(--studio-border);
  border-radius: 8px;
  transition: all 0.2s;
}

.capability-card:hover {
  border-color: var(--studio-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.capability-card.disabled {
  opacity: 0.6;
}

.capability-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 16px;
  cursor: pointer;
}

.capability-info {
  flex: 1;
}

.capability-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.capability-title strong {
  font-size: 14px;
  font-weight: 600;
}

.capability-source {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.source-builtin {
  background: #e3f2fd;
  color: #1976d2;
}

.source-skill {
  background: #f3e5f5;
  color: #7b1fa2;
}

.source-mcp {
  background: #e8f5e9;
  color: #388e3c;
}

.capability-status {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
}

.capability-status svg {
  width: 14px;
  height: 14px;
}

.status-active {
  color: #4caf50;
}

.status-error {
  color: #f44336;
}

.capability-description {
  margin: 0;
  font-size: 13px;
  color: var(--studio-text-muted);
  line-height: 1.5;
}

.capability-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--studio-button-bg);
  border: 1px solid var(--studio-border);
  border-radius: 6px;
}

.toggle-btn.enabled {
  background: #4caf50;
  border-color: #4caf50;
  color: white;
}

.toggle-btn svg {
  width: 16px;
  height: 16px;
}

.capability-details {
  padding: 0 16px 16px;
  border-top: 1px solid var(--studio-border);
}

.parameters-section {
  margin-top: 16px;
}

.parameters-section h4 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--studio-text-muted);
}

.parameters-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.parameters-table th {
  text-align: left;
  padding: 8px;
  background: var(--studio-input-bg);
  font-weight: 500;
  color: var(--studio-text-muted);
}

.parameters-table td {
  padding: 8px;
  border-top: 1px solid var(--studio-border);
}

.param-type {
  padding: 2px 6px;
  background: var(--studio-input-bg);
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}

.required-badge {
  padding: 2px 6px;
  background: #ffebee;
  color: #c62828;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.optional-badge {
  padding: 2px 6px;
  background: var(--studio-input-bg);
  color: var(--studio-text-muted);
  border-radius: 4px;
  font-size: 11px;
}

.metadata-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--studio-border);
}

.metadata-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.metadata-item label {
  font-weight: 500;
  color: var(--studio-text-muted);
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--studio-text-muted);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--studio-border);
  border-top-color: var(--studio-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.empty-state svg {
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}
</style>
