<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {collapseDiff,fileDiff} from '../../electron/shared/file-diff'
import {highlightCode} from './syntax-highlight'
import {highlightSource,sourceLanguage} from './code-highlighter'
const props=defineProps<{before:string;after:string;added?:boolean;language?:string;fragment?:boolean}>()
const beforeHtml=ref<string[]>([]),afterHtml=ref<string[]>([])
watch(()=>[props.before,props.after,props.language,props.fragment] as const,async([before,after,language,fragment],_old,onCleanup)=>{
 let stale=false;onCleanup(()=>{stale=true})
 const codeBefore=before.slice(0,60000).replace(/\r\n/g,'\n'),codeAfter=after.slice(0,60000).replace(/\r\n/g,'\n')
 const syntax=sourceLanguage(codeBefore+'\n'+codeAfter,language,fragment)
 beforeHtml.value=highlightCode(codeBefore,syntax).split('\n');afterHtml.value=highlightCode(codeAfter,syntax).split('\n')
 const [oldHtml,newHtml]=await Promise.all([highlightSource(codeBefore,syntax),highlightSource(codeAfter,syntax)])
 if(!stale){beforeHtml.value=oldHtml.split('\n');afterHtml.value=newHtml.split('\n')}
},{immediate:true})
const expanded=ref(false)
watch(()=>[props.before,props.after],()=>{expanded.value=false})
const diff=computed(()=>fileDiff(props.before,props.after))
const rows=computed(()=>expanded.value||props.added?diff.value.lines:collapseDiff(diff.value.lines))
</script>
<template>
 <div class="diff-view syntax-colored">
  <div class="diff-toolbar"><span><b class="added">+{{diff.added}}</b><b class="removed">−{{diff.removed}}</b> 行</span><button v-if="!added" :aria-pressed="expanded" @click="expanded=!expanded">{{expanded?'仅看变更':'展开全文'}}</button></div>
  <p v-if="diff.truncated" class="diff-note">文件较长，当前仅比较前 60,000 字符，行数统计也仅针对预览部分。</p>
  <p v-if="!added&&diff.newlineChanged" class="diff-note">{{after.endsWith('\n')?'文件末尾新增换行。':'文件末尾不再有换行。'}}</p>
  <p v-if="!diff.added&&!diff.removed&&!diff.newlineChanged" class="diff-note">没有文本行变更。</p>
  <div class="diff-scroll" tabindex="0" aria-label="文件差异，含修改前后行号">
   <div class="diff-table">
    <div class="diff-line diff-columns"><span class="line-number">原行</span><span class="line-number">新行</span><span class="sign"></span><span>文件内容</span></div>
    <template v-for="(row,index) in rows" :key="index">
     <button v-if="row.kind==='gap'" class="diff-gap" @click="expanded=true">展开 {{row.count}} 行未修改内容</button>
     <div v-else class="diff-line" :class="row.kind"><span class="line-number">{{row.before}}</span><span class="line-number">{{row.after}}</span><span class="sign" aria-hidden="true">{{row.kind==='added'?'+':row.kind==='removed'?'−':' '}}</span><code v-html="(row.kind==='removed'?beforeHtml[(row.before||1)-1]:afterHtml[(row.after||1)-1])||' '"></code></div>
    </template>
   </div>
  </div>
 </div>
</template>
<style scoped src="./code-token-colors.css"></style>
<style scoped>
.diff-columns{position:sticky;top:0;z-index:1;background:var(--s-muted);border-bottom:1px solid var(--s-border);font-size:10px!important;color:var(--s-dim)!important}
.diff-view{border:1px solid var(--s-border);border-radius:8px;overflow:hidden;margin:16px 0}.diff-toolbar{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--s-muted);border-bottom:1px solid var(--s-border);font-size:11px;color:var(--s-dim)}.diff-toolbar b{font:11px ui-monospace,Consolas,monospace;margin-right:8px}.added{color:light-dark(#167349,#81cf9e)}.removed{color:light-dark(#b64242,#eda0a0)}.diff-toolbar button{border:0;background:transparent;color:var(--s-accent);font-size:11px;cursor:pointer;padding:2px 4px}.diff-note{font-size:11px;line-height:1.7;color:var(--s-dim);padding:9px 12px;margin:0;border-bottom:1px solid var(--s-border)}
.diff-scroll{overflow-x:auto;overflow-y:hidden}.diff-table{min-width:100%;width:max-content}.diff-line{display:flex;min-height:23px;font:12px/23px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--s-text)}.diff-line.added{background:light-dark(#edf9f0,#163226)}.diff-line.removed{background:light-dark(#fff0f0,#3c2225)}.line-number{width:40px;flex:none;text-align:right;padding-right:9px;color:var(--s-dim);opacity:.75;user-select:none}.sign{width:22px;flex:none;text-align:center;user-select:none}.diff-line.added .sign{color:light-dark(#167349,#81cf9e)}.diff-line.removed .sign{color:light-dark(#b64242,#eda0a0)}code{font:inherit;white-space:pre;tab-size:2;padding-right:16px}.diff-gap{display:block;width:100%;border:0;border-block:1px solid var(--s-border);background:var(--s-muted);color:var(--s-dim);text-align:left;padding:7px 14px;font-size:11px;cursor:pointer}.diff-gap:hover{color:var(--s-accent)}button:focus-visible{outline:2px solid var(--s-accent);outline-offset:-2px}
</style>
