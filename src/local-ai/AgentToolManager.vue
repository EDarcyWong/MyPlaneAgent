<script setup lang="ts">
import {computed,onMounted,reactive,ref} from 'vue'
import {ElMessage,ElMessageBox} from 'element-plus'
import {Refresh,Check,VideoPlay,Clock,Search,EditPen,Document,Warning,MagicStick} from '@element-plus/icons-vue'
import type {AgentProject} from '../../electron/shared/local-ai-agent'
import type {AgentToolRisk,AgentToolView} from '../../electron/shared/local-ai-tools'

type Section='edit'|'test'|'versions'
type Filter='all'|'builtin'|'custom'|'disabled'
const tools=ref<AgentToolView[]>([]),projects=ref<AgentProject[]>([]),selectedId=ref(''),busy=ref(false),error=ref('')
const schemaText=ref('{}'),testArgs=ref('{}'),testProject=ref(''),testOutput=ref(''),query=ref(''),filter=ref<Filter>('all'),section=ref<Section>('edit'),baseline=ref('')
const draft=reactive({key:'',name:'',description:'',python:'def execute(args, context):\n    return {"message": "hello", "args": args}\n',risk:'high' as AgentToolRisk,timeoutMs:30000,changeNote:''})
const selected=computed(()=>tools.value.find(item=>item.id===selectedId.value))
const snapshot=()=>JSON.stringify({key:draft.key,name:draft.name,description:draft.description,python:draft.python,risk:draft.risk,timeoutMs:draft.timeoutMs,changeNote:draft.changeNote,schema:schemaText.value})
const dirty=computed(()=>snapshot()!==baseline.value)
const counts=computed(()=>({all:tools.value.length,builtin:tools.value.filter(item=>item.builtin).length,custom:tools.value.filter(item=>!item.builtin).length,disabled:tools.value.filter(item=>!item.enabled).length}))
const filtered=computed(()=>{const word=query.value.trim().toLocaleLowerCase();return tools.value.filter(item=>(filter.value==='all'||filter.value==='builtin'&&item.builtin||filter.value==='custom'&&!item.builtin||filter.value==='disabled'&&!item.enabled)&&(!word||[item.key,item.current.name,item.current.description].some(value=>value.toLocaleLowerCase().includes(word))))})
const riskLabel=(risk:AgentToolRisk)=>({read:'只读',write:'写入',high:'高风险'}[risk])
const timeoutLabel=computed(()=>draft.timeoutMs>=60000?`${draft.timeoutMs/60000} 分钟`:`${draft.timeoutMs/1000} 秒`)

function load(item?:AgentToolView){selectedId.value=item?.id||'';if(item)Object.assign(draft,{key:item.key,name:item.current.name,description:item.current.description,python:item.current.python,risk:item.current.risk,timeoutMs:item.current.timeoutMs,changeNote:''});else Object.assign(draft,{key:'',name:'',description:'',python:'def execute(args, context):\n    return {"message": "hello", "args": args}\n',risk:'high',timeoutMs:30000,changeNote:''});schemaText.value=JSON.stringify(item?.current.parameters||{type:'object',properties:{},required:[],additionalProperties:false},null,2);testOutput.value='';section.value='edit';baseline.value=snapshot()}
async function leaveDraft(){if(!dirty.value)return true;try{await ElMessageBox.confirm('当前修改尚未应用，离开后将丢失。','放弃未保存修改？',{confirmButtonText:'放弃修改',cancelButtonText:'继续编辑',type:'warning'});return true}catch{return false}}
async function open(id:string){if(id===selectedId.value||!await leaveDraft())return;load(tools.value.find(tool=>tool.id===id))}
async function create(){if(!await leaveDraft())return;load()}
defineExpose({create})
async function refresh(select?:string){[tools.value,projects.value]=await Promise.all([window.myplane.localAiStudio('agentToolsList'),window.myplane.localAiStudio('agentProjects')]);if(!testProject.value)testProject.value=projects.value[0]?.id||'';load(tools.value.find(tool=>tool.id===(select||selectedId.value))||tools.value[0])}
async function requestRefresh(){if(await leaveDraft())await run(()=>refresh())}
async function run(work:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';try{await work()}catch(cause){error.value=String(cause).replace(/^Error: (?:Error invoking remote method '[^']+': Error: )?/,'')}finally{busy.value=false}}
function parseJson(text:string,label:string){try{return JSON.parse(text)}catch(cause){throw new Error(`${label}不是有效 JSON：${cause instanceof Error?cause.message:String(cause)}`)}}
function formatJson(kind:'schema'|'args'){try{if(kind==='schema')schemaText.value=JSON.stringify(parseJson(schemaText.value,'参数 Schema'),null,2);else testArgs.value=JSON.stringify(parseJson(testArgs.value,'测试参数'),null,2)}catch(cause){error.value=String(cause).replace(/^Error: /,'')}}
async function save(){await run(async()=>{const saved=await window.myplane.localAiStudio('agentToolSave',{...(selected.value?{id:selected.value.id}:{}),key:draft.key,name:draft.name,description:draft.description,parameters:parseJson(schemaText.value,'参数 Schema'),python:draft.python,risk:draft.risk,timeoutMs:draft.timeoutMs,changeNote:draft.changeNote});await refresh(saved.id);ElMessage.success(`已应用 ${saved.key} v${saved.activeVersion}，新任务可立即使用`)})}
async function toggle(item:AgentToolView){await run(async()=>{const enabled=!item.enabled,updated=await window.myplane.localAiStudio('agentToolToggle',{id:item.id,enabled});const index=tools.value.findIndex(tool=>tool.id===item.id);if(index>=0)tools.value.splice(index,1,updated);ElMessage.success(enabled?'工具已启用':'工具已停用')})}
async function restore(version:number){if(!selected.value)return;await run(async()=>{await ElMessageBox.confirm(`将 v${version} 的内容复制为新版本并立即应用。`,'恢复工具版本',{confirmButtonText:'恢复为新版本',cancelButtonText:'取消'});const saved=await window.myplane.localAiStudio('agentToolRestore',{id:selected.value!.id,version});await refresh(saved.id);section.value='versions'})}
async function test(){if(!selected.value||!testProject.value)return;await run(async()=>{const result=await window.myplane.localAiStudio('agentToolTest',{id:selected.value!.id,projectId:testProject.value,arguments:parseJson(testArgs.value,'测试参数')});try{testOutput.value=JSON.stringify(JSON.parse(result.output),null,2)}catch{testOutput.value=result.output}testOutput.value+=`\n\n耗时 ${result.elapsedMs} ms`})}
onMounted(()=>run(()=>refresh()))
</script>

