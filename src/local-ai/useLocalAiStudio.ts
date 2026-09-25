import {modelFileRole,modelDownloadParts,modelDownloadState} from '../../electron/shared/model-library'
import type { AgentProject } from '../../electron/shared/local-ai-agent'
import {deepseekPreset} from '../../electron/shared/local-ai-providers'
import {computed,nextTick,onBeforeUnmount,onMounted,reactive,ref,watch} from 'vue'
import {ElMessage} from 'element-plus'
import {AppMessageBox as ElMessageBox} from './message-box'
import type {StudioApprovalMode,StudioToolActivity,StudioBootstrap,StudioCommands,StudioConnection,StudioDownload,StudioImage,StudioLocalModel,StudioMessage,StudioModelFile,StudioSession,StudioSessionSummary,StudioSettings,StudioSettingsInput} from '../../electron/shared/local-ai-studio'
import type {LocalAiRemoteProfile,RemoteApiFormat} from '../../electron/shared/local-ai'
import {clipboardImageFiles,readChatImages} from './chat-images'
import {currentModelSelection} from '../../electron/shared/local-ai-model-selection'
import {builtinCatalog,type StudioCatalog,type StudioDiscoveryModel} from '../../electron/shared/local-ai-catalog'
import type {StudioModelDetails} from '../../electron/shared/local-ai-studio'
import type {WorkflowModelRef} from '../../electron/shared/local-ai-workflow'
import {showServiceStartError,showServiceValidationError} from './service-error-dialog'

type WorkflowModelOption={id:string;name:string;instanceId?:string;modelRef?:WorkflowModelRef}

