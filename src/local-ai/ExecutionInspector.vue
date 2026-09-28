<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {ArrowDown,ArrowUp,VideoPause,VideoPlay,Close,Operation,TopRight} from '@element-plus/icons-vue'
import type {InspectionCall,InspectionCommand,InspectionState} from '../../electron/shared/execution-inspector'
import type {StudioMessage} from '../../electron/shared/local-ai-studio'

const props=defineProps<{enabled?:boolean;requestId:string;historyRequestId?:string;sessionId?:string;message?:Pick<StudioMessage,'content'|'reasoning'>;detached?:boolean}>()
const emit=defineEmits<{close:[];stop:[];detach:[]}>()
const state=ref<InspectionState>({pauseRequested:false,calls:[]}),collapsed=ref(false),busy=ref(false),error=ref('')
const selectedId=ref(''),draft=ref(''),lastRequest=ref(''),lastContent=ref(''),lastReasoning=ref('')
const paused=computed(()=>state.value.calls.find(call=>call.id===state.value.checkpointId))
const selected=computed(()=>state.value.calls.find(call=>call.id===selectedId.value)||state.value.calls.at(-1))
const visible=computed(()=>props.enabled||!!paused.value||state.value.pauseRequested)
const active=computed(()=>!!props.requestId&&!state.value.finished)
const labels:Record<InspectionCall['status'],string>={paused:'已暂停',ready:'待执行 / 待审批',running:'执行中',complete:'已完成',error:'失败 / 已停止'}
const json=(value:unknown)=>JSON.stringify(value,null,2)
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false,generation=0,mutation=0
function apply(next:InspectionState){
 const previous=state.value.checkpointId
 const following=!selectedId.value||selectedId.value===state.value.calls.at(-1)?.id
 state.value=next
 if(next.checkpointId&&next.checkpointId!==previous){selectedId.value=next.checkpointId;draft.value=next.draft??json(paused.value?.args);collapsed.value=false}
 else if(following)selectedId.value=next.calls.at(-1)?.id||''
}
async function poll(){
 const requestId=lastRequest.value,version=generation,revision=mutation
 if(disposed||!requestId)return
 try{
  const next=await window.myplane.localAiStudio('chatInspect',{requestId,action:'state'})
  if(disposed||version!==generation)return
  if(revision===mutation&&!busy.value)apply(next)
 }catch{/* The renderer sets requestId before the backend creates the run. Retry during startup. */}
 if(!disposed&&version===generation&&!state.value.finished&&(props.requestId||state.value.calls.length))timer=setTimeout(poll,500)
}
watch(()=>[props.sessionId,props.requestId,props.historyRequestId],([session,id,history],previous)=>{
 if(session!==previous?.[0]){generation++;clearTimeout(timer);lastRequest.value='';state.value={pauseRequested:false,calls:[]};selectedId.value='';draft.value='';error.value=''}
 const target=id||history||lastRequest.value
 if(!target)return
 if(target!==lastRequest.value){generation++;lastRequest.value=target;state.value={pauseRequested:false,calls:[]};selectedId.value='';draft.value='';error.value=''}
 clearTimeout(timer);void poll()
},{immediate:true})
let draftWrite:Promise<unknown>=Promise.resolve()
function saveDraft(){
 if(!paused.value||!props.requestId)return
 const checkpointId=paused.value.id,value=draft.value,requestId=props.requestId
 draftWrite=draftWrite.catch(()=>{}).then(()=>window.myplane.localAiStudio('chatInspect',{requestId,action:'draft',checkpointId,draft:value})).catch(cause=>{error.value=String(cause)})
}
async function detach(){await draftWrite;emit('detach')}
watch(()=>[props.message?.content,props.message?.reasoning],()=>{lastContent.value=props.message?.content||'';lastReasoning.value=props.message?.reasoning||''},{immediate:true})
async function control(action:InspectionCommand['action']){
 if(busy.value||!props.requestId)return
 busy.value=true;error.value='';mutation++
 const version=generation
 try{
  const command:InspectionCommand={requestId:props.requestId,action}
  if(paused.value&&(action==='continue'||action==='step')){
   const args=JSON.parse(draft.value)
   if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('入参必须是 JSON 对象')
   command.checkpointId=paused.value.id;command.args=args
  }
  const next=await window.myplane.localAiStudio('chatInspect',command)
  if(version===generation)apply(next)
 }catch(cause){if(version===generation)error.value=String(cause)}finally{busy.value=false}
}
const position=ref<{left:number;top:number}>(),panel=ref<HTMLElement>()
let drag:{x:number;y:number;left:number;top:number}|undefined
function startDrag(event:PointerEvent){
 if((event.target as HTMLElement).closest('button')||event.button!==0||!panel.value)return
 const rect=panel.value.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top}
 ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveDrag(event:PointerEvent){if(drag&&panel.value){position.value={left:Math.max(0,Math.min(window.innerWidth-panel.value.offsetWidth,drag.left+event.clientX-drag.x)),top:Math.max(0,Math.min(window.innerHeight-44,drag.top+event.clientY-drag.y))}}}
