<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {Close,CopyDocument,Delete,FolderOpened,FullScreen,Refresh,ScaleToOriginal,Search,VideoPause,VideoPlay} from '@element-plus/icons-vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import type {ApplicationLogEntry,ApplicationLogLevel} from '../../electron/shared/application-log'

const emit=defineEmits<{close:[]}>()
const entries=ref<ApplicationLogEntry[]>([])
const query=ref(''),source=ref(''),level=ref<'ALL'|ApplicationLogLevel>('ALL')
const loading=ref(false),paused=ref(false),follow=ref(true),error=ref('')
const output=ref<HTMLElement>(),panelHeight=ref(360),expandedPanel=ref(false)
const expandedRows=ref(new Set<string>())
let timer:ReturnType<typeof setInterval>|undefined
let resizing:{startY:number;height:number}|undefined
let previousHeight=360
let refreshing=false

const levelOptions=[{id:'ALL',label:'全部'},{id:'ERROR',label:'错误'},{id:'WARN',label:'警告'},{id:'INFO',label:'信息'},{id:'DEBUG',label:'调试'}] as const
const sources=computed(()=>[...new Set(entries.value.map(entry=>entry.scope))].sort((a,b)=>a.localeCompare(b)))
const searched=computed(()=>{const text=query.value.trim().toLowerCase();return entries.value.filter(entry=>(!source.value||entry.scope===source.value)&&(!text||`${entry.scope} ${entry.message}`.toLowerCase().includes(text)))})
const counts=computed(()=>{const result:{[key in 'ALL'|ApplicationLogLevel]:number}={ALL:0,ERROR:0,WARN:0,INFO:0,DEBUG:0};for(const entry of searched.value){result.ALL++;result[entry.level]++}return result})
const visible=computed(()=>level.value==='ALL'?searched.value:searched.value.filter(entry=>entry.level===level.value))
const hasFilters=computed(()=>!!query.value.trim()||!!source.value||level.value!=='ALL')
const time=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleTimeString()}
const dateTime=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString()}
const rowKey=(entry:ApplicationLogEntry)=>`${entry.timestamp}|${entry.scope}|${entry.level}|${entry.message.slice(0,100)}`
const isLong=(entry:ApplicationLogEntry)=>entry.message.length>220||entry.message.includes('\n')
function toggleRow(entry:ApplicationLogEntry){const key=rowKey(entry),next=new Set(expandedRows.value);if(next.has(key))next.delete(key);else next.add(key);expandedRows.value=next}
function clearFilters(){query.value='';source.value='';level.value='ALL'}
function scrollToLatest(){void nextTick(()=>output.value?.scrollTo({top:output.value.scrollHeight}))}
watch([query,source,level],()=>{if(follow.value)scrollToLatest()})
watch(follow,value=>{if(value)scrollToLatest()})
function onWheel(event:WheelEvent){if(event.deltaY<0)follow.value=false}

async function refresh(quiet=false){
 if(refreshing)return
 refreshing=true
 if(!quiet)loading.value=true
 try{
  const result=await window.myplane.applicationLogs('read',2000)
  const before=entries.value,lastBefore=before.at(-1),lastAfter=result.entries.at(-1)
  const changed=before.length!==result.entries.length||lastBefore?.timestamp!==lastAfter?.timestamp||lastBefore?.message!==lastAfter?.message
  if(changed){entries.value=result.entries;if(follow.value)scrollToLatest()}
  error.value=''
 }catch(cause){error.value=String(cause)}finally{loading.value=false;refreshing=false}
}
function togglePause(){paused.value=!paused.value;if(!paused.value)void refresh()}
async function clearLogs(){
 try{await ElMessageBox.confirm('清空当前日志及所有轮转日志？','清空应用日志',{confirmButtonText:'清空',cancelButtonText:'取消',type:'warning'});const result=await window.myplane.applicationLogs('clear');entries.value=result.entries;expandedRows.value=new Set();ElMessage.success('应用日志已清空')}
 catch(cause){if(cause!=='cancel'&&cause!=='close')error.value=String(cause)}
}
async function copyLogs(){try{await navigator.clipboard.writeText(visible.value.map(entry=>`${entry.timestamp} [${entry.level}] [${entry.scope}] ${entry.message}`).join('\n'));ElMessage.success(`已复制 ${visible.value.length} 条日志`)}catch(cause){error.value=String(cause)}}
async function openDirectory(){try{await window.myplane.applicationLogs('openDirectory')}catch(cause){error.value=String(cause)}}

function maxPanelHeight(){return Math.max(220,Math.min(Math.round(window.innerHeight*.7),window.innerHeight-180))}
function clampHeight(value:number){return Math.max(180,Math.min(value,maxPanelHeight()))}
function startResize(event:PointerEvent){if(event.button!==0)return;resizing={startY:event.clientY,height:panelHeight.value};(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);event.preventDefault()}
function moveResize(event:PointerEvent){if(!resizing)return;panelHeight.value=clampHeight(resizing.height+resizing.startY-event.clientY);expandedPanel.value=false}
function endResize(event:PointerEvent){resizing=undefined;const handle=event.currentTarget as HTMLElement;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId)}
function resizeWithKeyboard(event:KeyboardEvent){if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();panelHeight.value=clampHeight(panelHeight.value+(event.key==='ArrowUp'?32:-32));expandedPanel.value=false}}
function toggleExpand(){if(expandedPanel.value){panelHeight.value=clampHeight(previousHeight);expandedPanel.value=false}else{previousHeight=panelHeight.value;panelHeight.value=clampHeight(window.innerHeight);expandedPanel.value=true}}

