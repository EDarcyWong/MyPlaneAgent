<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref} from 'vue'
import {Close,CopyDocument,Delete,FolderOpened,Refresh} from '@element-plus/icons-vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import type {ApplicationLogEntry,ApplicationLogLevel} from '../../electron/shared/application-log'

const emit=defineEmits<{close:[]}>()
const entries=ref<ApplicationLogEntry[]>([]),filter=ref(''),level=ref<'ALL'|ApplicationLogLevel>('ALL'),loading=ref(false),follow=ref(true),error=ref(''),output=ref<HTMLElement>()
let timer:ReturnType<typeof setInterval>|undefined
const visible=computed(()=>{const query=filter.value.trim().toLowerCase();return entries.value.filter(entry=>(level.value==='ALL'||entry.level===level.value)&&(!query||`${entry.scope} ${entry.message}`.toLowerCase().includes(query)))})
const time=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleTimeString()}
async function refresh(quiet=false){
 if(!quiet)loading.value=true
 try{const result=await window.myplane.applicationLogs('read',2000);entries.value=result.entries;error.value='';if(follow.value){await nextTick();output.value?.scrollTo({top:output.value.scrollHeight})}}
 catch(cause){error.value=String(cause)}finally{loading.value=false}
}
async function clearLogs(){
 try{await ElMessageBox.confirm('清空当前日志及所有轮转日志？','清空应用日志',{confirmButtonText:'清空',cancelButtonText:'取消',type:'warning'});const result=await window.myplane.applicationLogs('clear');entries.value=result.entries;ElMessage.success('应用日志已清空')}
 catch(cause){if(cause!=='cancel'&&cause!=='close')error.value=String(cause)}
}
async function copyLogs(){try{await navigator.clipboard.writeText(visible.value.map(entry=>`${entry.timestamp} [${entry.level}] [${entry.scope}] ${entry.message}`).join('\n'));ElMessage.success('日志已复制')}catch(cause){error.value=String(cause)}}
async function openDirectory(){try{await window.myplane.applicationLogs('openDirectory')}catch(cause){error.value=String(cause)}}
onMounted(()=>{void refresh();timer=setInterval(()=>void refresh(true),2000)})
onBeforeUnmount(()=>{if(timer)clearInterval(timer)})
</script>

<template>
 <section class="application-log-output" aria-label="日志输出">
  <header><div class="log-title"><strong>日志输出</strong><span>{{visible.length}} / {{entries.length}}</span></div><div class="log-controls"><label><span class="sr-only">筛选日志</span><input v-model="filter" placeholder="筛选内容或来源" aria-label="筛选应用日志"/></label><select v-model="level" aria-label="日志等级"><option value="ALL">全部等级</option><option value="ERROR">错误</option><option value="WARN">警告</option><option value="INFO">信息</option><option value="DEBUG">调试</option></select><label class="log-follow"><input v-model="follow" type="checkbox"/>跟随</label><button class="icon-btn" :class="{spinning:loading}" title="刷新" aria-label="刷新应用日志" @click="refresh()"><Refresh/></button><button class="icon-btn" title="复制" aria-label="复制应用日志" :disabled="!visible.length" @click="copyLogs"><CopyDocument/></button><button class="icon-btn" title="打开日志目录" aria-label="打开应用日志目录" @click="openDirectory"><FolderOpened/></button><button class="icon-btn danger-text" title="清空" aria-label="清空应用日志" @click="clearLogs"><Delete/></button><button class="icon-btn" title="关闭" aria-label="关闭日志输出" @click="emit('close')"><Close/></button></div></header>
  <p v-if="error" class="log-output-error" role="alert">{{error}}</p>
  <div ref="output" class="log-output-list" role="log" aria-live="polite">
   <div v-for="(entry,index) in visible" :key="entry.timestamp+index" class="log-output-row" :class="'level-'+entry.level.toLowerCase()"><time>{{time(entry.timestamp)}}</time><b>{{entry.level}}</b><span>{{entry.scope}}</span><pre>{{entry.message}}</pre></div>
   <div v-if="!visible.length&&!loading" class="log-output-empty">没有符合条件的日志。</div>
  </div>
 </section>
</template>

<style scoped src="./studio-logs.css"></style>
