<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { formatCodePreview } from './formatCodePreview'
import { Close, FullScreen, ScaleToOriginal } from '@element-plus/icons-vue'
import type { AbilityModuleDetails } from '../../electron/shared/ability-catalog'
const CodeEditor = defineAsyncComponent(() => import('./SkillCodeEditor.vue'))
const props = defineProps<{ sources: AbilityModuleDetails['sources']; selectedPath: string }>()
const emit = defineEmits<{ select: [path: string]; close: [] }>()
const selected = computed(() => props.sources.find(source => source.path === props.selectedPath))
const expanded = ref(false)
const formattedCode = ref<string>()
watch(selected, async (source, _, onCleanup) => {
  let cancelled = false
  onCleanup(() => { cancelled = true })
  formattedCode.value = undefined
  if (!source) return
  const formatted = await formatCodePreview(source.code, source.path)
  if (!cancelled) formattedCode.value = formatted
}, { immediate: true })
function escape() { if (expanded.value) expanded.value = false; else emit('close') }
</script>

<template>
  <aside v-if="selected" class="source-panel" :class="{ expanded }" aria-label="当前实现代码预览" @keydown.esc.stop="escape">
    <header class="source-panel-heading"><strong>当前实现 <small>只读</small></strong><div><span v-if="expanded" class="fullscreen-hint" role="status">按 <kbd>Esc</kbd> 退出全屏</span><button :aria-pressed="expanded" :aria-label="expanded ? '退出实现代码全屏' : '放大代码面板'" :title="expanded ? '退出全屏（Esc）' : '放大'" @click="expanded = !expanded"><ScaleToOriginal v-if="expanded" aria-hidden="true"/><FullScreen v-else aria-hidden="true"/></button><button aria-label="关闭代码预览" title="关闭" @click="emit('close')"><Close aria-hidden="true"/></button></div></header>
    <div class="source-panel-file"><select :value="selectedPath" aria-label="切换实现文件" @change="emit('select', ($event.target as HTMLSelectElement).value)"><option v-for="source in sources" :key="source.path" :value="source.path">{{ source.path }}</option></select></div>
    <p v-if="formattedCode === undefined" role="status">正在整理代码…</p>
    <CodeEditor v-else :model-value="formattedCode" :filename="selected.path" readonly />
  </aside>
</template>

<style scoped>
.fullscreen-hint{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--s-dim);white-space:nowrap}.fullscreen-hint kbd{font:inherit;padding:1px 4px;border:1px solid var(--s-border);border-radius:4px;background:var(--s-muted)}
.source-panel{display:flex;flex-direction:column;flex:0 0 48%;width:48%;min-width:0;height:100%;min-height:0;box-sizing:border-box;overflow:hidden;border-left:1px solid var(--s-border);background:var(--s-panel)}
.source-panel.expanded{position:absolute;inset:0;z-index:20;width:100%;border:0}
.source-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;border-bottom:1px solid var(--s-border);flex:none}.source-panel-heading strong{font-size:13px}.source-panel-heading small{font-size:11px;font-weight:400;color:var(--s-dim);margin-left:6px}.source-panel-heading>div{display:flex;gap:6px}
button,select{font:inherit;font-size:12px;color:var(--s-text);background:var(--s-panel);border:1px solid var(--s-border);border-radius:6px;min-width:0}button{cursor:pointer;padding:6px;width:28px;height:28px;display:grid;place-items:center;border:0}button svg{width:16px;height:16px}button:hover{background:var(--s-muted)}
.source-panel-file{padding:8px 12px;border-bottom:1px solid var(--s-border);flex:none}.source-panel-file select{width:100%;padding:6px;font-size:11px}p{font-size:12px;color:var(--s-dim);margin:8px 12px}button:focus-visible,select:focus-visible{outline:2px solid var(--s-accent);outline-offset:2px}
@media(max-width:900px){.source-panel:not(.expanded){position:absolute;inset:0 0 0 auto;width:75%;z-index:10;box-shadow:-8px 0 24px #0002}}
</style>