onBeforeUnmount(()=>{disposed=true;generation++;clearTimeout(timer)})
</script>

<template>
 <aside v-if="visible" ref="panel" class="execution-inspector" :class="{collapsed,detached}" :style="position&&!detached?{left:position.left+'px',top:position.top+'px',right:'auto',bottom:'auto'}:undefined" aria-label="对话执行检查器">
  <header v-if="!detached" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="drag=undefined" @lostpointercapture="drag=undefined">
   <Operation/><strong>执行检查器</strong><span class="run-status">{{ paused?'已暂停':state.finished?'本轮已结束':active?'对话进行中':'等待对话' }}</span>
   <button aria-label="在独立窗口打开执行检查器" @click="detach"><TopRight/></button>
   <button :aria-label="collapsed?'展开执行检查器':'收起执行检查器'" :aria-expanded="!collapsed" @click="collapsed=!collapsed"><ArrowUp v-if="collapsed"/><ArrowDown v-else/></button>
   <button aria-label="关闭执行检查器" :disabled="!!paused||state.pauseRequested" title="暂停或等待暂停时，请先继续或停止对话" @click="emit('close')"><Close/></button>
  </header>
  <div v-show="!collapsed" class="inspector-body">
   <p v-if="detached" class="run-status">{{ paused?'已暂停':state.finished?'本轮已结束':active?'对话进行中':'等待对话' }}</p>
   <div class="controls">
    <template v-if="paused">
     <button class="primary" data-inspect-action="continue" :disabled="busy" @click="control('continue')"><VideoPlay/>应用并继续</button>
     <button data-inspect-action="step" :disabled="busy" @click="control('step')">单步执行</button>
     <button @click="selectedId=paused!.id">定位暂停点</button>
    </template>
    <button v-else-if="state.pauseRequested" :disabled="busy||!active" @click="control('continue')">取消等待暂停</button>
    <button v-else data-inspect-action="pause" :disabled="busy||!active" @click="control('pause')"><VideoPause/>下次调用前暂停</button>
    <button :disabled="!active" @click="emit('stop')">停止对话</button>
   </div>
   <p class="hint">{{ paused?'修改入参后继续，或单步执行并在下次调用前再次暂停。':state.pauseRequested?'等待下一个能力或工具调用；当前运行中的操作会先完成。':'显示本轮最近 60 次能力、插件、MCP 和内置工具调用。暂停在执行前生效。' }}</p>
   <p v-if="error" role="alert" class="error">{{ error }}</p>
   <label class="call-selector">调用记录
    <select :value="selected?.id||''" aria-label="查看调用记录" @change="selectedId=($event.target as HTMLSelectElement).value">
     <option v-if="!state.calls.length" value="">等待调用…</option>
     <option v-for="(call,index) in state.calls" :key="call.id" :value="call.id">{{ index+1 }} · {{ call.name }} · {{ labels[call.status] }}</option>
    </select>
   </label>
   <section v-if="selected" class="call-details">
    <div class="call-meta"><strong>{{ selected.name }}</strong><span>{{ selected.source }} · {{ labels[selected.status] }}{{ selected.edited?' · 已改参':'' }}</span></div>
    <label v-if="selected.id===paused?.id" class="argument-editor">入参（JSON，可编辑）<textarea v-model="draft" aria-label="暂停调用入参" spellcheck="false" :disabled="busy" @input="saveDraft"/><button :disabled="busy" @click="draft=json(paused?.originalArgs);saveDraft()">恢复原始入参</button></label>
    <details v-else open><summary>实际入参</summary><pre>{{ json(selected.args) }}</pre></details>
    <details v-if="selected.edited"><summary>Agent 原始入参</summary><pre>{{ json(selected.originalArgs) }}</pre></details>
    <details><summary>参数格式约束</summary><pre>{{ json(selected.schema) }}</pre></details>
    <details v-if="selected.output!==undefined" open><summary>执行输出</summary><pre>{{ selected.output }}</pre></details>
   </section>
   <details class="ai-output" open><summary>AI 输出</summary><pre>{{ lastContent||'尚无文本输出' }}</pre></details>
   <details v-if="lastReasoning"><summary>模型返回的思考文本</summary><pre>{{ lastReasoning }}</pre></details>
   <p class="hint">改参仍受格式校验和权限审批约束。已运行的调用不能回退改参。记录仅保留在当前应用会话中。</p>
  </div>
 </aside>
