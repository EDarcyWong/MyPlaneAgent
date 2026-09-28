<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElSelectV2 } from 'element-plus'
import type { AbilityModuleDetails } from '../../electron/shared/ability-catalog'

const props = defineProps<{ moduleId: string; archives: NonNullable<AbilityModuleDetails['archives']>; currentId?: string }>()
const selectedId = ref(''), loading = ref(false), error = ref('')
const detail = ref<AbilityModuleDetails>()
const ordered = computed(() => [...props.archives].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const date = (value: string) => Number.isNaN(Date.parse(value)) ? '时间未知' : new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const search = ref('')
const options = computed(() => {
  const words = search.value.trim().toLowerCase().replace(/[-/.]/g, ' ').split(/\s+/)
  return ordered.value.filter(archive => {
    const text = `${date(archive.createdAt)} ${archive.createdAt} ${archive.snapshotId} ${archive.snapshotId === props.currentId ? '当前' : ''}`.toLowerCase().replace(/[-/.]/g, ' ')
    return words.every(word => text.includes(word))
  }).map(archive => ({ value: archive.snapshotId, label: `${date(archive.createdAt)} · ${archive.snapshotId.slice(0, 8)}${archive.snapshotId === props.currentId ? ' · 当前' : ''}` }))
})
const root = ref<HTMLElement>(), theme = ref<Record<string, string>>({})
function onDropdown(visible: boolean) {
  search.value = ''
  if (!visible || !root.value) return
  const style = getComputedStyle(root.value)
  theme.value = Object.fromEntries(['--s-panel', '--s-muted', '--s-border', '--s-text', '--s-dim', '--s-accent'].map(name => [name, style.getPropertyValue(name)]))
}
let request = 0
function close() { search.value = ''; request++; selectedId.value = ''; detail.value = undefined; error.value = ''; loading.value = false }
watch(() => props.moduleId, close)
async function select(snapshotId: string) {
  if (snapshotId === selectedId.value && (detail.value || loading.value)) return
  const token = ++request
  selectedId.value = snapshotId; detail.value = undefined; error.value = ''; loading.value = true
  try {
    const result = await window.myplane.localAiStudio('abilityKernelArchive', { moduleId: props.moduleId, snapshotId })
    if (token === request) detail.value = result
  } catch (cause) { if (token === request) error.value = String(cause) }
  finally { if (token === request) loading.value = false }
}
</script>

<template>
  <section ref="root" class="snapshots" aria-label="应用快照">
    <div class="snapshot-toolbar">
      <span class="snapshot-label">应用快照 <small>{{ archives.length }}</small></span>
      <ElSelectV2 class="snapshot-picker" :model-value="selectedId || undefined" :options="options" :disabled="!archives.length" filterable :filter-method="value => search = value" :height="224" :item-height="32" :placeholder="archives.length ? '搜索日期 / 快照编号' : '暂无快照'" aria-label="选择应用快照" no-match-text="没有匹配的快照" no-data-text="暂无快照" popper-class="snapshot-picker-menu" :popper-style="theme" @visible-change="onDropdown" @update:model-value="select(String($event))" />
      <small class="snapshot-status">只读<span v-if="detail"> · {{ detail.sources.length }} 个文件</span></small>
      <button v-if="selectedId" class="close-preview" @click="close">收起</button>
    </div>
    <div v-if="selectedId" class="snapshot-preview" :aria-busy="loading">
      <p v-if="loading" role="status">正在读取…</p>
      <div v-else-if="error"><p class="error" role="alert">{{ error }}</p><button @click="select(selectedId)">重试</button></div>
      <div v-else-if="detail" :key="selectedId" class="snapshot-files">
        <p v-if="detail.missingSources.length" class="error">存档缺少：{{ detail.missingSources.join('、') }}</p>
        <p v-if="!detail.sources.length">没有可预览的文件。</p>
        <details v-for="source in detail.sources" :key="source.path" class="snapshot-source"><summary :title="source.path">{{ source.path }}</summary><p v-if="source.truncated">仅展示前 40,000 字符。</p><pre tabindex="0" :aria-label="source.path + ' 只读代码'">{{ source.code }}</pre></details>
        <details class="snapshot-fingerprint"><summary>完整标识</summary><code>{{ selectedId }}</code></details>
      </div>
    </div>
  </section>
</template>

<style scoped>
.snapshots{margin-top:16px;border-top:1px solid var(--s-border);padding-top:12px;min-width:0}
.snapshot-toolbar{display:flex;align-items:center;gap:10px;min-height:30px;flex-wrap:wrap}
.snapshot-label{font-size:12px;font-weight:600;white-space:nowrap}.snapshot-label small{margin-left:4px;font-weight:400}
small{font-size:11px;color:var(--s-dim)}
.snapshot-picker{width:300px;max-width:100%;min-width:0;--el-color-primary:var(--s-accent);--el-text-color-regular:var(--s-text);--el-text-color-placeholder:var(--s-dim)}
.snapshot-picker :deep(.el-select__wrapper){min-height:30px;font-size:12px;background:var(--s-panel);box-shadow:0 0 0 1px var(--s-border) inset}

button{font:inherit;font-size:12px;color:var(--s-accent);background:transparent;border:0;padding:4px;cursor:pointer}
.snapshot-status{white-space:nowrap}.close-preview{margin-left:auto}
.snapshot-preview{margin-top:8px;min-width:0}
p{font-size:12px;line-height:1.6;color:var(--s-dim);margin:6px 0}
.snapshots .snapshot-source,.snapshots .snapshot-fingerprint{margin:0}
summary{cursor:pointer;font-size:12px;line-height:1.5;padding:5px 8px;overflow-wrap:anywhere;border-radius:4px}summary:hover{background:var(--s-muted)}
.snapshot-fingerprint{color:var(--s-dim)}.snapshot-fingerprint summary{font-size:11px}.snapshot-fingerprint code{display:block;padding:4px 8px;font-size:11px;overflow-wrap:anywhere;user-select:text}
pre{max-height:320px;max-width:100%;overflow:auto;margin:4px 0 8px;padding:10px;background:var(--s-bg);border-radius:6px;font-size:12px;line-height:1.6;white-space:pre;user-select:text}
.error{color:var(--s-danger)}button:focus-visible,summary:focus-visible,pre:focus-visible{outline:2px solid var(--s-accent);outline-offset:2px}
@container(max-width:480px){.snapshot-toolbar{gap:6px}.snapshot-picker{width:auto;flex:1}.snapshot-status{display:none}}
</style>

<style>
.snapshot-picker-menu.el-popper{--el-bg-color-overlay:var(--s-panel,#fff);--el-fill-color-light:var(--s-muted,#f5f5f5);--el-text-color-regular:var(--s-text,#222);--el-text-color-secondary:var(--s-dim,#777);--el-color-primary:var(--s-accent,#24755f);background:var(--s-panel,#fff);border-color:var(--s-border,#ddd);max-width:calc(100vw - 24px)}
.snapshot-picker-menu .el-select-dropdown__item{font-size:12px}
</style>