<template><main class="tool-manager">
 <p v-if="error" class="tool-error" role="alert"><Warning/><span>{{error}}</span><button @click="error=''">关闭</button></p>
 <div class="tool-layout">
  <aside class="tool-browser">
   <header class="tool-browser-head"><div><h2>工具列表</h2><span>{{counts.all}} 个工具 · 本机 Python</span></div><button class="icon-action" :disabled="busy" title="刷新工具" aria-label="刷新工具" @click="requestRefresh"><Refresh/></button></header>
   <div class="tool-search"><Search/><input v-model="query" placeholder="搜索名称、标识或说明" aria-label="搜索工具"/></div>
   <div class="tool-filters"><button v-for="item in ([['all','全部'],['builtin','内置'],['custom','自定义'],['disabled','停用']] as const)" :key="item[0]" :class="{active:filter===item[0]}" :aria-pressed="filter===item[0]" @click="filter=item[0]">{{item[1]}}<span>{{counts[item[0]]}}</span></button></div>
   <div class="tool-list"><button v-for="item in filtered" :key="item.id" :class="{active:selectedId===item.id,disabled:!item.enabled}" :aria-pressed="selectedId===item.id" :title="`${item.current.description||item.key} · ${item.builtin?'内置':'自定义'}`" @click="open(item.id)"><span class="tool-copy"><span class="tool-primary"><strong>{{item.current.name||item.key}}</strong><i :class="{enabled:item.enabled}" :title="item.enabled?'已启用':'已停用'"></i></span><small><code v-if="item.current.name&&item.current.name!==item.key">{{item.key}}</code><span>v{{item.activeVersion}}</span><b :class="'risk-'+item.current.risk">{{riskLabel(item.current.risk)}}</b></small></span></button><div v-if="!filtered.length" class="empty-tools"><Search/><p>没有匹配的工具</p><button v-if="query" class="text-button" @click="query=''">清除搜索</button></div></div>
  </aside>

  <section class="tool-editor">
   <header class="editor-head"><div><div class="editor-title"><h2>{{selected?selected.current.name||selected.key:'新增 Python 工具'}}</h2><span v-if="dirty" class="unsaved">未应用</span><span v-else-if="selected" class="saved">v{{selected.activeVersion}}</span></div><p v-if="selected&&selected.key!==selected.current.name">{{selected.key}}</p><p v-else-if="!selected">填写工具定义并创建第一个版本</p></div><div class="editor-actions"><button v-if="selected" class="secondary-button" :disabled="busy" @click="toggle(selected)">{{selected.enabled?'停用':'启用'}}</button><button class="primary-button" :disabled="busy||!dirty" @click="save"><Check/>{{selected?'应用新版本':'创建工具'}}</button></div></header>
   <nav class="editor-tabs" aria-label="工具编辑区域"><button :class="{active:section==='edit'}" @click="section='edit'"><EditPen/>配置与代码</button><button :class="{active:section==='test'}" :disabled="!selected" @click="section='test'"><VideoPlay/>运行测试</button><button :class="{active:section==='versions'}" :disabled="!selected" @click="section='versions'"><Clock/>版本历史<span v-if="selected">{{selected.versions.length}}</span></button></nav>

   <div v-show="section==='edit'" class="editor-pane">
    <section class="form-section"><header><div><h3>基本信息</h3><p>这些内容会提供给模型用于选择工具。</p></div></header><div class="tool-fields"><label><span>工具标识</span><input v-model.trim="draft.key" :disabled="!!selected" placeholder="my_tool"/><small>创建后不可修改，建议使用英文和下划线。</small></label><label><span>显示名称</span><input v-model.trim="draft.name" placeholder="工具名称"/></label><label><span>风险等级</span><select v-model="draft.risk"><option value="read">只读</option><option value="write">写入</option><option value="high">高风险</option></select><small v-if="selected?.builtin">修改内置实现后将自动按高风险执行。</small></label><label><span>执行超时</span><div class="timeout-field"><input v-model.number="draft.timeoutMs" type="number" min="1000" max="300000" step="1000"/><b>{{timeoutLabel}}</b></div></label><label class="wide"><span>工具说明</span><textarea v-model="draft.description" rows="3" maxlength="1500" placeholder="说明用途、适用场景和返回内容"/></label><label class="wide"><span>版本说明</span><input v-model="draft.changeNote" maxlength="300" placeholder="简要记录本次修改，便于以后恢复"/></label></div></section>
    <section class="form-section code-section"><header><div><h3>参数与实现</h3><p><code>execute(args, context)</code> 的返回值将通过 JSON 协议交给 Agent。<template v-if="selected?.current.runtimeRevision"> 共享运行时 <code>{{selected.current.runtimeRevision.slice(0,12)}}</code> 已计入版本。</template></p></div></header><div class="tool-code-grid"><label><span>参数 JSON Schema<button class="text-button" @click="formatJson('schema')"><MagicStick/>格式化</button></span><textarea v-model="schemaText" spellcheck="false" aria-label="参数 JSON Schema"/></label><label><span>Python 实现<small>{{draft.python.split('\n').length}} 行</small></span><textarea v-model="draft.python" spellcheck="false" aria-label="Python 实现"/></label></div></section>
   </div>

   <div v-if="selected" v-show="section==='test'" class="editor-pane"><section class="form-section test-section"><header><div><h3>测试 v{{selected.activeVersion}}</h3><p>选择项目作为工作目录。高风险工具运行前仍会要求确认。</p></div><button class="primary-button" :disabled="busy||!testProject" @click="test"><VideoPlay/>运行测试</button></header><div class="test-controls"><label><span>测试项目</span><select v-model="testProject"><option value="">选择测试项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{project.name}}</option></select></label><label><span>参数 JSON<button class="text-button" @click="formatJson('args')"><MagicStick/>格式化</button></span><textarea v-model="testArgs" rows="10" spellcheck="false"/></label></div><div v-if="!projects.length" class="inline-note">请先在 Agent 工作台创建项目，再运行工具测试。</div><div v-if="testOutput" class="test-result"><header><strong>执行结果</strong><button class="text-button" @click="testOutput=''">清除</button></header><pre>{{testOutput}}</pre></div></section></div>

   <div v-if="selected" v-show="section==='versions'" class="editor-pane"><section class="form-section versions-section"><header><div><h3>版本历史</h3><p>恢复会复制历史内容并生成一个新的递增版本。</p></div></header><div class="version-list"><article v-for="version in [...selected.versions].reverse()" :key="version.version" :class="{current:version.version===selected.activeVersion}"><div class="version-mark"><Document/></div><div><div><strong>v{{version.version}}</strong><b :class="'risk-'+version.risk">{{riskLabel(version.risk)}}</b><span v-if="version.version===selected.activeVersion">当前版本</span></div><p>{{version.changeNote||'未填写版本说明'}}</p><small>{{new Date(version.createdAt).toLocaleString()}} · 超时 {{version.timeoutMs/1000}} 秒<template v-if="version.runtimeRevision"> · 运行时 {{version.runtimeRevision.slice(0,12)}}</template></small></div><button v-if="version.version!==selected.activeVersion" class="secondary-button" :disabled="busy" @click="restore(version.version)">恢复此版本</button></article></div></section></div>
  </section>
 </div>
</main></template>

<style scoped src="./studio-tools.css"></style>