</template>

<style scoped>
.execution-inspector{position:fixed;right:24px;bottom:24px;z-index:90;width:470px;height:590px;min-width:300px;min-height:220px;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);resize:both;overflow:hidden;display:flex;flex-direction:column;border:1px solid var(--s-border);border-radius:12px;background:var(--s-panel);color:var(--s-text);box-shadow:0 12px 44px #0003;font-size:12px}.execution-inspector.collapsed{height:auto!important;min-height:0;resize:none}header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--s-accent-soft);cursor:move;touch-action:none;flex:none}header strong{white-space:nowrap}svg{width:16px;height:16px;flex:none}.run-status{margin-left:auto;color:var(--s-dim);font-size:11px}button{font:inherit;color:inherit;border:1px solid var(--s-border);border-radius:6px;background:var(--s-bg);padding:6px 9px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px}header button{padding:4px;border:0;background:transparent}button:disabled{opacity:.45;cursor:default}button:hover:not(:disabled){background:var(--s-muted)}button.primary{background:var(--s-accent);color:var(--s-on-accent)}.inspector-body{padding:12px;overflow:auto;flex:1;min-height:0}.controls{display:flex;flex-wrap:wrap;gap:6px}.hint{font-size:11px;line-height:1.65;color:var(--s-dim);margin:10px 0}.call-selector,.argument-editor{display:grid;gap:8px}.call-selector select{width:100%;min-width:0;padding:8px;background:var(--s-bg);color:inherit;border:1px solid var(--s-border);border-radius:6px;font:inherit}.call-meta{display:grid;gap:5px;margin:14px 0;overflow-wrap:anywhere}.call-meta span{color:var(--s-dim);font-size:11px}.argument-editor textarea{box-sizing:border-box;width:100%;min-height:170px;resize:vertical;padding:10px;border:1px solid var(--s-accent);border-radius:6px;background:var(--s-bg);color:inherit;font:12px/1.6 var(--app-code-font-family,monospace)}.argument-editor button{justify-self:start}details{margin-top:12px;border-top:1px solid var(--s-border);padding-top:10px}summary{cursor:pointer;font-weight:500}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:230px;overflow:auto;background:var(--s-bg);padding:10px;border-radius:6px;font:12px/1.6 var(--app-code-font-family,monospace);user-select:text}.error{color:var(--s-danger,#c74444);white-space:pre-wrap}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--s-accent);outline-offset:2px}@media(max-width:540px){.execution-inspector{right:12px;bottom:12px;width:calc(100vw - 24px);min-width:260px}}
</style>

<style scoped>
.execution-inspector.detached{position:static;box-sizing:border-box;width:100%;height:100%;min-width:0;min-height:0;max-width:none;max-height:none;resize:none;border:0;border-radius:0;box-shadow:none}.detached .inspector-body{padding:14px}.detached .run-status{margin:0 0 12px}.detached .controls{position:sticky;top:0;background:var(--s-panel);padding-bottom:6px;z-index:1}
</style>
