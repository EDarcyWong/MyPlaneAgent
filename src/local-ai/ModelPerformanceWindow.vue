<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ModelPerformance from './ModelPerformance.vue'
import type { StudioRuntime, StudioSettings } from '../../electron/shared/local-ai-studio'

const runtime = ref<StudioRuntime>(), source = ref<'managed'|'external'>('managed')
const theme = ref<StudioSettings['theme']>('system'), error = ref('')
let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
async function poll() {
  try {
    const snapshot = await window.myplane.performanceSnapshot()
    if(disposed)return
    runtime.value = snapshot.runtime; source.value = snapshot.source; theme.value = snapshot.theme; error.value = ''
  } catch (cause) { if(!disposed)error.value = `统计更新失败：${String(cause).replace(/^Error: /,'')}` }
  finally { if(!disposed)timer = setTimeout(poll,1500) }
}
onMounted(()=>void poll())
onBeforeUnmount(()=>{disposed=true;clearTimeout(timer)})
</script>

<template>
  <main class="performance-window" :data-theme="theme">
    <p v-if="error" class="window-error" role="alert">{{ error }}</p>
    <ModelPerformance detached :runtime="runtime" :source="source"/>
  </main>
</template>

<style scoped>
.performance-window{--s-bg:#f7f9fc;--s-panel:#fff;--s-muted:#eef2f6;--s-border:#dce3eb;--s-text:#243044;--s-dim:#6a7a90;--s-accent:#3478c6;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--s-panel);color:var(--s-text)}.window-error{margin:0;padding:8px 12px;color:#bd4040;font-size:12px;flex:none}.performance-window :deep(.model-performance){flex:1;min-height:0}.performance-window[data-theme=dark]{--s-bg:#202020;--s-panel:#272727;--s-muted:#333;--s-border:#444;--s-text:#ececec;--s-dim:#adadad;--s-accent:#82b6ee;color-scheme:dark}@media(prefers-color-scheme:dark){.performance-window[data-theme=system]{--s-bg:#202020;--s-panel:#272727;--s-muted:#333;--s-border:#444;--s-text:#ececec;--s-dim:#adadad;--s-accent:#82b6ee;color-scheme:dark}}
</style>

<style scoped>
.performance-window{width:100%;flex:1}
</style>
