<script setup lang="ts">
import {computed,nextTick,ref,watch} from 'vue'
import {CopyDocument} from '@element-plus/icons-vue'
import {ElMessage} from 'element-plus'
import type {AgentFilePreview} from '../../electron/shared/local-ai-agent'
import {highlightCode,syntaxLanguage} from './syntax-highlight'

const props=defineProps<{open:boolean;expanded?:boolean;preview?:AgentFilePreview;loading?:boolean;error?:string;line?:number}>()
const emit=defineEmits<{close:[];toggleExpand:[]}>()
const editor=ref<HTMLElement>()
const language=computed(()=>syntaxLanguage(props.preview?.language||props.preview?.path||'text'))
const visibleLines=computed(()=>{
 const lines=(props.preview?.content||'').replace(/\r\n?/g,'\n').split('\n'),maximum=5000
 return {items:lines.slice(0,maximum),truncated:lines.length>maximum||!!props.preview?.truncated}
})
async function locate(){await nextTick();const host=editor.value,target=host?.querySelector<HTMLElement>(`[data-line="${Math.max(1,props.line||1)}"]`);if(host&&target)host.scrollTop=Math.max(0,target.offsetTop-host.clientHeight/3)}
watch([()=>props.open,()=>props.preview?.path,()=>props.line],()=>{if(props.open)void locate()},{immediate:true})
const highlight=(line:string)=>highlightCode(line,language.value)
async function copy(){try{await navigator.clipboard.writeText(props.preview?.content||'');ElMessage.success('已复制文件内容')}catch(error){ElMessage.error(String(error))}}
</script>

<template>
 <aside v-if="open" class="code-preview-pane" :class="{expanded}" role="region" :aria-label="preview?.path||'文件预览'">
  <header><div><strong>{{preview?.path||'文件预览'}}</strong><span v-if="preview">{{language}}</span></div><button v-if="preview" title="复制" aria-label="复制文件内容" @click="copy"><CopyDocument/></button><button :title="expanded?'缩小到右侧':'展开文件区域'" :aria-label="expanded?'缩小到右侧':'展开文件区域'" @click="emit('toggleExpand')"><svg v-if="!expanded" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 20h5v-5M4 4l6 6m10 10-6-6"/></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M10 10H5V5m9 9h5v5M5 10l5-5m9 9-5 5"/></svg></button><button class="panel-toggle" title="隐藏文件区域" aria-label="隐藏文件区域" @click="emit('close')"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M14.5 4v16"/></svg></button></header>
  <div v-if="loading" class="code-preview-state">正在读取文件…</div><div v-else-if="error" class="code-preview-state error">{{error}}</div>
  <div v-else-if="preview" ref="editor" class="code-preview-editor"><div v-for="(text,index) in visibleLines.items" :key="index" class="code-preview-line" :class="{changed:index+1===line}" :data-line="index+1"><span aria-hidden="true">{{index+1}}</span><code v-html="highlight(text)"></code></div><p v-if="visibleLines.truncated" class="code-preview-truncated">文件较长，当前仅显示前 5,000 行或首个读取批次。</p></div>
  <footer v-if="preview?.note">{{preview.note}}</footer>
 </aside>
</template>

<style scoped>
.code-preview-pane{display:flex;flex:none;flex-direction:column;width:clamp(420px,46%,760px);min-width:0;height:100%;overflow:hidden;border-left:1px solid #29352f;background:#101713;color:#dce8e0}.code-preview-pane.expanded{flex:1;width:auto}.code-preview-pane>header{display:flex;align-items:center;gap:5px;min-height:52px;padding:8px 10px 8px 16px;border-bottom:1px solid #29352f;background:#151e19}.code-preview-pane>header>div{display:flex;align-items:baseline;gap:10px;min-width:0;flex:1}.code-preview-pane strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.code-preview-pane header span{color:#82958a;font:11px Consolas,monospace;text-transform:uppercase}.code-preview-pane button{display:grid;place-items:center;width:32px;height:32px;padding:7px;border:0;border-radius:8px;background:transparent;color:#a9b9b0}.code-preview-pane button:hover{background:#233029;color:#fff}.code-preview-pane button svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.code-preview-pane .panel-toggle{background:#202923;color:#e3ebe6}.code-preview-editor{flex:1;min-height:0;overflow:auto;padding:10px 0 24px;background:#0d1410;font:12.5px/1.65 'SFMono-Regular',Consolas,'Microsoft YaHei UI',monospace;counter-reset:line}.code-preview-line{display:grid;grid-template-columns:58px minmax(max-content,1fr);min-height:21px}.code-preview-line:hover{background:#18221c}.code-preview-line.changed{background:#31452f}.code-preview-line>span{position:sticky;left:0;padding:0 14px 0 8px;border-right:1px solid #26322b;background:#0d1410;color:#54685c;text-align:right;user-select:none}.code-preview-line:hover>span{background:#18221c}.code-preview-line.changed>span{background:#31452f;color:#b8d5bd}.code-preview-line code{display:block;padding:0 16px;white-space:pre;tab-size:2;color:#cdd8d1}.code-preview-state{display:grid;place-items:center;flex:1;color:#82958a}.code-preview-state.error{color:#ee8585}.code-preview-truncated{margin:14px 16px 0 74px;padding:8px 10px;border:1px solid #35443b;border-radius:6px;color:#92a49a}.code-preview-pane>footer{padding:8px 16px;border-top:1px solid #29352f;color:#82958a;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.code-preview-editor :deep(.tok-comment){color:#6f8879;font-style:italic}.code-preview-editor :deep(.tok-string){color:#b9cf8b}.code-preview-editor :deep(.tok-number){color:#d7a86e}.code-preview-editor :deep(.tok-keyword){color:#c69be5}.code-preview-editor :deep(.tok-property),.code-preview-editor :deep(.tok-attr){color:#83bdd5}.code-preview-editor :deep(.tok-tag){color:#e18b88}.code-preview-editor :deep(.tok-function){color:#82c8b5}.code-preview-editor :deep(.tok-type){color:#e2c27f}.code-preview-editor :deep(.tok-variable){color:#8db7e8}.code-preview-editor :deep(.tok-operator){color:#d1a4bf}.code-preview-editor :deep(.tok-meta){color:#91a49a}.code-preview-editor :deep(.tok-inserted){color:#8fd1a7}.code-preview-editor :deep(.tok-deleted){color:#ee9999}@container studio (max-width:1000px){.code-preview-pane{width:50%;min-width:340px}}@container studio (max-width:700px){.code-preview-pane{position:absolute;inset:0 0 0 auto;z-index:30;width:100%;min-width:0}.code-preview-pane.expanded{width:100%}.code-preview-line{grid-template-columns:45px minmax(max-content,1fr)}.code-preview-line>span{padding-right:9px}.code-preview-line code{padding-inline:10px}}
</style>
