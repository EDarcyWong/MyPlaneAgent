<script setup lang="ts">
import HighlightedCode from './HighlightedCode.vue'
import {Close} from '@element-plus/icons-vue'
import type {ChatArtifact} from '../../electron/shared/chat-presentation'
defineProps<{artifact:ChatArtifact}>()
defineEmits<{close:[];copy:[text:string]}>()
</script>
<template>
 <aside class="chat-artifact-panel" aria-label="文件产物与修改">
  <header><strong>{{artifact.kind==='diff'?'文件修改':'文件产物'}}</strong><button aria-label="关闭产物面板" @click="$emit('close')"><Close/></button></header>
  <div class="artifact-body"><h2>{{artifact.path}}</h2><p class="artifact-note">{{artifact.note}}</p>
   <template v-if="artifact.kind==='diff'"><section class="before"><h3>修改前</h3><HighlightedCode :code="artifact.before?.slice(0,60000)||'（空）'" :language="artifact.path"/></section><section class="after"><h3>修改后</h3><HighlightedCode :code="artifact.after?.slice(0,60000)||'（空）'" :language="artifact.path"/></section></template>
   <section v-else><h3>内容预览</h3><HighlightedCode :code="artifact.after?.slice(0,60000)||'没有可展示的文本内容。'" :language="artifact.path"/></section>
   <p v-if="(artifact.before?.length||0)>60000||(artifact.after?.length||0)>60000" class="artifact-note">预览仅显示前 60,000 字符。</p>
  </div>
  <footer><button :disabled="!artifact.after" @click="$emit('copy',artifact.after||'')">复制{{artifact.kind==='diff'?'修改后内容':'内容'}}</button></footer>
 </aside>
</template>
<style scoped>
.chat-artifact-panel{display:flex;flex-direction:column;flex:none;width:clamp(300px,32%,480px);min-height:0;border-left:1px solid var(--s-border);background:var(--s-panel);color:var(--s-text);z-index:15}.chat-artifact-panel>header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--s-border);font-size:13px}.chat-artifact-panel header button{display:grid;place-items:center;width:28px;height:28px;padding:5px;border:0;border-radius:6px;background:transparent;color:var(--s-dim);cursor:pointer}.chat-artifact-panel svg{width:16px;height:16px}.artifact-body{flex:1;overflow:auto;min-height:0;padding:20px 18px}.artifact-body h2{font-size:14px;margin:0 0 8px;overflow-wrap:anywhere}.artifact-note{font-size:11px;line-height:1.65;color:var(--s-dim)}.artifact-body section{margin:18px 0;border:1px solid var(--s-border);border-radius:8px;overflow:hidden}.artifact-body h3{margin:0;padding:8px 12px;font-size:11px;font-weight:500;border-bottom:1px solid var(--s-border);background:var(--s-muted)}.artifact-body pre{padding:12px;margin:0;font:12px/1.7 ui-monospace,SFMono-Regular,monospace;white-space:pre;overflow:auto}.before h3{color:var(--s-danger)}.after h3{color:var(--s-accent)}footer{padding:14px 18px;border-top:1px solid var(--s-border)}footer button{border:1px solid var(--s-border);background:var(--s-panel);color:var(--s-text);border-radius:7px;padding:7px 12px;font-size:12px;cursor:pointer}button:hover{background:var(--s-muted)}button:disabled{opacity:.4;cursor:default}@container studio (max-width:1000px){.chat-artifact-panel{position:absolute;right:0;top:0;bottom:0;width:min(420px,100%);box-shadow:-10px 0 30px #0001}}
</style>