onMounted(()=>{panelHeight.value=clampHeight(panelHeight.value);void refresh();timer=setInterval(()=>{if(!paused.value)void refresh(true)},2000)})
onBeforeUnmount(()=>{if(timer)clearInterval(timer)})
</script>

<template>
 <section class="application-log-output" :style="{height:panelHeight+'px'}" aria-label="日志输出">
  <div class="log-resize-handle" role="separator" aria-label="调整日志窗口高度" aria-orientation="horizontal" aria-valuemin="180" :aria-valuenow="panelHeight" :aria-valuemax="maxPanelHeight()" tabindex="0" @pointerdown="startResize" @pointermove="moveResize" @pointerup="endResize" @pointercancel="endResize" @keydown="resizeWithKeyboard"><span/></div>
  <header class="log-header">
   <div class="log-heading"><div class="log-heading-icon" aria-hidden="true"><span>&gt;_</span></div><strong>日志输出</strong><span class="log-header-tag">CONSOLE</span><span class="log-total">{{visible.length}} / {{entries.length}}</span><span class="log-live" :class="{paused}"><i/>{{paused?'已暂停':'实时更新'}}</span></div>
   <div class="log-actions">
    <button class="log-action" :title="paused?'继续自动刷新':'暂停自动刷新'" :aria-label="paused?'继续自动刷新':'暂停自动刷新'" @click="togglePause"><VideoPlay v-if="paused"/><VideoPause v-else/></button>
    <button class="log-action" title="立即刷新" aria-label="刷新应用日志" @click="refresh()"><Refresh :class="{spinning:loading}"/></button>
    <span class="log-action-divider"/>
    <button class="log-action" :disabled="!visible.length" title="复制当前筛选结果" aria-label="复制应用日志" @click="copyLogs"><CopyDocument/></button>
    <button class="log-action" title="打开日志目录" aria-label="打开应用日志目录" @click="openDirectory"><FolderOpened/></button>
    <button class="log-action danger" title="清空所有日志" aria-label="清空应用日志" @click="clearLogs"><Delete/></button>
    <span class="log-action-divider"/>
    <button class="log-action" :title="expandedPanel?'恢复窗口高度':'展开日志窗口'" :aria-label="expandedPanel?'恢复窗口高度':'展开日志窗口'" @click="toggleExpand"><ScaleToOriginal v-if="expandedPanel"/><FullScreen v-else/></button>
    <button class="log-action" title="关闭日志窗口" aria-label="关闭日志输出" @click="emit('close')"><Close/></button>
   </div>
  </header>
  <div class="log-filter-bar">
   <label class="log-search"><Search/><input v-model="query" placeholder="搜索日志内容" aria-label="筛选应用日志"/><button v-if="query" title="清除搜索" aria-label="清除搜索" @click="query=''"><Close/></button></label>
   <div class="log-levels" role="group" aria-label="按日志等级筛选"><button v-for="item in levelOptions" :key="item.id" :class="['filter-'+item.id.toLowerCase(),{active:level===item.id}]" :aria-pressed="level===item.id" @click="level=item.id">{{item.label}}<span>{{counts[item.id]}}</span></button></div>
   <select v-model="source" class="log-source" aria-label="按日志来源筛选"><option value="">全部来源</option><option v-for="item in sources" :key="item" :value="item">{{item}}</option></select>
   <button class="log-follow" :class="{active:follow}" :aria-pressed="follow" @click="follow=!follow"><i/>自动滚动</button>
  </div>
  <p v-if="error" class="log-output-error" role="alert">{{error}}</p>
  <div class="log-column-head" aria-hidden="true"><span>#</span><span>时间</span><span>等级</span><span>来源</span><span>内容</span></div>
  <div ref="output" class="log-output-list" role="log" aria-live="off" @wheel.passive="onWheel">
   <div v-for="(entry,index) in visible" :key="rowKey(entry)+index" class="log-output-row" :class="'level-'+entry.level.toLowerCase()"><small class="log-line-number">{{String(index+1).padStart(4,'0')}}</small><time :title="dateTime(entry.timestamp)">{{time(entry.timestamp)}}</time><b>{{entry.level}}</b><span :title="entry.scope">{{entry.scope}}</span><div class="log-message"><pre :class="{clamped:isLong(entry)&&!expandedRows.has(rowKey(entry))}">{{entry.message}}</pre><button v-if="isLong(entry)" @click="toggleRow(entry)">{{expandedRows.has(rowKey(entry))?'收起':'展开全文'}}</button></div></div>
   <div v-if="!visible.length&&!loading" class="log-output-empty"><strong>{{entries.length?'没有符合条件的日志':'还没有日志'}}</strong><p>{{entries.length?'调整搜索、等级或来源筛选后再试。':'应用运行时，日志会自动显示在这里。'}}</p><button v-if="hasFilters" @click="clearFilters">清除筛选</button></div>
  </div>
 </section>
</template>

<style scoped src="./studio-logs.css"></style>
