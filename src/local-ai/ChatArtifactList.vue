<script setup lang="ts">
import {computed,ref} from 'vue'
import {DocumentAdd,ArrowDown} from '@element-plus/icons-vue'
import type {ChatArtifact} from '../../electron/shared/chat-presentation'
import {fileDiff} from '../../electron/shared/file-diff'
import ChatArtifactHover from './ChatArtifactHover.vue'
const props=defineProps<{artifacts:ChatArtifact[]}>()
defineEmits<{open:[artifact:ChatArtifact]}>()
const expanded=ref(false)
const hover=ref<InstanceType<typeof ChatArtifactHover>>()
const rows=computed(()=>props.artifacts.map(artifact=>({artifact,name:artifact.path.replace(/\\/g,'/').split('/').pop(),directory:artifact.path.replace(/\\/g,'/').split('/').slice(0,-1).join('/'),diff:artifact.kind==='diff'?fileDiff(artifact.before||'',artifact.after||''):undefined})))
const visibleRows=computed(()=>expanded.value?rows.value:rows.value.slice(0,3))
const totals=computed(()=>rows.value.reduce((sum,row)=>({added:sum.added+(row.diff?.added||0),removed:sum.removed+(row.diff?.removed||0),count:sum.count+(row.diff?1:0),partial:sum.partial||!row.diff||row.diff.truncated||row.artifact.scope==='fragment'}),{added:0,removed:0,count:0,partial:false}))
</script>
<template>
 <section class="file-changes" aria-label="本次文件变更">
  <header>
   <span class="summary-icon" aria-hidden="true"><DocumentAdd/></span>
   <div class="summary"><strong>已编辑 {{artifacts.length}} 个文件</strong><div v-if="totals.count" class="summary-stats"><span class="line-stats"><b class="added">+{{totals.added}}</b><b class="removed">−{{totals.removed}}</b></span><small v-if="totals.partial">部分内容统计</small></div></div>
   <button v-if="artifacts.length" class="review-button" @click="$emit('open',artifacts[0])">审核</button>
  </header>
  <div class="file-rows">
   <button v-for="{artifact,name,directory,diff} in visibleRows" :key="artifact.id" class="file-row" :aria-label="'查看'+artifact.path+'的变更'" @mouseenter="hover?.show(artifact,$event)" @mouseleave="hover?.scheduleHide($event)" @focus="hover?.show(artifact,$event)" @blur="hover?.scheduleHide($event)" @click="hover?.hide();$emit('open',artifact)">
    <span class="file-path"><span v-if="directory" class="directory">{{directory}}/</span>{{name}}</span>
    <span v-if="diff" class="line-stats" :title="diff.truncated?'预览部分的增删行数':artifact.scope==='fragment'?'文本片段的增删行数':'增删行数'"><b class="added">+{{diff.added}}</b><b class="removed">−{{diff.removed}}</b></span>
   </button>
  </div>
  <button v-if="rows.length>3" class="show-more" :aria-expanded="expanded" @click="expanded=!expanded">{{expanded?'收起文件':'再显示 '+(rows.length-3)+' 个文件'}}<ArrowDown :class="{expanded}"/></button>
 </section>
 <ChatArtifactHover ref="hover"/>
</template>
<style scoped>
.file-changes{margin:18px 0;border:1px solid var(--s-border);border-radius:14px;overflow:hidden;background:var(--s-panel);color:var(--s-text)}
header{display:flex;align-items:center;gap:12px;padding:15px;border-bottom:1px solid var(--s-border)}.summary-icon{display:grid;place-items:center;width:44px;height:44px;flex:none;background:var(--s-muted);border-radius:12px;color:var(--s-dim)}.summary-icon svg{width:23px;height:23px}.summary{flex:1;min-width:0}.summary strong{display:block;font-size:14px;line-height:1.5;font-weight:550}.summary-stats{display:flex;align-items:center;gap:9px;margin-top:3px}.summary-stats small{font-size:10px;color:var(--s-dim)}
.review-button{flex:none;border:1px solid var(--s-border);border-radius:12px;background:var(--s-panel);color:var(--s-text);font:inherit;font-size:12px;padding:6px 11px;cursor:pointer}.review-button:hover{background:var(--s-muted)}
.file-row{width:100%;display:flex;align-items:center;gap:14px;text-align:left;padding:10px 15px;border:0;background:transparent;color:var(--s-text);font:inherit;font-size:13px;line-height:1.5;cursor:pointer}.file-row:nth-child(even){background:color-mix(in srgb,var(--s-muted) 65%,var(--s-panel))}.file-row:hover{background:var(--s-muted)}.file-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.directory{color:var(--s-dim)}
.line-stats{display:inline-flex;gap:5px;flex:none;align-items:center;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:nowrap}.line-stats b{font-weight:400}.added{color:light-dark(#00a844,#81cf9e)}.removed{color:light-dark(#e02d38,#eda0a0)}
.show-more{display:flex;align-items:center;gap:10px;width:100%;padding:11px 15px;border:0;background:transparent;color:var(--s-text);font:inherit;font-size:13px;text-align:left;cursor:pointer}.show-more:hover{background:var(--s-muted)}.show-more svg{width:13px;height:13px;transition:transform .15s}.show-more svg.expanded{transform:rotate(180deg)}button:focus-visible{outline:2px solid var(--s-accent);outline-offset:-3px}
@media(max-width:600px){header{gap:10px;padding:12px}.summary-icon{width:38px;height:38px}.summary strong{font-size:13px}.file-row,.show-more{padding-inline:12px;font-size:12px}.summary-stats{flex-wrap:wrap;gap:4px 8px}}
@media(prefers-reduced-motion:reduce){.show-more svg{transition:none}}
</style>
