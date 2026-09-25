<script setup lang="ts">
import {ref,watch} from 'vue'
import {highlightCode} from './syntax-highlight'
import {highlightSource,sourceLanguage} from './code-highlighter'
const props=defineProps<{code:string;language?:string;fragment?:boolean}>()
const html=ref('')
watch(()=>[props.code,props.language,props.fragment] as const,async([code,language,fragment],_old,onCleanup)=>{
 let stale=false;onCleanup(()=>{stale=true})
 const syntax=sourceLanguage(code,language,fragment)
 html.value=highlightCode(code,syntax)
 const output=await highlightSource(code,syntax)
 if(!stale)html.value=output
},{immediate:true})
</script>
<template><pre class="highlighted-code syntax-colored"><code v-html="html"></code></pre></template>
<style scoped>
.highlighted-code{margin:0;padding:12px 14px;overflow:auto;white-space:pre;tab-size:2;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--s-text,var(--text-primary));background:var(--s-panel,var(--surface));max-height:500px}.highlighted-code code{font:inherit}
</style>

<style scoped src="./code-token-colors.css"></style>