export function useLocalAiStudio(){
 const api=<K extends keyof StudioCommands>(action:K,payload?:StudioCommands[K]['input'])=>window.myplane.localAiStudio(action,payload)
 const tab=ref<'chat'|'workflow'|'automation'|'discover'|'models'|'server'|'skills'|'mcp'|'settings'>('chat'),ready=ref(false),error=ref(''),busy=ref(''),drawer=ref(false),parameters=ref(window.innerWidth>1180)
 const data=ref<StudioBootstrap>(),settings=reactive<StudioSettings>({apiFormat:'openai',endpoint:'http://127.0.0.1:1234/v1',model:'',maxTokens:2048,hasApiKey:false,hasHfToken:false,downloadDirectory:'',source:'external',runtimePath:'',runtimePort:8089,contextLength:4096,gpuLayers:0,threads:4,temperature:0.7,topP:0.95,repeatPenalty:1.1,systemPrompt:'',theme:'system',appearanceStyle:'minimal'})
 const apiKey=ref(''),hfToken=ref(''),connection=ref<StudioConnection>(),connecting=ref(false),remoteProfiles=ref<LocalAiRemoteProfile[]>([]),sessions=ref<StudioSessionSummary[]>([]),session=ref<StudioSession>(),sessionFilter=ref('')
 const images=ref<StudioImage[]>([]),attaching=ref(false)
 const chatProjects=ref<AgentProject[]>([])
 const chatWorkspacePath=computed(()=>chatWorkspace.value?.path||chatProjects.value.find(item=>item.id===session.value?.projectId)?.workspace||'')
 const webEnabled=ref(true),approvalMode=ref<StudioApprovalMode>('ask'),chatWorkspace=ref<{path:string;token:string}>()
 const chatApproval=ref<{approvalId:string;activity:StudioToolActivity}>(),approvingChat=ref(false)
 watch(approvalMode,value=>{if(value==='full')webEnabled.value=true})
 async function chooseChatWorkspace(){if(sending.value)return;try{const picked=await api('agentCoreChooseWorkspace');if(picked)chatWorkspace.value=picked}catch(cause){report(cause)}}
 async function approveChat(approved:boolean){
  const pending=chatApproval.value;if(!pending||approvingChat.value)return
  approvingChat.value=true
  try{await api('chatApprove',{requestId:requestId.value,approvalId:pending.approvalId,approved});chatApproval.value=undefined}catch(cause){report(cause)}finally{approvingChat.value=false}
 }

 let composerRevision=0
 const input=ref(''),model=ref(''),systemPrompt=ref(''),pending=ref<StudioMessage>(),requestId=ref(''),scroller=ref<HTMLElement>(),followBottom=ref(true)
 const query=ref(''),format=ref<'gguf'|'all'>('gguf'),sort=ref<'downloads'|'likes'|'lastModified'>('downloads'),searching=ref(false),searched=ref(false),results=ref<StudioDiscoveryModel[]>(builtinCatalog().models),selected=ref<StudioDiscoveryModel|undefined>(results.value[0]),files=ref<StudioModelFile[]>([]),filesBusy=ref(false),fileFilter=ref(''),ggufOnly=ref(true)
 const catalogSource=ref<StudioCatalog['source']>('builtin'),catalogUpdatedAt=ref(''),catalogError=ref(''),details=ref<StudioModelDetails>(),detailsError=ref(''),readme=ref(''),readmeBusy=ref(false),readmeError=ref(''),selectedFileName=ref('')
 let discoveryOpened=false
 const modelFilter=ref(''),modelsBusy=ref(false),showMissing=ref(true),enqueueBusy=ref(''),sessionBusy=ref(false)
 let pollTimer:ReturnType<typeof setTimeout>|undefined,unlisten:(()=>void)|undefined,disposed=false,searchRevision=0,fileRevision=0
 const sending=computed(()=>!!requestId.value),downloads=computed(()=>data.value?.downloads||[]),runtime=computed(()=>data.value?.runtime),hardware=computed(()=>data.value?.hardware)
 const activeDownloads=computed(()=>downloads.value.filter(item=>['queued','downloading','verifying'].includes(item.status)))
 const totalSize=computed(()=>(data.value?.models||[]).filter(item=>item.exists).reduce((sum,item)=>sum+item.size,0))
 const localModels=computed(()=>(data.value?.models||[]).filter(item=>(showMissing.value||item.exists)&&`${item.file} ${item.repoId}`.toLowerCase().includes(modelFilter.value.toLowerCase())))
 const isVisionProjector=(item:{file:string})=>modelFileRole(item.file)==='projector'
 const localModelKind=(item:StudioLocalModel)=>isVisionProjector(item)?'视觉组件':modelFileRole(item.file)==='shard'?'模型分片':item.format==='GGUF'?'主模型':item.format
 const localModelState=(item:StudioLocalModel)=>!item.exists?'文件缺失':isVisionProjector(item)?'配套组件':runtime.value?.modelId===item.id&&runtime.value.state==='running'?'已加载':runtime.value?.modelId===item.id&&runtime.value.state==='starting'?'加载中':'在硬盘中'
 const canStartLocalModel=(item:StudioLocalModel)=>!!item.exists&&item.format==='GGUF'&&modelFileRole(item.file)==='model'&&!sending.value&&!['running','starting','stopping'].includes(runtime.value?.state||'')
 const visibleSessions=computed(()=>sessions.value.filter(item=>item.title.toLowerCase().includes(sessionFilter.value.toLowerCase())))
 const visibleFiles=computed(()=>files.value.filter(item=>(!ggufOnly.value||item.format==='GGUF')&&item.file.toLowerCase().includes(fileFilter.value.toLowerCase())))
 const downloadChoices=computed(()=>visibleFiles.value.filter(item=>!/-\d{5}-of-\d{5}\.gguf$/i.test(item.file)||/-00001-of-\d{5}\.gguf$/i.test(item.file)))
 const selectedDownload=computed(()=>downloadChoices.value.find(item=>item.file===selectedFileName.value)||downloadChoices.value.find(item=>item.quantization==='Q4_K_M'&&!/mmproj/i.test(item.file))||downloadChoices.value.find(item=>item.format==='GGUF'&&!/mmproj/i.test(item.file))||downloadChoices.value[0])
 const downloadParts=computed(()=>selectedDownload.value?modelDownloadParts(selectedDownload.value,files.value):[])
 const selectedDownloadState=computed(()=>modelDownloadState(selected.value?.id||'',downloadParts.value,data.value?.models||[],downloads.value))
 const downloadSize=computed(()=>downloadParts.value.every(item=>item.size>0)?downloadParts.value.reduce((sum,item)=>sum+item.size,0):0)
 const modelFormats=computed(()=>[...new Set(files.value.map(item=>item.format).filter(item=>['GGUF','SAFETENSORS','BIN','PT','PTH','ONNX'].includes(item)))])
 const catalogLabel=computed(()=>({live:'Hugging Face 在线',cache:'本地缓存',builtin:'内置精选'}[catalogSource.value]))
 const parameterLabel=(value?:number)=>value?`${(value/1e9).toLocaleString('en-US',{maximumFractionDigits:2})}B`:'未公开'
 const dateLabel=(value?:string)=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleDateString('zh-CN'):'未公开'
 const messages=computed(()=>[...(session.value?.messages||[]),...(pending.value?[pending.value]:[])])
 const serverModels=computed(()=>{
  const reported=connection.value?.models||[]
  const activeId=settings.source==='managed'&&runtime.value?.state==='running'?runtime.value.modelName:settings.source==='external'?settings.model:''
  if(!activeId||reported.some(item=>item.id===activeId||item.instanceId===activeId))return reported
  return [{id:activeId,name:activeId},...reported]
 })
 const cachedRemoteModels=computed(()=>{
  const cache=data.value?.remoteModelCache.find(item=>item.apiFormat===settings.apiFormat&&item.endpoint===settings.endpoint)
  return cache?.models||[]
 })
 const workflowModels=computed(()=>{
  const localRows:WorkflowModelOption[]=(data.value?.models||[])
    .filter(item=>item.exists&&item.format==='GGUF'&&!isVisionProjector(item))
    .map(item=>({id:item.id,name:`本地 · ${item.file}`,instanceId:runtime.value?.modelId===item.id&&runtime.value.modelName?runtime.value.modelName:undefined,modelRef:{source:'local',id:item.id,name:item.file} satisfies WorkflowModelRef}))
  const remoteRows:WorkflowModelOption[]=(data.value?.remoteModelCache||[]).flatMap(cache=>{
   const profile=remoteProfiles.value.find(item=>item.apiFormat===cache.apiFormat&&item.endpoint===cache.endpoint)
   return cache.models.map(item=>{
    const id=item.instanceId||item.id,name=item.name||item.id
    return {id,name:`远程 · ${profile?.name||cache.endpoint} · ${name}`,instanceId:item.instanceId,modelRef:{source:'remote',id,name,apiFormat:cache.apiFormat==='anthropic'?'anthropic':'openai',endpoint:cache.endpoint,...(profile?.id?{profileId:profile.id}:{}),...(profile?.contextLength?{contextLength:profile.contextLength}:{})} satisfies WorkflowModelRef}
   })
  })
  const rows=settings.source==='managed'?[...localRows,...remoteRows]:[...remoteRows,...localRows]
  const fallback=settings.source==='managed'?runtime.value?.modelName:settings.model
  if(fallback&&!rows.some(item=>item.id===fallback||item.instanceId===fallback))rows.unshift({id:fallback,name:fallback,instanceId:undefined,modelRef:settings.source==='external'?{source:'remote',id:fallback,name:fallback,apiFormat:settings.apiFormat,endpoint:settings.endpoint}:{source:'current',id:fallback,name:fallback}})
  return rows
 })
 watch([model,()=>settings.source,()=>runtime.value?.state,()=>runtime.value?.modelName,sending,sessionBusy],()=>{
  if(!sending.value&&!sessionBusy.value)model.value=currentModelSelection(model.value,settings.source,runtime.value)
 })
 const canSend=computed(()=>ready.value&&!sending.value&&!attaching.value&&(!!input.value.trim()||images.value.length>0)&&!!model.value&&!sessionBusy.value)
 const effectiveEndpoint=computed(()=>settings.source==='managed'?runtime.value?.endpoint||`http://127.0.0.1:${settings.runtimePort}/v1`:settings.endpoint)
 const statusText=computed(()=>settings.source==='managed'?({stopped:'未加载模型',starting:'模型加载中',running:'模型已就绪',stopping:'正在卸载',error:'加载失败'}[runtime.value?.state||'stopped']):connection.value?.ok?'服务已连接':'服务未连接')
 const online=computed(()=>settings.source==='managed'?runtime.value?.state==='running':connection.value?.ok)
 const apiExample=computed(()=>`curl ${effectiveEndpoint.value}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer <API_KEY>" \\\n  -d '${JSON.stringify({model:model.value||'your-model',messages:[{role:'user',content:'你好'}],stream:true},null,2)}'`)
 const bytes=(value:number)=>{if(!Number.isFinite(value)||value<=0)return '0 B';const unit=Math.min(4,Math.floor(Math.log(value)/Math.log(1024)));return `${(value/1024**unit).toFixed(unit?1:0)} ${['B','KB','MB','GB','TB'][unit]}`}
 const count=(value:number)=>new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(value)
 const percent=(item:StudioDownload)=>item.total?Math.min(100,Math.round(item.received/item.total*100)):0
 const downloadLabel=(status:StudioDownload['status'])=>({queued:'排队中',downloading:'下载中',paused:'已暂停',verifying:'校验中',completed:'已完成',failed:'下载失败',cancelled:'已取消'}[status])
 function fit(size:number){const memory=hardware.value?.freeMemory||0;return !size?'大小未知':!memory?'可用内存未知':size*1.3<memory?'当前可用内存较充足（估算）':'当前可用内存可能不足（估算）'}
 function report(cause:unknown){error.value=String(cause).replace(/^Error: (?:Error invoking remote method '[^']+': Error: )?/,'')}
 async function run(label:string,work:()=>Promise<void>){if(busy.value)return;busy.value=label;error.value='';try{await work()}catch(cause){report(cause)}finally{busy.value=''}}
 async function scroll(force=false){await nextTick();const el=scroller.value;if(el&&(followBottom.value||force)){if(force)el.scrollTo({top:el.scrollHeight,behavior:'instant'});else el.scrollTop=el.scrollHeight}}
 watch(scroller,element=>{if(element)void scroll(true)},{flush:'post'})
 function trackScroll(){const el=scroller.value;if(el)followBottom.value=el.scrollHeight-el.clientHeight-el.scrollTop<100}
 async function refreshModels(){
  if(!data.value||modelsBusy.value)return
  modelsBusy.value=true
  try{const models=await api('models');if(!disposed&&data.value)data.value.models=models}
  finally{modelsBusy.value=false}
 }
 watch([tab,ready],()=>{if((tab.value==='models'||tab.value==='workflow')&&ready.value)void refreshModels().catch(report)})
 async function refreshSessions(){sessions.value=await api('sessions')}
 function activeServiceModel(){return settings.source==='external'?settings.model:runtime.value?.state==='running'?runtime.value.modelName:''}
 function hydrate(next:StudioSession){composerRevision++;images.value=[];session.value=next;chatWorkspace.value=undefined;webEnabled.value=next.webEnabled!==false;approvalMode.value=next.approvalMode||'ask';chatApproval.value=undefined;model.value=activeServiceModel()||next.model||serverModels.value[0]?.id||'';systemPrompt.value=next.systemPrompt;input.value='';pending.value=undefined;followBottom.value=true;void scroll(true)}
 async function openSession(id:string){if(sending.value||sessionBusy.value)return;sessionBusy.value=true;try{hydrate(await api('session',{id}))}catch(cause){report(cause)}finally{sessionBusy.value=false}}
 async function newSession(projectId?:string){
  if(sending.value||sessionBusy.value)return
  // Reuse the open empty conversation, preserving its draft and workspace.
  // An explicit different project still needs its own conversation.
  if(session.value&&!session.value.messages.length&&(!projectId||session.value.projectId===projectId))return
  sessionBusy.value=true
  try{hydrate(await api('newSession',projectId?{projectId}:undefined));await refreshSessions()}
  catch(cause){report(cause)}finally{sessionBusy.value=false}
 }
 async function refreshChatProjects(){try{chatProjects.value=await api('agentProjects')}catch(cause){report(cause)}}
 async function organizeSession(item:StudioSessionSummary,changes:{pinned?:boolean;projectId?:string}){
  if(sending.value||sessionBusy.value)return
  sessionBusy.value=true
  try{
   const updated=await api('updateSession',{id:item.id,...changes})
   if(changes.pinned!==undefined&&updated.pinned!==changes.pinned)throw new Error('置顶功能需要重启应用主进程后生效')
   if(session.value?.id===item.id){session.value.pinned=updated.pinned;session.value.projectId=updated.projectId;if(changes.projectId!==undefined)chatWorkspace.value=undefined}
   await refreshSessions()
  }catch(cause){report(cause)}finally{sessionBusy.value=false}
 }
 async function createChatProject(){
  if(sending.value||sessionBusy.value)return
  try{
   const directory=await api('agentCoreChooseWorkspace');if(!directory)return
   const result=await ElMessageBox.prompt('为项目取一个名称','新建项目',{inputValue:directory.path.split(/[\\/]/).filter(Boolean).pop()||'新项目',inputValidator:value=>!!value?.trim()||'请输入项目名称'})
   const project=await api('agentCreateProject',{workspaceToken:directory.token,name:result.value.trim()})
   await refreshChatProjects();await newSession(project.id)
  }catch(cause){if(cause!=='cancel'&&cause!=='close')report(cause)}
 }
 watch(tab,value=>{if(value==='chat'&&ready.value)void refreshChatProjects()})
 async function renameSession(item:StudioSessionSummary){if(sending.value)return;try{const result=await ElMessageBox.prompt('为这段对话取一个名字','重命名对话',{inputValue:item.title,inputValidator:value=>!!value?.trim()||'请输入名称'});await api('updateSession',{id:item.id,title:result.value});if(session.value?.id===item.id)session.value.title=result.value;await refreshSessions()}catch(cause){if(cause!=='cancel'&&cause!=='close')report(cause)}}
 async function deleteSession(item:StudioSessionSummary){if(sending.value)return;try{await ElMessageBox.confirm(`删除“${item.title}”？此操作不会删除模型。`,'删除对话',{type:'warning'});await api('deleteSession',{id:item.id});await refreshSessions();if(session.value?.id===item.id){session.value=undefined;if(sessions.value[0])await openSession(sessions.value[0].id);else await newSession()}}catch(cause){if(cause!=='cancel'&&cause!=='close')report(cause)}}
 async function saveSettings(testConnection=false){let savedSuccessfully=false;await run('save',async()=>{const payload:StudioSettingsInput={...settings,...(apiKey.value?{apiKey:apiKey.value}:{}),...(hfToken.value?{hfToken:hfToken.value}:{})};const saved=await api('settings',payload);Object.assign(settings,saved);apiKey.value='';hfToken.value='';if(saved.source==='external')remoteProfiles.value=await api('remoteProfiles');ElMessage.success('设置已保存');connection.value=undefined;model.value=saved.model;if(testConnection)await connect();savedSuccessfully=true});return savedSuccessfully}
 async function useRemoteProfile(id:string){await run('profile-use',async()=>{const result=await api('remoteProfileUse',{id});Object.assign(settings,result.settings);remoteProfiles.value=result.profiles;apiKey.value='';connection.value=undefined;if(settings.source==='external'){model.value=settings.model;await connect()}else if(runtime.value?.state==='running')model.value=runtime.value.modelName;ElMessage.success(settings.source==='external'?'已切换远程服务配置':'已载入配置，当前仍使用本地服务')})}
 async function saveRemoteProfile(input:{id?:string;name:string;apiFormat:RemoteApiFormat;endpoint:string;model?:string;contextLength?:number;apiKey?:string;clearApiKey?:boolean},testConnection=true){
  if(busy.value)return false
  let savedSuccessfully=false;busy.value='profile-save';error.value=''
  try{const result=await api('remoteProfileSave',input);Object.assign(settings,result.settings);remoteProfiles.value=result.profiles;apiKey.value='';connection.value=undefined;if(settings.source==='external'){model.value=settings.model;if(testConnection)await connect()}else if(runtime.value?.state==='running')model.value=runtime.value.modelName;ElMessage.success(settings.source==='external'?'远程服务配置已保存':'配置已保存，当前仍使用本地服务');savedSuccessfully=true}
  catch(cause){await showServiceValidationError(cause)}finally{error.value='';busy.value=''}
  return savedSuccessfully
 }
 async function deleteRemoteProfile(id:string){await run('profile-delete',async()=>{await ElMessageBox.confirm('删除后将移除这条配置历史及其本机保存的密钥引用。当前服务不会停止。','删除远程配置',{type:'warning',confirmButtonText:'删除配置',cancelButtonText:'取消'});remoteProfiles.value=await api('remoteProfileDelete',{id});ElMessage.success('配置历史已删除')})}
 async function clearKey(kind:'api'|'hf'){await run('clear-key',async()=>{Object.assign(settings,await api('settings',kind==='api'?{clearApiKey:true}:{clearHfToken:true}));if(kind==='api')apiKey.value='';else hfToken.value='';ElMessage.success('已移除密钥')})}
 async function connect(silent:unknown=false){
  if(connecting.value)return
  const source=settings.source,configured=settings.model.trim(),selection=model.value
  if(silent!==true)error.value=''
  connecting.value=true
  try{
   const result=await api('connect',silent===true?{reason:'startup'}:{reason:'manual'});if(source!==settings.source)return
   connection.value=result
   if(result.ok&&source==='external'&&data.value){
    const next={apiFormat:settings.apiFormat,endpoint:settings.endpoint,updatedAt:new Date().toISOString(),models:result.models}
    data.value.remoteModelCache=[next,...data.value.remoteModelCache.filter(item=>!(item.apiFormat===next.apiFormat&&item.endpoint===next.endpoint))].slice(0,20)
   }
   if(result.ok&&model.value===selection){
    const first=result.models[0]?.instanceId||result.models[0]?.id||''
    if(source==='external'){
     const selectionAvailable=result.models.some(item=>item.id===selection||item.instanceId===selection)
     model.value=configured||selectionAvailable&&selection||first||selection
    }else if(runtime.value?.state==='running')model.value=runtime.value.modelName
   }else if(!result.ok&&silent!==true)await showServiceValidationError(result.error)
  }catch(cause){if(silent!==true)await showServiceValidationError(cause)}finally{if(silent!==true)error.value='';connecting.value=false}
 }
 async function switchSource(source:'managed'|'external'){
  if(busy.value)return
  busy.value='source';error.value=''
  try{Object.assign(settings,await api('settings',{source}));connection.value=undefined;if(source==='managed'&&runtime.value?.state==='running')model.value=runtime.value.modelName;await connect()}
  catch(cause){if(source==='external')await showServiceValidationError(cause);else report(cause)}finally{if(source==='external')error.value='';busy.value=''}
 }
 function selectRemoteApiFormat(format:RemoteApiFormat){if(settings.apiFormat===format)return;connection.value=undefined;apiKey.value='';Object.assign(settings,{apiFormat:format,endpoint:format==='anthropic'?'https://api.anthropic.com/v1':'https://api.openai.com/v1',model:'',hasApiKey:false,contextLength:format==='anthropic'?131072:128000,maxTokens:format==='anthropic'?8192:4096})}
 async function usePreset(provider:'lmstudio'|'ollama'|'llamacpp'|'deepseek'|'anthropic'){connection.value=undefined;settings.apiFormat=provider==='anthropic'?'anthropic':'openai';apiKey.value='';settings.hasApiKey=false;if(provider==='anthropic'){Object.assign(settings,{endpoint:'https://api.anthropic.com/v1',model:'',contextLength:131072,maxTokens:8192});return}if(provider==='deepseek'){Object.assign(settings,deepseekPreset);return}Object.assign(settings,{model:'',contextLength:4096,maxTokens:2048});settings.endpoint=provider==='lmstudio'?'http://127.0.0.1:1234/v1':provider==='ollama'?'http://127.0.0.1:11434/v1':'http://127.0.0.1:8080/v1'}
 function applyCatalog(found:StudioCatalog){
  results.value=found.models;catalogSource.value=found.source;catalogUpdatedAt.value=found.updatedAt;catalogError.value=found.error
  const next=found.models.find(item=>item.id===selected.value?.id)||found.models[0]
  if(next)void selectRepo(next)
  else{fileRevision++;selected.value=undefined;details.value=undefined;files.value=[];filesBusy.value=false;readme.value='';readmeBusy.value=false;detailsError.value='';readmeError.value=''}
 }
 async function search(preset?:string){
  if(preset!==undefined)query.value=preset
  const revision=++searchRevision;searching.value=true;searched.value=true;catalogError.value=''
  try{const found=await api('catalog',{query:query.value,format:format.value,sort:sort.value});if(!disposed&&revision===searchRevision)applyCatalog(found)}
  catch(cause){if(revision===searchRevision)catalogError.value=`模型目录读取失败，当前列表未更新。${String(cause)}`}
  finally{if(revision===searchRevision)searching.value=false}
 }
 async function loadReadme(){
  const target=selected.value,revision=fileRevision,commit=details.value?.revision;if(!target||!commit)return
  readmeBusy.value=true;readmeError.value=''
  try{const content=await api('readme',{repoId:target.id,revision:commit});if(!disposed&&revision===fileRevision)readme.value=content}
  catch(cause){if(revision===fileRevision)readmeError.value=`模型卡暂时无法读取，不影响已列出的文件下载。${String(cause)}`}
  finally{if(revision===fileRevision)readmeBusy.value=false}
 }
 async function selectRepo(item:StudioDiscoveryModel){
  const revision=++fileRevision;selected.value=item;details.value=undefined;files.value=[];filesBusy.value=true;fileFilter.value='';selectedFileName.value='';detailsError.value='';readme.value='';readmeBusy.value=false;readmeError.value=''
  try{const found=await api('modelDetails',{repoId:item.id});if(!disposed&&revision===fileRevision){details.value=found;files.value=found.files;selected.value={...item,...found.model,parameterCount:found.model.parameterCount||item.parameterCount,architecture:found.model.architecture||item.architecture,capabilities:found.model.capabilities.length?found.model.capabilities:item.capabilities};void loadReadme()}}
  catch(cause){if(revision===fileRevision)detailsError.value=`文件信息加载失败，请检查网络或仓库访问权限后重试。${String(cause)}`}
  finally{if(revision===fileRevision)filesBusy.value=false}
 }
 watch([tab,ready],async()=>{
  if(tab.value!=='discover'||!ready.value||discoveryOpened)return
  discoveryOpened=true;const revision=searchRevision
  try{const cached=await api('catalog',{query:query.value,format:format.value,sort:sort.value,cachedOnly:true});if(disposed||revision!==searchRevision)return;applyCatalog(cached)}catch{/* The bundled public catalog stays visible until the online request finishes. */}
  if(!disposed&&revision===searchRevision)void search()
 })
 watch([format,sort],()=>{if(ready.value&&tab.value==='discover')void search()})
 async function enqueue(file:StudioModelFile){if(!selected.value||enqueueBusy.value)return;enqueueBusy.value=file.file;try{const rows=await api('enqueue',{repoId:selected.value.id,file:file.file});if(data.value)data.value.downloads=rows;drawer.value=true;ElMessage.success('下载任务已加入队列，将同时下载模型分片及唯一配套的视觉组件')}catch(cause){report(cause)}finally{enqueueBusy.value=''}}
 async function downloadAction(item:StudioDownload,action:'pause'|'resume'|'cancel'|'remove'){try{if(action==='cancel')await ElMessageBox.confirm('取消下载并清理未完成的临时文件？','取消下载');const rows=await api('downloadAction',{id:item.id,action});if(data.value)data.value.downloads=rows}catch(cause){if(cause!=='cancel'&&cause!=='close')report(cause)}}
 async function importModels(){await run('import',async()=>{if(data.value)data.value.models=await api('importModels')})}
 async function removeModel(item:StudioLocalModel,deleteFile=false){try{await ElMessageBox.confirm(deleteFile?`永久删除文件 ${item.file}？`:`从模型库移除 ${item.file}？原文件会保留；如果文件位于设置的下载目录中，下次扫描时会重新出现在列表中。`,deleteFile?'删除模型文件':'移除模型记录',{type:'warning'});if(data.value)data.value.models=await api('removeModel',{id:item.id,deleteFile})}catch(cause){if(cause!=='cancel'&&cause!=='close')report(cause)}}
 async function startModel(item:StudioLocalModel){
  if(modelFileRole(item.file)==='shard'){await showServiceStartError('请选择该模型的第一个分片（00001）启动，其余分片会自动读取。');return}
  if(isVisionProjector(item)){await showServiceStartError('视觉组件不能单独运行。请加载同目录里的主模型，它会自动配套使用这个 mmproj 文件。');return}
  if(!settings.runtimePath){tab.value='server';await showServiceStartError('未配置 llama-server。请在“模型服务 > 本地服务 > 运行时”中查找或安装运行时，再启动模型服务。');return}
  if(busy.value)return
  busy.value='load';error.value=''
  try{const state=await api('startRuntime',{id:item.id});settings.source='managed';if(data.value)data.value.runtime=state;tab.value='server';connection.value=undefined}
  catch(cause){await showServiceStartError(cause)}finally{busy.value=''}
 }
 async function stopModel(){await run('unload',async()=>{if(data.value)data.value.runtime=await api('stopRuntime');connection.value=undefined})}
 async function externalModel(id:string,unload=false){await run('external-model',async()=>{connection.value=await api('loadExternal',{id,unload});if(!unload){model.value=id;ElMessage.success('模型已加载')}})}
 async function chooseDirectory(){await run('directory',async()=>{const picked=await api('chooseDirectory');if(picked)settings.downloadDirectory=picked})}
 async function chooseRuntime(){await run('runtime',async()=>{const picked=await api('chooseRuntime');if(picked)settings.runtimePath=picked})}
 async function pasteImages(event:ClipboardEvent){
  const files=clipboardImageFiles(event.clipboardData);if(!files.length)return
  event.preventDefault()
  if(sessionBusy.value||!ready.value)return
  if(attaching.value){ElMessage.info('图片正在读取，请稍后再粘贴');return}
  const textarea=event.target as HTMLTextAreaElement,text=event.clipboardData?.getData('text/plain')||''
  if(text){
   const room=100000-(textarea.value.length-(textarea.selectionEnd-textarea.selectionStart))
   textarea.setRangeText(text.slice(0,Math.max(0,room)),textarea.selectionStart,textarea.selectionEnd,'end');input.value=textarea.value
  }
  const revision=composerRevision;attaching.value=true
  try{const next=await readChatImages(files,images.value);if(!disposed&&revision===composerRevision)images.value=next}
  catch(cause){if(!disposed&&revision===composerRevision)report(cause)}
  finally{attaching.value=false}
 }
 function removeImage(index:number){if(!attaching.value)images.value.splice(index,1)}
 async function send(regenerate=false,submission?:{text:string;images:StudioImage[]}){
  if(sending.value||attaching.value||sessionBusy.value||(!regenerate&&!submission&&!canSend.value))return false
  if((webEnabled.value||chatWorkspace.value||approvalMode.value==='full')&&data.value?.chatToolsSupported!==true){report('联网与工具调用需要重启应用主进程后生效；消息草稿已保留。');return false}
  const text=(submission?.text??input.value).trim(),attachments=regenerate?[]:(submission?.images??images.value).map(image=>({name:image.name,dataUrl:image.dataUrl}))
  if(attachments.length&&data.value?.chatImagesSupported!==true){report('图片发送功能需要重启 MyPlane 后生效；图片草稿已保留，请重启后重新粘贴发送。');return}
  if(!session.value){await newSession();if(!session.value)return}
  const target=session.value,id=crypto.randomUUID();error.value='';requestId.value=id
  try{
   await api('settings',{temperature:settings.temperature,topP:settings.topP,maxTokens:settings.maxTokens,repeatPenalty:settings.repeatPenalty})
   session.value=await api('updateSession',{id:target.id,model:model.value,systemPrompt:systemPrompt.value})
   requestId.value=id
   if(regenerate){if(session.value.messages.at(-1)?.role==='assistant')session.value.messages.pop()}else{session.value.messages.push({id:crypto.randomUUID(),role:'user',content:text,...(attachments.length?{images:attachments}:{}),createdAt:new Date().toISOString()});if(!submission){input.value='';images.value=[]}}
   pending.value={id,role:'assistant',content:'',reasoning:'',model:model.value,createdAt:new Date().toISOString()};followBottom.value=true;void scroll(true)
   await api('chat',{sessionId:target.id,requestId:id,text,images:attachments,model:model.value,regenerate,webEnabled:webEnabled.value,approvalMode:approvalMode.value,workspaceToken:chatWorkspace.value?.token});return true
  }catch(cause){requestId.value='';pending.value=undefined;report(cause);try{session.value=await api('session',{id:target.id})}catch{}if(!regenerate&&!submission&&!input.value&&!images.value.length){input.value=text;images.value=attachments}return false}
 }
 async function compactSession(){
  if(sending.value||sessionBusy.value||!session.value)return
  const target=session.value,id=crypto.randomUUID();requestId.value=id;error.value=''
  try{
   session.value=await api('updateSession',{id:target.id,model:model.value,systemPrompt:systemPrompt.value})
   await api('compactSession',{sessionId:target.id,requestId:id,model:model.value})
  }catch(cause){requestId.value='';report(cause)}
 }
 async function stop(){if(requestId.value)try{await api('stopChat',{requestId:requestId.value})}catch(cause){report(cause)}}
 function composerKey(event:KeyboardEvent){if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send()}}
 async function copy(value:string){try{await navigator.clipboard.writeText(value);ElMessage.success('已复制')}catch(cause){report(cause)}}
 async function exportSession(format:'md'|'pdf'|'json'='md'){if(session.value)await run('export',async()=>{if(await api('exportSession',{id:session.value!.id,format}))ElMessage.success('会话已导出')})}
 async function reveal(item:StudioLocalModel){try{await api('revealModel',{id:item.id})}catch(cause){report(cause)}}
 async function openLink(url:string){try{await window.myplane.openAiLink(url)}catch(cause){report(cause)}}
 async function poll(){
  try{if(data.value){const before=data.value.runtime.state,completed=data.value.downloads.filter(item=>item.status==='completed').length,snapshot=await api('snapshot');Object.assign(data.value,snapshot);if(completed!==snapshot.downloads.filter(item=>item.status==='completed').length)await refreshModels();if(before!=='running'&&snapshot.runtime.state==='running'){model.value=snapshot.runtime.modelName;void connect()}}}catch(cause){if(!disposed)report(cause)}finally{if(!disposed)pollTimer=setTimeout(()=>void poll(),1500)}
 }
 onMounted(async()=>{
  try{
   unlisten=window.myplane.onLocalAiStudioEvent(event=>{if(event.requestId!==requestId.value)return;if(event.type==='progress'){if(pending.value){pending.value.execution??=[];pending.value.execution.push(event.entry)}void scroll()}else if(event.type==='outcome'){if(pending.value)pending.value.outcome=event.outcome}else if(event.type==='approval'){chatApproval.value={approvalId:event.approvalId,activity:event.activity}}else if(event.type==='tool'){
    if(pending.value){pending.value.toolActivity??=[];const index=pending.value.toolActivity.findIndex(item=>item.id===event.activity.id);if(index>=0)pending.value.toolActivity[index]=event.activity;else {pending.value.toolActivity.push(event.activity);pending.value.execution??=[];pending.value.execution.push({id:event.activity.id,type:'tool',activityId:event.activity.id,createdAt:new Date().toISOString()})}}
    if(chatApproval.value?.activity.id===event.activity.id&&event.activity.status!=='waiting')chatApproval.value=undefined
    void scroll()
   }else if(event.type==='context'){if(session.value){session.value.context=event.context;if(event.sessionUsage)session.value.usage=event.sessionUsage}}else if(event.type==='delta'){if(event.sessionUsage&&session.value)session.value.usage=event.sessionUsage;if(pending.value){if(event.usage){pending.value.usage=event.usage;pending.value.tokens=event.usage.outputTokens}pending.value.content+=event.content;pending.value.reasoning=(pending.value.reasoning||'')+event.reasoning};void scroll()}else{chatApproval.value=undefined;session.value=event.session;pending.value=undefined;requestId.value='';if(event.error&&!event.session.messages.at(-1)?.error)error.value=event.error;void refreshSessions().catch(report);void scroll()}})
   data.value=await api('bootstrap');Object.assign(settings,data.value.settings);sessions.value=data.value.sessions;model.value=settings.model;remoteProfiles.value=await api('remoteProfiles')
   if(sessions.value[0])hydrate(await api('session',{id:sessions.value[0].id}));else hydrate(await api('newSession'))
   await refreshChatProjects();await refreshSessions();ready.value=true;void poll()
   if(settings.source==='external'||runtime.value?.state==='running')void connect(true)
  }catch(cause){report(cause)}
 })
 onBeforeUnmount(()=>{disposed=true;clearTimeout(pollTimer);unlisten?.();if(requestId.value)void api('stopChat',{requestId:requestId.value}).catch(()=>{})})
 return {chatProjects,chatWorkspacePath,refreshChatProjects,organizeSession,createChatProject,webEnabled,approvalMode,chatWorkspace,chooseChatWorkspace,chatApproval,approvingChat,approveChat,modelsBusy,sessionBusy,images,attaching,pasteImages,removeImage,tab,ready,error,busy,drawer,parameters,data,settings,apiKey,hfToken,connection,connecting,remoteProfiles,sessions,session,sessionFilter,input,model,systemPrompt,pending,requestId,scroller,query,format,sort,searching,searched,results,selected,files,filesBusy,fileFilter,ggufOnly,modelFilter,showMissing,enqueueBusy,sending,downloads,runtime,hardware,activeDownloads,totalSize,localModels,isVisionProjector,localModelKind,localModelState,canStartLocalModel,visibleSessions,visibleFiles,messages,serverModels,workflowModels,canSend,effectiveEndpoint,statusText,online,apiExample,bytes,count,percent,downloadLabel,fit,trackScroll,refreshModels,refreshSessions,newSession,openSession,renameSession,deleteSession,saveSettings,saveRemoteProfile,useRemoteProfile,deleteRemoteProfile,clearKey,connect,switchSource,selectRemoteApiFormat,usePreset,search,selectRepo,enqueue,downloadAction,importModels,removeModel,startModel,stopModel,externalModel,chooseDirectory,chooseRuntime,send,compactSession,stop,composerKey,copy,exportSession,reveal,openLink,catalogSource,catalogUpdatedAt,catalogError,catalogLabel,details,detailsError,readme,readmeBusy,readmeError,loadReadme,selectedFileName,downloadChoices,selectedDownload,selectedDownloadState,downloadSize,downloadParts,modelFormats,parameterLabel,dateLabel}
}
