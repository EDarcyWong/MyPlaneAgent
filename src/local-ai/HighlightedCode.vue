<script setup lang="ts">
import {ref,watch} from 'vue'
import {LanguageDescription} from '@codemirror/language'
import {languages} from '@codemirror/language-data'
import {highlightTree,tagHighlighter,tags} from '@lezer/highlight'
import {highlightCode,syntaxLanguage} from './syntax-highlight'
const props=defineProps<{code:string;language?:string}>()
const html=ref('')
const escape=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const colors=tagHighlighter([
 {tag:tags.keyword,class:'tok-keyword'},{tag:tags.comment,class:'tok-comment'},
 {tag:[tags.string,tags.regexp],class:'tok-string'},{tag:tags.number,class:'tok-number'},
 {tag:[tags.bool,tags.null,tags.atom],class:'tok-keyword'},
 {tag:[tags.propertyName,tags.attributeName],class:'tok-property'},
 {tag:[tags.typeName,tags.className],class:'tok-type'},
 {tag:[tags.function(tags.variableName),tags.function(tags.propertyName)],class:'tok-function'},
 {tag:tags.tagName,class:'tok-tag'},{tag:tags.operator,class:'tok-operator'},
 {tag:[tags.meta,tags.annotation],class:'tok-meta'}
])
watch([()=>props.code,()=>props.language],async([code,language],_old,onCleanup)=>{
 let stale=false;onCleanup(()=>{stale=true})
 const name=syntaxLanguage(language)
 html.value=highlightCode(code,name)
 if(code.length>200000||name==='text'||name==='diff')return
 const description=LanguageDescription.matchFilename(languages,language||'')||LanguageDescription.matchLanguageName(languages,name==='markup'?'html':name)
 if(!description)return
 try{
  const support=await description.load();if(stale)return
  let output='',last=0
  highlightTree(support.language.parser.parse(code),colors,(from,to,classes)=>{
   output+=escape(code.slice(last,from))+`<span class="${classes}">${escape(code.slice(from,to))}</span>`;last=to
  })
  html.value=output+escape(code.slice(last))
 }catch{/* Keep escaped fallback if a language module cannot load. */}
},{immediate:true})
</script>
<template><pre class="highlighted-code"><code v-html="html"></code></pre></template>
<style scoped>
.highlighted-code{margin:0;padding:12px 14px;overflow:auto;white-space:pre;tab-size:2;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--s-text,var(--text-primary));background:var(--s-panel,var(--surface));max-height:500px}.highlighted-code code{font:inherit}
.highlighted-code :deep(.tok-comment){color:light-dark(#607466,#94a69b);font-style:italic}.highlighted-code :deep(.tok-keyword){color:light-dark(#8754b1,#cba6f7);font-weight:550}.highlighted-code :deep(.tok-string){color:light-dark(#47752d,#b9cf8b)}.highlighted-code :deep(.tok-number){color:light-dark(#a35b20,#e5b781)}.highlighted-code :deep(.tok-property),.highlighted-code :deep(.tok-attr){color:light-dark(#24718e,#89c9ee)}.highlighted-code :deep(.tok-type){color:light-dark(#93691d,#e2c27f)}.highlighted-code :deep(.tok-tag),.highlighted-code :deep(.tok-deleted){color:light-dark(#b04242,#ee9999)}.highlighted-code :deep(.tok-function),.highlighted-code :deep(.tok-inserted){color:light-dark(#167460,#82c8b5)}.highlighted-code :deep(.tok-operator){color:light-dark(#8c5075,#d1a4bf)}.highlighted-code :deep(.tok-meta){color:var(--s-dim)}.highlighted-code :deep(.tok-variable){color:light-dark(#376fa4,#8db7e8)}
</style>
