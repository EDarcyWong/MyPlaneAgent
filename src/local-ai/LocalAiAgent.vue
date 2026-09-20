<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch,type UnwrapNestedRefs} from 'vue'
import {FolderOpened,FolderAdd,EditPen,VideoPause,Check,Close,Document,Cpu,ArrowRight,ArrowDown,ArrowUp,Search,Tools,Grid,InfoFilled,ChatDotRound,Download,MoreFilled,Delete} from '@element-plus/icons-vue'
import {ElMessageBox,ElDropdown,ElDropdownMenu,ElDropdownItem} from 'element-plus'
import AgentProjectActions from './AgentProjectActions.vue'
import ModelCapabilities from './ModelCapabilities.vue'
import {currentModelSelection} from '../../electron/shared/local-ai-model-selection'
import AgentProjectSettings from './AgentProjectSettings.vue'
import TokenUsageDisplay from './TokenUsageDisplay.vue'
import ContextUsageDisplay from './ContextUsageDisplay.vue'
import AiMarkdown from '../AiMarkdown.vue'
import {messageQueues} from './message-queue'
import WorkspaceChatMessages from './WorkspaceChatMessages.vue'
import AgentCodePreview from './AgentCodePreview.vue'
import AgentFileTooltip from './AgentFileTooltip.vue'
import type {useLocalAiStudio} from './useLocalAiStudio'
import type {AgentTask,AgentTaskSummary,AgentMode,AgentEvent,AgentProject,AgentApprovalMode,AgentFilePreview} from '../../electron/shared/local-ai-agent'
import type {StudioCommands,StudioServerModel,StudioImage} from '../../electron/shared/local-ai-studio'
import {LOCAL_AI_MAX_OUTPUT_TOKENS} from '../../electron/shared/local-ai'
const props=defineProps<{model:string;models:StudioServerModel[];online?:boolean;chat:UnwrapNestedRefs<ReturnType<typeof useLocalAiStudio>>}>()
const ch=props.chat
const engine=ref<'agent'|'chat'>('chat'),sourceSessionId=ref<string>(),historyQuery=ref('')
const selectionPreference='myplane.local-ai.workspace.selection'
const emit=defineEmits<{state:[value:string]}>()
const api=<K extends keyof StudioCommands>(action:K,payload?:StudioCommands[K]['input'])=>window.myplane.localAiStudio(action,payload)
const tasks=ref<AgentTaskSummary[]>([]),task=ref<AgentTask>(),workspace=ref<{path:string;token:string}>(),mode=ref<AgentMode>('general'),model=ref(props.model),prompt=ref(''),maxSteps=ref(20),fastMode=ref(true),tokenBudget=ref(0),approvalMode=ref<AgentApprovalMode>('ask'),auditLog=ref(''),busy=ref(false),error=ref(''),loading=ref(true),historyOpen=ref(false),scroller=ref<HTMLElement>(),follow=ref(true)
const projects=ref<AgentProject[]>([]),projectId=ref('')
const project=computed(()=>projects.value.find(p=>p.id===projectId.value))
const visibleTasks=computed(()=>projectId.value?tasks.value.filter(t=>t.projectId===projectId.value):tasks.value)
const collapsedGroups=ref(new Set<string>())
type HistoryItem={id:string;kind:'agent'|'chat';projectId?:string;title:string;updatedAt:string;status:string}
const entries=computed<HistoryItem[]>(()=>{
 const linked=new Set(tasks.value.map(item=>item.sourceSessionId).filter(Boolean))
 return [...tasks.value.map(item=>({...item,kind:'agent' as const})),...ch.sessions.filter(item=>!linked.has(item.id)&&item.messageCount>0).map(item=>({...item,kind:'chat' as const,status:'chat'}))].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
})
const taskGroups=computed(()=>{
 const groups=projects.value.map(item=>({...item,available:true,tasks:[] as HistoryItem[]})),byId=new Map(groups.map(group=>[group.id,group]))
 for(const item of entries.value){
  if(historyQuery.value&&!item.title.toLowerCase().includes(historyQuery.value.toLowerCase()))continue
  const id=item.projectId||'';let group=byId.get(id)
  if(!group){group={id,name:id?'未找到的项目':'独立会话',workspace:'',createdAt:'',updatedAt:'',available:!id,tasks:[]};byId.set(id,group);groups.push(group)}
  group.tasks.push(item)
 }
 return groups.filter(group=>!historyQuery.value||group.tasks.length).sort((a,b)=>Number(!a.id)-Number(!b.id)||Number(!!b.pinned)-Number(!!a.pinned))
})
const chatVisible=computed(()=>engine.value==='chat'||!!sourceSessionId.value&&!task.value)
const hasConversation=computed(()=>chatVisible.value?ch.messages.length>0:!!task.value)
const currentConversation=computed(()=>chatVisible.value?ch.session:task.value)
const draft=computed({get:()=>engine.value==='chat'?ch.input:prompt.value,set:value=>{if(engine.value==='chat')ch.input=value;else prompt.value=value}})
const selectedMode=computed(()=>engine.value==='chat'?'chat':mode.value)
const selectedModel=computed({get:()=>engine.value==='chat'?ch.model:model.value,set:value=>{model.value=value;ch.model=value}})
function rememberSelection(){try{localStorage.setItem(selectionPreference,JSON.stringify({kind:engine.value,id:engine.value==='chat'?ch.session?.id:task.value?.id,projectId:projectId.value}))}catch{}}
async function openChat(id:string){if(locked.value)return;await ch.openSession(id);if(ch.session?.id!==id)return;engine.value='chat';task.value=undefined;sourceSessionId.value=undefined;projectId.value=ch.session?.projectId||'';historyOpen.value=false;rememberProject();rememberSelection();await scroll()}
async function openEntry(item:HistoryItem){if(item.kind==='chat')await openChat(item.id);else await open(item.id)}
async function freshChat(){
 const previous=ch.session?.id
 await ch.newSession()
 if(!ch.session||ch.session.id===previous)throw new Error('无法创建会话，请查看错误提示后重试')
 if(projectId.value){ch.session=await api('updateSession',{id:ch.session.id,projectId:projectId.value});await ch.refreshSessions()}
}
async function pasteImages(event:ClipboardEvent){if(engine.value==='agent')ch.input=prompt.value;await ch.pasteImages(event);if(engine.value==='agent')prompt.value=ch.input}
async function removeChat(item:HistoryItem){const saved=ch.sessions.find(session=>session.id===item.id);if(saved){await ch.deleteSession(saved);if(engine.value==='chat'){projectId.value=ch.session?.projectId||'';rememberProject();rememberSelection()}}}
async function removeEntry(item:HistoryItem){
 if(item.kind==='chat'){await removeChat(item);return}
 if(locked.value)return
 try{
  await ElMessageBox.confirm(`删除“${item.title}”？任务记录和审计记录将一并删除，项目文件不会被删除。`,'删除会话',{type:'warning',confirmButtonText:'删除',cancelButtonText:'取消'})
  await api('agentDelete',{id:item.id});tasks.value=tasks.value.filter(saved=>saved.id!==item.id)
  if(task.value?.id===item.id){task.value=undefined;prompt.value='';auditLog.value='';rememberSelection()}
 }catch(e){if(e!=='cancel'&&e!=='close')error.value=String(e)}
}
async function renameChat(item:HistoryItem){const saved=ch.sessions.find(session=>session.id===item.id);if(saved)await ch.renameSession(saved)}
function toggleGroup(id:string){if(collapsedGroups.value.has(id))collapsedGroups.value.delete(id);else collapsedGroups.value.add(id)}
const queueDispatching=ref(false),steeringItem=ref('')
const locked=computed(()=>!!steeringItem.value||queueDispatching.value||active.value||ch.sending||ch.sessionBusy||ch.attaching||busy.value||loading.value)
const projectPreference='myplane.local-ai.agent.project'
const clock=ref(Date.now())
let clockTimer:ReturnType<typeof setInterval>|undefined
const performanceWarning=computed(()=>{
 if(ch.settings.source!=='managed')return ''
 const issues:string[]=[]
 if(ch.settings.gpuLayers===0)issues.push('GPU 卸载为 0，模型完全使用 CPU')
 const slots=Math.max(1,ch.runtime?.parallel||1),context=Math.floor((ch.runtime?.contextLength||ch.settings.contextLength)/slots)
 if(context>32768)issues.push(`每槽上下文为 ${context.toLocaleString()} tokens`)
 return issues.length?issues.join('；')+'。这会显著拖慢 Agent 的每轮推理，修改加载参数后需重新加载模型。':''
})
const performanceWarningDismissed=ref(false),artifactLimits=ref<Record<string,number>>({})
const approvalHint=computed(()=>approvalMode.value==='full'?'工具自动执行，项目只读限制仍然有效':approvalMode.value==='auto'?'普通工作区文件修改自动批准；命令和外部工具仍需确认':'修改文件、命令和外部工具会请求确认')
const restoredEvents=computed(()=>new Set((task.value?.events||[]).filter(event=>event.tool==='restore_change'&&typeof event.args?.eventId==='string').map(event=>String(event.args!.eventId))))
const eventPaths=(event:AgentEvent)=>event.preview?.changes?.map(change=>change.path)||[String(event.preview?.path||event.args?.path||'')].filter(Boolean)
// Older saved previews use null for a file that did not exist yet.
const firstChangedLine=(before:string|null|undefined,after:string|undefined)=>{if(before==null)return 1;const previous=before.replace(/\r\n?/g,'\n').split('\n'),next=(after||'').replace(/\r\n?/g,'\n').split('\n'),length=Math.max(previous.length,next.length);for(let index=0;index<length;index++)if(previous[index]!==next[index])return index+1;return 1}
const eventChanges=(event:AgentEvent)=>event.preview?.changes?.map(change=>({path:change.path,line:firstChangedLine(change.before,change.after)}))||(event.preview?.path?[{path:event.preview.path,line:firstChangedLine(event.preview.before,event.preview.after)}]:eventPaths(event).map(path=>({path,line:1})))
const compactElapsed=(milliseconds:number)=>{const seconds=Math.max(0,Math.round(milliseconds/1000));return seconds>=3600?`${Math.floor(seconds/3600)}小时${Math.floor(seconds%3600/60)}分钟`:seconds>=60?`${Math.floor(seconds/60)}分${seconds%60}秒`:`${seconds}秒`}
const resultGroups=computed(()=>{
 const groups:{user:AgentEvent;events:AgentEvent[]}[]=[],artifacts=new Map((task.value?.artifacts||[]).map(item=>[item.path,item]))
 for(const event of task.value?.events||[]){if(event.kind==='user'&&!event.steering)groups.push({user:event,events:[]});else if(groups.length)groups.at(-1)!.events.push(event)}
 return groups.map((group,index)=>{
  const mutations=group.events.filter(event=>event.status==='completed'&&['write_file','replace_text','apply_patch','create_document','create_spreadsheet'].includes(event.tool||'')),changedLines=new Map<string,number>()
  for(const event of mutations)for(const change of eventChanges(event))changedLines.set(change.path,Math.min(changedLines.get(change.path)??change.line,change.line))
  const editsByPath=new Map<string,{event:AgentEvent;path:string;line:number;undoable:boolean}>()
  for(const event of group.events.filter(event=>event.status==='completed'&&['write_file','replace_text','apply_patch'].includes(event.tool||'')&&!restoredEvents.value.has(event.id)).reverse()){
   for(const change of eventChanges(event))if(!editsByPath.has(change.path))editsByPath.set(change.path,{event,...change,undoable:!!(event.preview?.changes?.length||event.preview?.path&&event.preview.after!==undefined)})
  }
  const paths=new Set(mutations.flatMap(event=>eventPaths(event)))
  const validations=group.events.filter(event=>['build_project','run_test','run_test_case','get_diagnostics','run_command'].includes(event.tool||'')).map(event=>{let exitCode=event.audit?.exitCode;try{if(exitCode===undefined&&event.output)exitCode=JSON.parse(event.output).exitCode}catch{}return {id:event.id,label:toolLabel(event.tool),detail:String(event.args?.action||event.args?.script||event.args?.target||event.args?.checker||event.args?.command||''),passed:event.status==='completed'&&exitCode===0&&event.execution?.verification?.status!=='unverified',exitCode,duration:event.audit?.durationMs}})
  const last=group.events.at(-1),fallbackEnd=index===groups.length-1?Date.parse(task.value?.runCompletedAt||task.value?.updatedAt||group.user.createdAt):Date.parse(groups[index+1].user.createdAt),duration=group.user.durationMs??Math.max(0,(last?.audit?.endedAt?Date.parse(last.audit.endedAt):fallbackEnd)-Date.parse(group.user.createdAt))
  return {id:group.user.id,user:group.user,summary:[...group.events].reverse().find(event=>event.kind==='assistant'&&event.text.trim())?.text||'任务已完成。',artifacts:[...paths].map(path=>{const item=artifacts.get(path);return item?{...item,line:changedLines.get(path)||1}:undefined}).filter((item):item is NonNullable<typeof item>=>!!item),validations,edits:[...editsByPath.values()],duration}
 })
})
const settledGroups=computed(()=>task.value?.status==='completed'?resultGroups.value:resultGroups.value.slice(0,-1))
const currentTurnEvents=computed(()=>{const events=task.value?.events||[];let start=-1;for(let index=events.length-1;index>=0;index--){if(events[index].kind==='user'&&!events[index].steering){start=index;break}}return start<0?events:events.slice(start)})
const currentTurnUser=computed(()=>currentTurnEvents.value.find(event=>event.kind==='user'))
const currentTurnProgressEvents=computed(()=>currentTurnEvents.value.filter(event=>event.id!==currentTurnUser.value?.id))
const currentPlanText=computed(()=>task.value?.plan.find(item=>item.status==='running')?.text||task.value?.plan.find(item=>item.status==='pending')?.text||'暂无进行中的步骤')
const completedPlanSteps=computed(()=>task.value?.plan.filter(item=>item.status==='completed').length||0)
const artifactLimit=(id:string)=>artifactLimits.value[id]||3
function showMoreArtifacts(id:string){artifactLimits.value={...artifactLimits.value,[id]:artifactLimit(id)+3}}
const filePreviewOpen=ref(false),filePreviewExpanded=ref(false),filePreviewLoading=ref(false),filePreviewError=ref(''),filePreviewLine=ref(1),filePreview=ref<AgentFilePreview>()
type TooltipAnchor={x:number;y:number}
const fileTooltipOpen=ref(false),fileTooltipLoading=ref(false),fileTooltipError=ref(''),fileTooltipLine=ref(1),fileTooltip=ref<AgentFilePreview>(),fileTooltipAnchor=ref<TooltipAnchor>()
let unsubscribe:(()=>void)|undefined,disposed=false,selection=0,tooltipTimer:ReturnType<typeof setTimeout>|undefined,tooltipHideTimer:ReturnType<typeof setTimeout>|undefined,tooltipRequest=0
const active=computed(()=>task.value?.status==='running'||task.value?.status==='waiting'||task.value?.context?.state==='compacting')
const workspacePath=computed(()=>task.value?.workspace||project.value?.workspace||workspace.value?.path||'')
const workspaceName=computed(()=>project.value?.name||workspacePath.value.split(/[\\/]/).filter(Boolean).pop()||'选择项目目录')
const modelName=computed(()=>props.models.find(item=>item.id===selectedModel.value||item.instanceId===selectedModel.value)?.name||selectedModel.value||'选择模型')
const settingsPanel=ref<HTMLDetailsElement>()
const displayError=computed(()=>error.value.includes('不支持的本地 AI 操作')||error.value.includes('后台尚未更新')?'应用后台需要更新，请完全退出 MyPlaneAgent 后重新打开。':error.value.replace(/^Error:\s*(?:Error invoking remote method '[^']+':\s*)?(?:Error:\s*)?/,''))
function closeSettings(){if(settingsPanel.value){settingsPanel.value.open=false;settingsPanel.value.querySelector('summary')?.focus()}}
function dismissSettings(event:PointerEvent){if(settingsPanel.value&&!settingsPanel.value.contains(event.target as Node))settingsPanel.value.open=false}
const pending=computed(()=>task.value?.events.find(e=>e.status==='waiting'))
const statusLabel=(status:string)=>({running:'正在执行',waiting:'等待确认',completed:'已完成',stopped:'已停止',failed:'执行失败'}[status]||status)
const toolLabel=(name?:string)=>({inspect_build:'检查构建配置',build_project:'构建 / 验证项目',reconcile_execution:'核对中断步骤',read_tool_result:'读取工具原文',restore_change:'恢复文件',git_status:'Git 状态',git_diff:'Git 差异',git_log:'Git 历史',apply_patch:'多文件补丁',run_test:'运行验证',read_history:'查阅任务历史',set_plan:'更新任务计划',list_files:'浏览文件',search_files:'检索项目',read_file:'读取代码 / 文本',read_document:'读取文档',write_file:'写入文件',replace_text:'修改文件',create_document:'生成文档',create_spreadsheet:'生成表格',run_command:'运行命令'}[name||'']||name)
const eventCommand=(event:AgentEvent)=>{const command=event.preview?.command??event.args?.command;return typeof command==='string'?command.replace(/\s+/g,' ').trim():''}
const toolProgressLabel=(event:AgentEvent)=>{const label=toolLabel(event.tool)||event.tool||'工具',command=eventCommand(event);return command?`${label}：${command}`:label}
const compactProcessText=(value:string)=>{const text=value.replace(/[`#*_>\n\r]+/g,' ').replace(/\s+/g,' ').trim();return text.length>24?text.slice(0,24)+'…':text}
const processLabel=(event:AgentEvent)=>event.kind==='tool'?[toolLabel(event.tool),eventCommand(event)||String(event.preview?.path||event.args?.path||'').split(/[\\/]/).filter(Boolean).at(-1)].filter(Boolean).join(' · '):(compactProcessText(event.text)||(event.reasoning?'思考与分析':'处理中'))
const currentProcessText=computed(()=>{
 const currentEvent=[...currentTurnProgressEvents.value].reverse().find(event=>event.status==='running'||event.status==='waiting')
 if(!active.value){
  if(currentEvent)return processLabel(currentEvent)
  return task.value?.status==='failed'?'执行失败':task.value?.status==='stopped'?'已停止':'暂无进行中的任务'
 }
 const progress=task.value?.modelProgress,startedAt=task.value?.runStartedAt||progress?.startedAt
 const elapsed=startedAt?Math.max(0,Math.floor((clock.value-Date.parse(startedAt))/1000)):0
 const seconds=Number.isFinite(elapsed)?elapsed:0
 const duration=seconds>=3600?`${Math.floor(seconds/3600)}小时${Math.floor(seconds%3600/60)}分${seconds%60}秒`:seconds>=60?`${Math.floor(seconds/60)}分${seconds%60}秒`:`${seconds}秒`
 const prefix=`已处理 ${duration} · `
 if(task.value?.context?.state==='compacting')return prefix+'正在整理上下文…'
 const tools=currentTurnProgressEvents.value.filter(event=>event.kind==='tool'&&(event.status==='running'||event.status==='waiting'))
 if(tools.length)return prefix+(tools.some(event=>event.status==='waiting')?'等待确认工具：':'正在执行工具：')+tools.map(toolProgressLabel).filter(Boolean).join('、')
 const names=progress?.toolNames?.filter(Boolean).join('、')
 const stage=progress?.phase||'waiting'
 return prefix+(stage==='tools'&&names?'模型正在调用工具：'+names:({waiting:'等待模型响应…',thinking:'模型正在思考…',responding:'模型正在生成答复…',tools:'模型正在生成工具调用…'})[stage])
})
const composerElement=ref<HTMLElement>(),composerHeight=ref(180)
let composerObserver:ResizeObserver|undefined
onMounted(()=>{
 composerObserver=new ResizeObserver(()=>{if(composerElement.value){composerHeight.value=Math.ceil(composerElement.value.getBoundingClientRect().height);void scroll()}})
 if(composerElement.value)composerObserver.observe(composerElement.value)
})
onBeforeUnmount(()=>composerObserver?.disconnect())
const templates=[
 {icon:Search,mode:'coding' as const,title:'分析项目',description:'理解结构，定位关键逻辑',prompt:'请先阅读项目规范和目录结构，分析项目的技术栈、入口和核心模块，给出有文件依据的说明。暂时不要修改文件。'},
 {icon:Tools,mode:'coding' as const,title:'修复并验证',description:'定位问题、修改代码、运行测试',prompt:'请先分析项目并制定计划，定位和修复下面的问题，再运行相关测试验证：\n'},
 {icon:Document,mode:'documents' as const,title:'整理文档',description:'提取要点，生成结构化报告',prompt:'请查看目录中的文档，提取关键事实、待办事项和存在的差异，标明来源文件，生成一份总结报告.docx。不要修改原始文档。'},
 {icon:Grid,mode:'documents' as const,title:'汇总为表格',description:'从资料中整理可核对的数据',prompt:'请读取目录内相关文档，将可核对的关键信息整理到汇总.xlsx。每条记录注明来源文件，缺失信息留空，不要猜测。'}
]
function output(event:AgentEvent){if(!event.output)return '';try{const parsed=JSON.parse(event.output);if(typeof parsed.text==='string')return [parsed.path,parsed.note,parsed.text,parsed.nextOffset?`后续偏移量：${parsed.nextOffset}`:''].filter(Boolean).join('\n\n');if(typeof parsed.output==='string')return `退出码：${parsed.exitCode??'无'}\n${parsed.error||''}\n${parsed.output}`;return JSON.stringify(parsed,null,2)}catch{return event.output}}
async function scroll(){await nextTick();if(engine.value==='chat')ch.scroller=scroller.value;if(follow.value&&scroller.value)scroller.value.scrollTop=scroller.value.scrollHeight}
function trackScroll(){if(engine.value==='chat'){ch.trackScroll();return}const el=scroller.value;if(el)follow.value=el.scrollHeight-el.scrollTop-el.clientHeight<100}

const unresolvedExecutions=computed(()=>task.value?.events.filter(event=>event.execution?.state==='unknown')||[])
async function resolveExecution(eventId:string,outcome:'completed'|'not-applied'){
 if(!task.value||locked.value)return
 busy.value=true
 try{receive(await api('agentResolveExecution',{id:task.value.id,eventId,outcome,note:outcome==='completed'?'用户已核对实际结果，确认完成':'用户已核对实际状态，确认未执行'}))}catch(e){error.value=String(e)}finally{busy.value=false}
}
async function restoreChange(eventId:string){if(!task.value||locked.value)return;busy.value=true;try{receive(await api('agentRestore',{id:task.value.id,eventId}))}catch(e){error.value=String(e)}finally{busy.value=false}}
async function showAudit(){if(!task.value)return;try{auditLog.value=await api('agentAudit',{id:task.value.id})}catch(e){error.value=String(e)}}
async function previewFile(path:string,line=1){if(!task.value)return;filePreviewOpen.value=true;filePreviewExpanded.value=false;filePreviewLine.value=Math.max(1,line);filePreviewLoading.value=true;filePreviewError.value='';filePreview.value=undefined;try{filePreview.value=await api('agentPreview',{id:task.value.id,path})}catch(e){filePreviewError.value=String(e).replace(/^Error:\s*(?:Error invoking remote method '[^']+':\s*)?(?:Error:\s*)?/,'')}finally{filePreviewLoading.value=false}}
function showFileTooltip(path:string,line:number,event:MouseEvent){clearTimeout(tooltipTimer);clearTimeout(tooltipHideTimer);const taskId=task.value?.id,request=++tooltipRequest;fileTooltipAnchor.value={x:event.clientX,y:event.clientY};fileTooltipLine.value=Math.max(1,line);tooltipTimer=setTimeout(async()=>{if(!taskId||request!==tooltipRequest)return;fileTooltipOpen.value=true;fileTooltipLoading.value=true;fileTooltipError.value='';fileTooltip.value=undefined;try{const preview=await api('agentPreview',{id:taskId,path});if(request===tooltipRequest)fileTooltip.value=preview}catch(e){if(request===tooltipRequest)fileTooltipError.value=String(e).replace(/^Error:\s*(?:Error invoking remote method '[^']+':\s*)?(?:Error:\s*)?/,'')}finally{if(request===tooltipRequest)fileTooltipLoading.value=false}},280)}
function keepFileTooltip(){clearTimeout(tooltipHideTimer)}
function scheduleHideFileTooltip(){clearTimeout(tooltipHideTimer);tooltipHideTimer=setTimeout(hideFileTooltip,220)}
function hideFileTooltip(){clearTimeout(tooltipTimer);clearTimeout(tooltipHideTimer);tooltipRequest++;fileTooltipOpen.value=false;fileTooltipLoading.value=false}
function toggleFilePreview(){if(filePreviewOpen.value){filePreviewOpen.value=false;filePreviewExpanded.value=false}else if(filePreview.value)filePreviewOpen.value=true}
async function refresh(){const [savedTasks,savedProjects]=await Promise.all([api('agentTasks'),api('agentProjects')]);tasks.value=savedTasks;projects.value=savedProjects}
function rememberProject(){try{localStorage.setItem(projectPreference,projectId.value)}catch{/* Storage may be unavailable. */}}
function receive(next:AgentTask){if(disposed)return;const index=tasks.value.findIndex(t=>t.id===next.id);const {events,plan,artifacts,...summary}=next;if(index>=0)tasks.value.splice(index,1);tasks.value.unshift(summary);if(task.value?.id===next.id){task.value=next;void scroll()}}
async function chooseWorkspace(){
 if(locked.value)return;busy.value=true
 try{
  const selected=await api('agentChooseWorkspace');if(!selected)return
  const selectedProject=await api('agentCreateProject',{workspaceToken:selected.token,name:(selected.path.split(/[\\/]/).filter(Boolean).pop()||selected.path).slice(0,80)})
  await refresh();selection++;workspace.value=undefined;projectId.value=selectedProject.id;collapsedGroups.value.delete(selectedProject.id);rememberProject();task.value=undefined;error.value='';
  if(engine.value==='chat'){prompt.value=ch.input;sourceSessionId.value=ch.session?.messages.length?ch.session.id:undefined;model.value=ch.model;if(ch.session?.messages.length){ch.session=await api('updateSession',{id:ch.session.id,projectId:selectedProject.id});await ch.refreshSessions()}}
  engine.value='agent';mode.value='general'
  rememberSelection()
 }catch(e){error.value=String(e)}finally{busy.value=false}
}
async function createProject(){
 if(locked.value)return;busy.value=true;error.value=''
 try{
  const selected=await api('agentChooseWorkspace');if(!selected)return
  const existing=projects.value.find(p=>p.workspace===selected.path)
  let created=existing
  if(!created){
   const {value}=await ElMessageBox.prompt(`项目文件夹：${selected.path}。AI 将在此目录内执行任务。`,'新建项目',{inputValue:selected.path.split(/[\\/]/).filter(Boolean).pop()||'新项目',inputPlaceholder:'项目名称',confirmButtonText:'创建项目',cancelButtonText:'取消',closeOnClickModal:false,inputValidator:value=>!!value?.trim()&&value.trim().length<=80||'请输入 1–80 个字符的项目名称'})
   created=await api('agentCreateProject',{workspaceToken:selected.token,name:value.trim()});projects.value.unshift(created)
  }
  selection++;engine.value='agent';sourceSessionId.value=undefined;mode.value='general';projectId.value=created.id;collapsedGroups.value.delete(created.id);workspace.value=undefined;task.value=undefined;prompt.value='';ch.input='';ch.images=[];historyOpen.value=false;rememberProject();rememberSelection();model.value=props.model||model.value
 }catch(e){if(e!=='cancel'&&e!=='close')error.value=String(e)}finally{busy.value=false}
}
async function projectCommand(id:string,command:string){
 if(locked.value)return;const item=projects.value.find(project=>project.id===id);if(!item)return
 try{
  if(command==='new'){await selectProject(id);await nextTick();document.querySelector<HTMLTextAreaElement>('.agent-prompt textarea')?.focus();return}
  if(command==='reveal'){await api('agentRevealProject',{id});return}
  let updated:AgentProject
  if(command==='pin')updated=await api('agentEditProject',{id,pinned:!item.pinned})
  else if(command==='edit'){const {value}=await ElMessageBox.prompt('修改项目显示名称，工作目录保持不变。','编辑项目',{inputValue:item.name,inputPlaceholder:'项目名称',confirmButtonText:'保存',cancelButtonText:'取消',closeOnClickModal:false,inputValidator:value=>!!value?.trim()&&value.trim().length<=80||'请输入 1–80 个字符的项目名称'});updated=await api('agentEditProject',{id,name:value.trim()})}
  else return
  projects.value=projects.value.map(project=>project.id===id?updated:project)
 }catch(e){if(e!=='cancel'&&e!=='close')error.value=String(e)}
}
async function selectProject(id:string){if(locked.value)return;projectId.value=id;engine.value=id?'agent':'chat';mode.value='general';collapsedGroups.value.delete(id);workspace.value=undefined;rememberProject();await newTask()}
async function open(id:string){if(busy.value||active.value&&task.value?.id!==id)return;const revision=++selection;try{const found=await api('agentTask',{id});if(revision!==selection)return;task.value=found;engine.value='agent';sourceSessionId.value=undefined;ch.images=[];projectId.value=found.projectId||'';rememberProject();model.value=found.model;mode.value=found.mode;fastMode.value=found.fastMode!==false;tokenBudget.value=found.tokenBudget||0;approvalMode.value=found.approvalMode||'ask';auditLog.value='';maxSteps.value=found.maxSteps;prompt.value='';error.value='';historyOpen.value=false;follow.value=true;rememberSelection();void scroll()}catch(e){error.value=String(e)}}
async function newTask(){
 if(locked.value)return
 selection++;if(mode.value==='chat')engine.value='chat'
 task.value=undefined;sourceSessionId.value=undefined;prompt.value='';ch.input='';ch.images=[];error.value='';historyOpen.value=false;model.value=props.model||model.value
 busy.value=true
 try{if(engine.value==='chat')await freshChat();rememberSelection()}catch(e){error.value=String(e)}finally{busy.value=false}
}
function useTemplate(item:typeof templates[number]){if(engine.value==='chat'&&ch.session?.messages.length)sourceSessionId.value=ch.session.id;engine.value='agent';mode.value='general';prompt.value=item.prompt;void nextTick(()=>document.querySelector<HTMLTextAreaElement>('.agent-prompt textarea')?.focus())}
type Submission={text:string;images:StudioImage[]}
const queueKey=computed(()=>engine.value==='agent'?(task.value?.id?'agent:'+task.value.id:''):(ch.session?.id?'chat:'+ch.session.id:''))
const queued=computed(()=>queueKey.value?messageQueues[queueKey.value]:undefined)
const inputBlocked=computed(()=>loading.value||ch.sessionBusy||ch.attaching||(!active.value&&!ch.sending&&(busy.value||queueDispatching.value)))
const canSubmit=computed(()=>!inputBlocked.value&&(!!draft.value.trim()||ch.images.length>0)&&!!selectedModel.value.trim()&&(engine.value!=='agent'||!!workspacePath.value))
async function submitDraft(){
 if(!canSubmit.value)return
 const submission={text:draft.value,images:ch.images.map(image=>({...image}))}
 draft.value='';ch.images=[]
 if(queueKey.value&&(active.value||ch.sending||queueDispatching.value||queued.value?.items.length)){
  const queue=messageQueues[queueKey.value]??={items:[],paused:false}
  queue.items.push({id:crypto.randomUUID(),...submission})
  void drainQueue();return
 }
 if(!await start(submission)&&!draft.value&&!ch.images.length){draft.value=submission.text;ch.images=submission.images}
}
async function drainQueue(){
 const key=queueKey.value,queue=messageQueues[key]
 if(disposed||queueDispatching.value||locked.value||!queue?.items.length||queue.paused)return
 if(engine.value==='agent'&&task.value?.status!=='completed'){queue.paused=true;return}
 if(engine.value==='chat'&&ch.error){queue.paused=true;return}
 await dispatchQueued(key)
}
async function dispatchQueued(key:string){
 const queue=messageQueues[key],item=queue?.items[0]
 if(!item||key!==queueKey.value||disposed||locked.value)return
 queueDispatching.value=true
 try{if(await start(item)){queue.items=queue.items.filter(entry=>entry.id!==item.id)}else queue.paused=true}
 finally{queueDispatching.value=false}
 void drainQueue()
}
async function resumeQueue(){if(locked.value||!queued.value)return;queued.value.paused=false;await dispatchQueued(queueKey.value)}
function removeQueued(id:string){if(queued.value&&!queueDispatching.value&&!steeringItem.value)queued.value.items=queued.value.items.filter(item=>item.id!==id)}
async function editQueued(id:string){
 const key=queueKey.value,queue=messageQueues[key],item=queue?.items.find(entry=>entry.id===id)
 if(!item||queueDispatching.value||steeringItem.value)return
 const wasPaused=queue.paused;queue.paused=true
 try{
  const {value}=await ElMessageBox.prompt('修改后仍保留原来的排队位置。','编辑待执行消息',{inputType:'textarea',inputValue:item.text,confirmButtonText:'保存',cancelButtonText:'取消',inputValidator:value=>(!!value?.trim()||item.images.length>0)&&String(value||'').length<=(key.startsWith('agent:')?16000:100000)||'请输入有效内容，且不超过消息长度限制'})
  item.text=value
 }catch(e){if(e!=='cancel'&&e!=='close')error.value=String(e)}
 finally{if(!wasPaused&&key===queueKey.value&&(engine.value==='agent'?!['failed','stopped'].includes(task.value?.status||''):!ch.error))queue.paused=false;void drainQueue()}
}
async function steerQueued(id:string){
 const queue=queued.value,item=queue?.items.find(entry=>entry.id===id),target=task.value
 if(!item||!target||engine.value!=='agent'||!active.value||steeringItem.value||queueDispatching.value)return
 steeringItem.value=id
 try{const updated=await api('agentSteer',{id:target.id,messageId:item.id,prompt:item.text,images:item.images.map(image=>({name:image.name,dataUrl:image.dataUrl}))});queue!.items=queue!.items.filter(entry=>entry.id!==id);receive(updated)}catch(e){error.value=String(e)}finally{steeringItem.value=''}
}
function toggleQueuePause(){if(!queued.value||queueDispatching.value)return;if(queued.value.paused)void resumeQueue();else queued.value.paused=true}
async function start(submission:Submission){
 if(active.value||ch.sending||busy.value||loading.value||ch.sessionBusy)return false
 if(engine.value==='chat'&&workspacePath.value){sourceSessionId.value=ch.session?.messages.length?ch.session.id:undefined;model.value=ch.model;engine.value='agent';mode.value='general'}
 if(engine.value==='chat'){
  busy.value=true;error.value=''
  try{if(ch.session&&ch.session.projectId!==(projectId.value||undefined)){ch.session=await api('updateSession',{id:ch.session.id,projectId:projectId.value});await ch.refreshSessions()}const accepted=await ch.send(false,submission);rememberSelection();return accepted===true}catch(e){error.value=String(e);return false}finally{busy.value=false}
 }
 if((!submission.text.trim()&&!submission.images.length)||!model.value.trim())return false
 if(!workspacePath.value){error.value='请先选择项目或文档目录';return false}
 mode.value='general'
 busy.value=true;error.value='';follow.value=true;if(settingsPanel.value)settingsPanel.value.open=false
 try{const next=await api('agentStart',{approvalMode:approvalMode.value,fastMode:fastMode.value,sessionId:sourceSessionId.value,images:submission.images.map(image=>({name:image.name,dataUrl:image.dataUrl})),projectId:projectId.value||undefined,taskId:task.value?.id,workspaceToken:workspace.value?.token,mode:mode.value,model:model.value,prompt:submission.text,maxSteps:maxSteps.value,tokenBudget:tokenBudget.value});task.value=next;sourceSessionId.value=undefined;rememberSelection();collapsedGroups.value.delete(next.projectId||'');receive(next);return true}catch(e){error.value=String(e);return false}finally{busy.value=false}
}
watch([()=>task.value?.status,()=>ch.sending],([status,sending],[previousStatus,previousSending])=>{
 if(queued.value&&((engine.value==='agent'&&status!==previousStatus&&['failed','stopped'].includes(status||''))||(engine.value==='chat'&&previousSending&&!sending&&!!ch.error)))queued.value.paused=true
},{flush:'post'})
watch([active,()=>ch.sending,busy,loading,steeringItem,()=>task.value?.status,queueKey],()=>{void drainQueue()},{flush:'post'})
async function compact(){if(engine.value==='chat'){await ch.compactSession();return}if(!task.value||locked.value)return;busy.value=true;error.value='';try{receive(await api('agentCompact',{id:task.value.id}))}catch(e){error.value=String(e)}finally{busy.value=false}}
async function stop(){if(queueKey.value)(messageQueues[queueKey.value]??={items:[],paused:false}).paused=true;if(engine.value==='chat'){await ch.stop();return}if(!task.value)return;try{await api('agentStop',{id:task.value.id})}catch(e){error.value=String(e)}}
async function approve(approved:boolean){if(!task.value||!pending.value||busy.value)return;busy.value=true;try{await api('agentApprove',{id:task.value.id,eventId:pending.value.id,approved})}catch(e){error.value=String(e)}finally{busy.value=false}}
async function reveal(path:string){if(!task.value)return;try{await api('agentReveal',{id:task.value.id,path})}catch(e){error.value=String(e)}}
watch(scroller,value=>{ch.scroller=value})
watch(()=>ch.sending,()=>{void scroll()})
watch([()=>props.model,locked],([value])=>{
 if(!locked.value&&value)model.value=value
},{flush:'post'})
watch(performanceWarning,()=>{performanceWarningDismissed.value=false})
watch([()=>task.value?.id,()=>task.value?.status],()=>{artifactLimits.value={}})
watch(()=>task.value?.id,()=>{filePreviewOpen.value=false;filePreviewExpanded.value=false;filePreviewLine.value=1;filePreview.value=undefined;filePreviewError.value='';hideFileTooltip()})
watch([model,()=>ch.settings.source,()=>ch.runtime?.state,()=>ch.runtime?.modelName,locked],()=>{
 if(!locked.value)model.value=currentModelSelection(model.value,ch.settings.source,ch.runtime)
})
watch(()=>task.value?.status,value=>emit('state',value||''),{immediate:true})
onMounted(async()=>{clockTimer=setInterval(()=>{if(active.value)clock.value=Date.now()},1000);document.addEventListener('pointerdown',dismissSettings);try{if(!window.myplane.onLocalAiAgentEvent)throw new Error('Agent 后台尚未更新，请重启 Electron 应用后再使用');unsubscribe=window.myplane.onLocalAiAgentEvent(receive);await refresh();let saved:string|null=null;try{saved=localStorage.getItem(projectPreference)}catch{/* Use task history when storage is unavailable. */}let last:{kind?:string;id?:string;projectId?:string}={};try{last=JSON.parse(localStorage.getItem(selectionPreference)||'{}')}catch{};if(last.kind==='chat'&&last.id&&ch.sessions.some(item=>item.id===last.id)){await ch.openSession(last.id);engine.value='chat';projectId.value=ch.session?.projectId||''}else if(last.kind==='agent'&&last.id&&tasks.value.some(item=>item.id===last.id)){await open(last.id)}else if(last.kind==='agent'&&!last.id){projectId.value=projects.value.some(p=>p.id===last.projectId)?last.projectId!:'';engine.value='agent'}else if(saved&&projects.value.some(p=>p.id===saved)){projectId.value=saved;engine.value='agent';if(visibleTasks.value[0])await open(visibleTasks.value[0].id)}else if(entries.value[0]?.kind==='agent')await open(entries.value[0].id);else if(entries.value[0]?.kind==='chat'){await ch.openSession(entries.value[0].id);engine.value='chat';projectId.value=ch.session?.projectId||''}}catch(e){error.value=String(e)}finally{loading.value=false}})
onBeforeUnmount(()=>{clearInterval(clockTimer);clearTimeout(tooltipTimer);clearTimeout(tooltipHideTimer);disposed=true;unsubscribe?.();document.removeEventListener('pointerdown',dismissSettings)})
</script>

<template>
 <main class="agent-workspace unified-workspace" @keydown.esc="historyOpen=false">
  <button v-if="historyOpen" class="agent-history-backdrop" aria-label="收起会话导航" @click="historyOpen=false"></button>
  <aside class="agent-history" :class="{expanded:historyOpen}">
   <header><strong>工作空间</strong><div class="agent-new-actions"><button class="agent-new" :disabled="locked" title="新建会话" aria-label="新建会话" @click="newTask"><EditPen/></button><button class="agent-new agent-create-project" :disabled="locked" title="新建项目" aria-label="新建项目" @click="createProject"><FolderAdd/></button></div><button class="agent-icon agent-history-close" aria-label="关闭项目与会话" title="关闭项目与会话" @click="historyOpen=false"><Close/></button></header>
   <label class="workspace-search"><Search/><input v-model="historyQuery" placeholder="搜索会话" aria-label="搜索会话"/><button v-if="historyQuery" class="agent-icon" aria-label="清除搜索" @click="historyQuery='' "><Close/></button></label>
   <button class="agent-all-projects" :class="{selected:!projectId}" :disabled="locked" @click="selectProject('')"><ChatDotRound/><span>所有会话</span><small v-if="entries.length">{{entries.length}}</small></button>
   <nav class="agent-project-list" aria-label="项目与会话">
    <section v-for="group in taskGroups" :key="group.id" class="agent-project-group" :data-project-id="group.id">
     <header class="agent-group-header" :class="{selected:group.id&&projectId===group.id}">
      <button class="agent-group-toggle" :aria-label="`${collapsedGroups.has(group.id)?'展开':'收起'}${group.name}`" :aria-expanded="!collapsedGroups.has(group.id)" :aria-controls="'agent-group-'+(group.id||'standalone')" @click="toggleGroup(group.id)"><ArrowRight v-if="collapsedGroups.has(group.id)"/><ArrowDown v-else/></button>
      <button class="agent-project-item" :class="{selected:group.id&&projectId===group.id}" :disabled="locked||!group.available" :title="group.workspace||group.name" @click="selectProject(group.id)"><FolderOpened v-if="group.id"/><ChatDotRound v-else/><span><strong>{{group.name}}</strong></span><small>{{group.tasks.length}}</small></button>
      <AgentProjectActions v-if="group.id&&group.available" :project="group" :disabled="locked" @command="command=>projectCommand(group.id,command)"/>
     </header>
     <div v-show="!collapsedGroups.has(group.id)" :id="'agent-group-'+(group.id||'standalone')" class="agent-task-list">
      <div v-for="item in group.tasks" :key="item.kind+item.id" class="workspace-history-row">
       <button class="agent-task-item" :class="{selected:item.kind==='agent'?task?.id===item.id:engine==='chat'&&ch.session?.id===item.id}" :data-kind="item.kind" :title="item.title" :disabled="locked" @click="openEntry(item)"><strong>{{item.title}}</strong><span><i v-if="item.status==='running'||item.status==='waiting'" class="history-active-dot"></i>{{item.kind==='chat'?'对话':item.status==='completed'?'任务':statusLabel(item.status)}} · {{new Date(item.updatedAt).toLocaleDateString()}}</span></button>
       <details v-if="!locked" class="workspace-row-menu"><summary aria-label="会话操作"><MoreFilled/></summary><div><button v-if="item.kind==='chat'" @click="renameChat(item)">重命名</button><button class="danger-text" @click="removeEntry(item)">删除会话</button></div></details>
      </div>
      <p v-if="!group.tasks.length" class="agent-group-empty">暂无会话</p>
     </div>
    </section>
    <div v-if="!taskGroups.length" class="agent-history-empty"><p>{{historyQuery?'没有匹配的会话':'开始你的第一段对话'}}</p><span>{{historyQuery?'试试其他关键词':'也可以添加项目，处理代码与文档'}}</span></div>
   </nav>
   <footer><Check/><span>记录保存在本机</span></footer>
  </aside>
  <section class="agent-main" :style="{'--composer-height':composerHeight+'px'}" :class="{'is-welcome':!hasConversation,'preview-expanded':filePreviewOpen&&filePreviewExpanded}">
   <header class="agent-toolbar">
    <button class="agent-icon agent-history-toggle" aria-label="项目与会话" title="项目与会话" :aria-expanded="historyOpen" @click="historyOpen=!historyOpen"><Grid/></button>
    <div class="workspace-heading"><strong :title="currentConversation?.title">{{hasConversation?currentConversation?.title:'新会话'}}</strong><button class="agent-workspace-picker" :disabled="locked" :title="workspacePath||'可选：选择项目文件夹'" @click="chooseWorkspace"><FolderOpened/><span>{{workspaceName}}</span><ArrowDown/></button></div>
    <TokenUsageDisplay v-if="hasConversation" class="agent-token-usage" :usage="currentConversation?.usage" :pending="active||ch.sending" label="Tokens" compact/>
    <button v-if="filePreview" class="agent-icon workspace-preview-toggle" :class="{active:filePreviewOpen}" :title="filePreviewOpen?'隐藏文件区域':'显示文件区域'" :aria-label="filePreviewOpen?'隐藏文件区域':'显示文件区域'" @click="toggleFilePreview"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M14.5 4v16"/></svg></button>
    <button v-if="engine==='chat'&&ch.session?.messages.length" class="agent-icon workspace-export" :disabled="locked" title="导出会话" aria-label="导出会话" @click="ch.exportSession"><Download/></button>
    <AgentProjectSettings v-if="project" :project="project" :disabled="locked" @updated="value=>{projects=projects.map(item=>item.id===value.id?value:item)}"/>
    <span class="workspace-local"><i :class="{online}"/>{{online?'已连接':'未连接'}}</span>
   </header>
   <div v-if="error" class="agent-error" role="alert"><InfoFilled/><div><p>{{displayError}}</p><details v-if="displayError!==error"><summary>查看详情</summary><pre>{{error}}</pre></details></div><button class="agent-icon" aria-label="关闭错误提示" @click="error='' "><Close/></button></div>
   <div ref="scroller" class="agent-scroll message-scroll" :class="{'is-empty':!hasConversation}" @scroll="trackScroll">
    <div v-if="loading" class="agent-empty">正在读取会话…</div>
    <section v-else-if="!hasConversation" class="agent-welcome">
     <div class="agent-welcome-label"><span>MyPlaneAgent</span></div>
     <h1>有什么可以帮你？</h1>
     <p>聊聊想法，或在项目中把工作完成。</p>
     <div class="agent-template-grid"><button v-for="item in templates" :key="item.title" @click="useTemplate(item)"><span class="agent-template-icon"><component :is="item.icon"/></span><strong>{{item.title}}</strong><ArrowRight/></button></div>
    </section>
    <WorkspaceChatMessages v-else-if="chatVisible" :messages="ch.messages" :sending="ch.sending" @copy="ch.copy" @regenerate="ch.send(true)"/>
    <div v-else-if="task" class="agent-events">
     <section v-if="unresolvedExecutions.length" class="agent-error agent-recovery" role="status"><strong>这些步骤的执行结果需要核对</strong><p>可继续只读检查。确认实际结果后，再恢复写入或命令执行。</p><div v-for="operation in unresolvedExecutions" :key="operation.id"><p>{{toolLabel(operation.tool)}} · {{operation.execution?.failure?.message}}</p><pre>{{JSON.stringify(operation.args,null,2)}}</pre><button class="agent-secondary" :disabled="locked" @click="resolveExecution(operation.id,'completed')">已核对完成</button><button class="agent-secondary" :disabled="locked" @click="resolveExecution(operation.id,'not-applied')">确认未执行</button></div></section>
     <template v-if="settledGroups.length"><article v-for="group in settledGroups" :key="group.id" class="agent-turn-group"><section class="agent-turn-user"><div v-if="group.user.images?.length" class="message-images"><img v-for="image in group.user.images" :key="image.dataUrl" :src="image.dataUrl" :alt="image.name"/></div><AiMarkdown v-if="group.user.text" :text="group.user.text"/></section><section class="agent-result"><header><strong>用时{{compactElapsed(group.duration)}}</strong></header><section><h3>问题总结</h3><AiMarkdown :text="group.summary"/></section><section v-if="group.artifacts.length"><h3>修改文件</h3><div class="agent-result-files"><button v-for="artifact in group.artifacts.slice(0,artifactLimit(group.id))" :key="artifact.path" @mouseenter="showFileTooltip(artifact.path,artifact.line,$event)" @mouseleave="scheduleHideFileTooltip" @click="previewFile(artifact.path,artifact.line)"><Document/><span><strong>{{artifact.path}}</strong><small>第 {{artifact.line}} 行 · 点击预览</small></span><ArrowRight/></button></div><button v-if="artifactLimit(group.id)<group.artifacts.length" class="agent-artifacts-more" @click="showMoreArtifacts(group.id)">再显示 3 个文件</button></section><section><h3>验证结果</h3><div v-if="group.validations.length" class="agent-validation-list"><div v-for="result in group.validations" :key="result.id" :class="{failed:!result.passed}"><Check v-if="result.passed"/><Close v-else/><span><strong>{{result.label}}</strong><small>{{result.detail||'已执行'}}<template v-if="result.exitCode!==undefined"> · 退出码 {{result.exitCode}}</template><template v-if="result.duration!==undefined"> · {{(result.duration/1000).toFixed(1)}} 秒</template></small></span></div></div><p v-else class="agent-result-empty">未运行自动验证。</p></section><section v-if="group.edits.length"><h3>已编辑文件</h3><div class="agent-edit-list"><div v-for="operation in group.edits" :key="operation.event.id+operation.path"><button class="agent-edit-file" @mouseenter="showFileTooltip(operation.path,operation.line,$event)" @mouseleave="scheduleHideFileTooltip" @click="previewFile(operation.path,operation.line)"><span><strong>{{operation.path}}</strong><small>第 {{operation.line}} 行 · {{toolLabel(operation.event.tool)}} · {{new Date(operation.event.createdAt).toLocaleTimeString()}}</small></span></button><button :disabled="busy||!operation.undoable" :title="operation.undoable?'撤销本次修改':'缺少可撤销快照'" @click="restoreChange(operation.event.id)">撤销</button></div></div></section></section></article><footer v-if="task.status==='completed'" class="agent-result-audit"><button class="agent-secondary" @click="showAudit">查看审计记录</button><pre v-if="auditLog" class="agent-tool-output">{{auditLog}}</pre></footer></template>
     <template v-if="task.status!=='completed'">
      <header class="agent-task-heading"><span class="agent-status" :class="task.status" role="status">{{statusLabel(task.status)}}<template v-if="task.mode!=='chat'"> · {{task.steps}} / {{task.maxSteps||'按预算'}} 轮</template></span></header>
      <article v-if="currentTurnUser" class="agent-event user">
       <div v-if="currentTurnUser.images?.length" class="message-images"><img v-for="image in currentTurnUser.images" :key="image.dataUrl" :src="image.dataUrl" :alt="image.name"/></div>
       <AiMarkdown v-if="currentTurnUser.text" :text="currentTurnUser.text"/>
      </article>
      <details v-if="task.plan.length" class="agent-plan">
       <summary aria-label="展开或收起执行计划"><strong>执行计划</strong><span class="agent-plan-current">{{currentPlanText}}</span><small>{{completedPlanSteps}} / {{task.plan.length}}</small></summary>
       <div class="agent-plan-items"><div v-for="(item,index) in task.plan" :key="index" :class="item.status"><Check v-if="item.status==='completed'"/><span v-else class="agent-step-number">{{index+1}}</span><span>{{item.text}}</span><small>{{item.status==='completed'?'完成':item.status==='running'?'进行中':'待处理'}}</small></div></div>
      </details>
      <details v-if="currentTurnProgressEvents.length||task.status==='running'" class="agent-process">
       <summary aria-label="展开或收起执行过程"><ArrowRight class="agent-process-toggle"/><strong>执行过程</strong><span class="agent-process-stream" :title="currentProcessText" aria-live="polite">{{currentProcessText}}</span></summary>
       <div class="agent-process-details">
        <article v-for="event in currentTurnProgressEvents" :key="event.id" class="agent-event" :class="[event.kind,event.status]">
         <template v-if="event.kind!=='tool'"><details><summary><Check v-if="event.steering!=='pending'&&(!event.status||event.status==='completed')" class="agent-step-check"/><span v-else class="agent-tool-dot" :class="event.status"></span><strong>{{processLabel(event)}}</strong></summary><div v-if="event.images?.length" class="message-images"><img v-for="image in event.images" :key="image.dataUrl" :src="image.dataUrl" :alt="image.name"/></div><details v-if="event.reasoning" class="agent-reasoning"><summary><span class="reasoning-spark"></span><strong>{{event.status==='running'?'正在思考':'查看思考内容'}}</strong><small>{{event.reasoning.length.toLocaleString()}} 字符</small></summary><pre>{{event.reasoning}}</pre></details><AiMarkdown v-if="event.text" :text="event.text"/></details></template>
         <template v-else><details><summary><Check v-if="event.status==='completed'" class="agent-step-check"/><span v-else class="agent-tool-dot" :class="event.status"></span><strong>{{event.audit?.source.startsWith('mcp:')?event.text:toolLabel(event.tool)}}</strong><code class="agent-tool-name">{{event.tool}}</code><span v-if="eventCommand(event)" class="agent-event-command" :title="eventCommand(event)">{{eventCommand(event)}}</span><span v-else class="agent-event-path">{{event.preview?.path||event.args?.path||''}}</span><small>{{event.status==='waiting'?'待确认':event.status==='running'?'执行中':event.status==='rejected'?'已拒绝':event.status==='failed'?'未成功':'已执行'}}</small></summary><p v-if="event.audit" class="tool-audit">{{event.audit.source.startsWith('mcp:')?'MCP 外部工具':'内置工具'}} · {{event.audit.authorization==='automatic'?'自动允许':event.audit.authorization==='confirmed'?'已确认':'待确认 / 未授权'}}<template v-if="event.audit.durationMs!==undefined"> · {{(event.audit.durationMs/1000).toFixed(1)}} 秒</template><template v-if="event.audit.errorCode"> · {{event.audit.errorCode}}</template></p><pre v-if="event.args&&!event.preview" class="agent-tool-args">{{JSON.stringify(event.args,null,2)}}</pre><div v-if="event.preview" class="agent-preview"><p>{{event.preview.note}}</p><template v-if="event.preview.changes"><details v-for="change in event.preview.changes" :key="change.path" open><summary>{{change.path}}</summary><div class="agent-diff"><section><h4>修改前</h4><pre>{{change.before??'新文件'}}</pre></section><section><h4>修改后</h4><pre>{{change.after}}</pre></section></div></details></template><template v-else-if="event.preview.command"><span class="agent-preview-label">{{event.preview.cwd}}</span><pre>{{event.preview.command}}</pre></template><div v-else class="agent-diff" :class="{creation:event.preview.before===undefined}"><section v-if="event.preview.before!==undefined"><h4>修改前</h4><pre>{{event.preview.before}}</pre></section><section><h4>{{event.audit?.source.startsWith('mcp:')?'调用参数':event.preview.before===undefined?'待写入内容':'修改后'}}</h4><pre>{{event.preview.after}}</pre></section></div></div><button v-if="event.status==='completed'&&['write_file','replace_text','apply_patch'].includes(event.tool||'')" class="agent-secondary" :disabled="locked" @click="restoreChange(event.id)">恢复本次修改</button><p v-if="event.execution?.verification" class="tool-audit">核验：{{event.execution.verification.summary}}</p><p v-if="event.execution?.failure" class="tool-audit">建议：{{event.execution.failure.nextAction}}</p><pre v-if="event.output" class="agent-tool-output">{{output(event)}}</pre></details></template>
        </article>
        <div v-if="task.status==='running'" class="agent-working" role="status"><span></span>{{currentProcessText}}</div>
       </div>
      </details>
      <p v-if="task.error" class="agent-task-error" role="status">{{task.error}}</p>
     </template>
    </div>
   </div>
   <div ref="composerElement" class="agent-composer-wrap">
   <div v-if="pending" class="agent-approval" role="region" aria-label="Agent 操作确认"><div><strong>{{pending.audit?.source.startsWith('mcp:')?'确认调用外部工具':pending.preview?.command?'确认执行命令':'确认文件修改'}}</strong><span :title="pending.preview?.command||pending.preview?.path">{{pending.audit?.source.startsWith('mcp:')?pending.text:pending.preview?.command||pending.preview?.path}}</span><small>{{pending.audit?.source.startsWith('mcp:')?'参数将发送给该服务，请查看上方服务名称和完整参数。':pending.preview?.command?'命令可访问目录外文件及网络，请查看上方完整命令。':'请查看上方待写入内容，批准后写入工作目录。'}}</small></div><button class="agent-secondary" :disabled="busy" @click="approve(false)"><Close/>拒绝</button><button class="agent-primary" :disabled="busy" @click="approve(true)"><Check/>批准执行</button></div>
    <p v-if="task?.events.some(event=>event.steering==='pending')" class="queue-steering-note" role="status">调整要求已加入，等待当前步骤结束后处理…</p>
    <ContextUsageDisplay v-if="hasConversation" :context="currentConversation?.context" :checkpoint="currentConversation?.checkpoint" :has-history="hasConversation" :disabled="locked" :shortcut="`Enter 发送 · Shift + Enter 换行${ch.attaching?' · 正在读取图片…':''}`" @compact="compact"/>
    <div v-if="engine==='agent'&&performanceWarning&&!performanceWarningDismissed" class="agent-performance-warning"><Cpu/><span><strong>当前推理配置较慢</strong>{{performanceWarning}}</span><button type="button" @click="ch.tab='settings'">调整加载参数</button><button type="button" class="agent-performance-dismiss" aria-label="关闭加载参数提示" title="关闭" @click="performanceWarningDismissed=true"><Close/></button></div>
    <section v-if="queued?.items.length" class="agent-message-queue" aria-label="待执行任务">
     <header v-if="queued.paused"><span>排队已暂停</span><button type="button" :disabled="locked" @click="resumeQueue">继续排队</button></header>
     <ol><li v-for="(item,index) in queued.items" :key="item.id">
      <svg class="queue-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 4v12a3 3 0 0 0 3 3h11M15 15l4 4-4 4M10 5h9M10 10h6"/></svg>
      <span class="queue-message" :title="item.text">{{item.text||'图片任务'}}<small v-if="item.images.length"> · {{item.images.length}} 张图片</small></span>
      <button v-if="engine==='agent'&&active" type="button" class="queue-steer" :disabled="!!steeringItem||queueDispatching" title="加入当前任务，调整执行方向" @click="steerQueued(item.id)"><span aria-hidden="true">↪</span>调整方向</button>
      <button type="button" class="queue-remove" :disabled="queueDispatching" title="移除" :aria-label="'移除待执行任务 '+(index+1)" @click="removeQueued(item.id)"><Delete/></button>
      <ElDropdown class="queue-menu" trigger="click" placement="top-end" @command="command=>command==='edit'?editQueued(item.id):command==='steer'?steerQueued(item.id):toggleQueuePause()">
       <button type="button" :aria-label="'待执行任务 '+(index+1)+' 的更多操作'" title="更多操作"><MoreFilled/></button>
       <template #dropdown><ElDropdownMenu>
        <ElDropdownItem v-if="engine==='agent'&&active" command="steer" :icon="ArrowRight" :disabled="!!steeringItem||queueDispatching">调整当前任务方向</ElDropdownItem>
        <ElDropdownItem command="edit" :icon="EditPen" :disabled="queueDispatching">编辑消息</ElDropdownItem>
        <ElDropdownItem command="pause" :icon="VideoPause" :disabled="queueDispatching||queued.paused&&locked">{{queued.paused?'继续排队':'暂停排队'}}</ElDropdownItem>
       </ElDropdownMenu></template>
      </ElDropdown>
     </li></ol>
    </section>
    <form class="agent-prompt composer" @submit.prevent="submitDraft">
     <div v-if="ch.images.length" class="composer-images"><figure v-for="(image,index) in ch.images" :key="index"><img :src="image.dataUrl" :alt="image.name"/><figcaption>{{image.name}}</figcaption><button type="button" :aria-label="'移除图片 '+(index+1)" :disabled="ch.attaching" @click="ch.removeImage(index)">×</button></figure></div>
     <textarea v-model="draft" aria-label="消息" :disabled="loading||ch.sessionBusy" :maxlength="engine==='chat'?100000:16000" :placeholder="active||ch.sending?'输入下一项任务，发送后排队执行…':hasConversation?'补充要求，继续这段对话…':'询问任何问题，或描述你想完成的工作…'" @paste="pasteImages" @keydown="!$event.isComposing&&$event.key==='Enter'&&!$event.shiftKey&&($event.preventDefault(),submitDraft())"></textarea>
     <footer>
      <div class="agent-prompt-options">
        <label v-if="engine==='agent'" class="agent-mode agent-approval-mode" :title="approvalHint"><select v-model="approvalMode" :disabled="locked" aria-label="任务权限"><option value="ask">请求选择</option><option value="auto">帮我批准</option><option value="full">完全访问</option></select></label>
       <details ref="settingsPanel" class="agent-settings" @keydown.esc.stop.prevent="closeSettings">
        <summary :title="modelName" aria-label="模型与执行设置"><span>{{modelName}}</span><ArrowDown/></summary>
        <div class="agent-settings-panel">
         <header><strong>会话设置</strong><button type="button" class="agent-icon" aria-label="收起会话设置" @click="closeSettings"><Close/></button></header>
         <label class="agent-model"><span>模型</span><input v-model="selectedModel" list="agent-model-list" :disabled="locked" placeholder="选择或输入模型 ID" aria-label="会话模型"/><datalist id="agent-model-list"><option v-for="item in models" :key="item.id" :value="item.instanceId||item.id">{{item.name}}</option></datalist></label>
         <ModelCapabilities :model="selectedModel" :disabled="locked" @busy="value=>busy=value"/>
         <label v-if="selectedMode!=='chat'" class="agent-limit"><span>执行上限</span><select v-model.number="maxSteps" :disabled="locked" aria-label="执行上限"><option :value="10">10 轮</option><option :value="20">20 轮</option><option :value="40">40 轮</option><option :value="80">80 轮</option><option :value="120">120 轮</option><option :value="0">按 Token 预算</option></select></label>
         <label v-if="selectedMode!=='chat'" class="agent-limit"><span>推理策略</span><select v-model="fastMode" :disabled="locked" aria-label="推理策略"><option :value="true">快速 · 单轮最多 8192</option><option :value="false">深度 · 使用完整输出预算</option></select></label>
         <label v-if="engine==='agent'"><span>任务累计 Token 预算{{maxSteps===0?'（按预算模式必填）':'（0 为不限）'}}</span><input v-model.number="tokenBudget" type="number" :min="maxSteps===0?1:0" max="10000000" step="1" :disabled="locked"/></label>
         <template v-if="engine==='chat'"><label><span>系统提示词</span><textarea v-model="ch.systemPrompt" :disabled="locked" maxlength="12000" rows="3" aria-label="系统提示词"/></label><label><span>最大输出 Tokens</span><input v-model.number="ch.settings.maxTokens" type="number" min="128" :max="LOCAL_AI_MAX_OUTPUT_TOKENS" step="128" :disabled="locked"/></label><label><span>Temperature</span><input v-model.number="ch.settings.temperature" type="number" min="0" max="2" step="any" :disabled="locked"/></label><label><span>Top P</span><input v-model.number="ch.settings.topP" type="number" min="0.01" max="1" step="any" :disabled="locked"/></label><label><span>重复惩罚</span><input v-model.number="ch.settings.repeatPenalty" type="number" min="0.1" max="2" step="any" :disabled="locked"/></label></template>
         <p>{{selectedMode==='chat'?'仅进行对话，不执行文件或命令操作。':fastMode?'快速策略关闭深度思考，并将 Agent 单轮输出限制为 8192 Tokens。':'深度策略保留模型思考并使用工作区完整输出预算，运行时间和费用可能增加。'}}</p>
        </div>
       </details>
      </div>
      <button v-if="active||ch.sending" type="button" class="agent-primary stop-button" title="停止" aria-label="停止生成" @click="stop"><VideoPause/></button><button class="agent-primary send-button" :title="active||ch.sending?'加入待执行队列':'发送'" :aria-label="active||ch.sending?'加入待执行队列':'发送消息'" :disabled="!canSubmit"><ArrowUp/></button>
     </footer>
    </form>
   </div>
  </section>
  <AgentCodePreview :open="filePreviewOpen" :expanded="filePreviewExpanded" :preview="filePreview" :loading="filePreviewLoading" :error="filePreviewError" :line="filePreviewLine" @close="toggleFilePreview" @toggle-expand="filePreviewExpanded=!filePreviewExpanded"/>
  <AgentFileTooltip :open="fileTooltipOpen" :preview="fileTooltip" :loading="fileTooltipLoading" :error="fileTooltipError" :line="fileTooltipLine" :anchor="fileTooltipAnchor" @enter="keepFileTooltip" @leave="hideFileTooltip"/>
 </main>
</template>
<style scoped src="./studio-agent.css"></style>
<style scoped src="./studio-workspace.css"></style>
