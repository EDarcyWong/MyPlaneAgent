import {createApp} from 'vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './style.css'
import LocalAiStudio from './LocalAiStudio.vue'
import WorkflowDesigner from './local-ai/WorkflowDesigner.vue'
import {installTooltips} from './tooltips'
import type {WorkflowModelRef} from '../electron/shared/local-ai-workflow'
type WorkflowModelOption={id:string;name:string;instanceId?:string;modelRef?:WorkflowModelRef}
const disposeTooltips=installTooltips()
if(import.meta.hot)import.meta.hot.dispose(disposeTooltips)
const params=new URLSearchParams(location.search)
if(params.get('surface')==='help'){
 document.title='工作流使用指南 · MyPlaneAgent'
 void import('./help/HelpWindow.vue').then(({default:HelpWindow})=>createApp(HelpWindow,{documentId:params.get('document')||'workflow'}).mount('#app'))
}else if(params.get('surface')==='workflow-editor'){
 void Promise.all([window.myplane.localAiStudio('bootstrap'),window.myplane.localAiStudio('connect',{reason:'startup'})]).then(([bootstrap,connection])=>{
  document.title=params.get('workflowId')?'编辑工作流 · MyPlaneAgent':'新建工作流 · MyPlaneAgent'
  const remoteCache=bootstrap.remoteModelCache.find(item=>item.apiFormat===bootstrap.settings.apiFormat&&item.endpoint===bootstrap.settings.endpoint),
    localModels:WorkflowModelOption[]=bootstrap.models.filter(item=>item.exists&&item.format==='GGUF'&&!/(?:^|\/)mmproj[-.]/i.test(item.file)).map(item=>({id:item.id,name:`本地 · ${item.file}`,instanceId:bootstrap.runtime.modelId===item.id&&bootstrap.runtime.modelName?bootstrap.runtime.modelName:undefined,modelRef:{source:'local' as const,id:item.id,name:item.file}})),
    remoteModels:WorkflowModelOption[]=(connection.ok&&connection.models.length?connection.models:remoteCache?.models||[]).map(item=>({id:item.instanceId||item.id,name:`远程 · ${item.name||item.id}`,instanceId:item.instanceId,modelRef:{source:'remote' as const,id:item.instanceId||item.id,name:item.name||item.id,apiFormat:bootstrap.settings.apiFormat,endpoint:bootstrap.settings.endpoint,contextLength:bootstrap.settings.contextLength}})),
    models=bootstrap.settings.source==='managed'?[...localModels,...remoteModels]:[...remoteModels,...localModels],
    fallback=bootstrap.settings.source==='managed'?bootstrap.runtime.modelName||bootstrap.settings.model:bootstrap.settings.model;
  if(fallback&&!models.some(item=>item.id===fallback||item.instanceId===fallback))models.unshift({id:fallback,name:fallback,instanceId:undefined,modelRef:bootstrap.settings.source==='external'?{source:'remote' as const,id:fallback,name:fallback,apiFormat:bootstrap.settings.apiFormat,endpoint:bootstrap.settings.endpoint,contextLength:bootstrap.settings.contextLength}:{source:'current' as const,id:fallback,name:fallback}})
  createApp(WorkflowDesigner,{windowMode:true,workflowId:params.get('workflowId')||'',model:bootstrap.settings.source==='managed'?bootstrap.runtime.modelName:bootstrap.settings.model,models}).mount('#app')
 })
}else createApp(LocalAiStudio,{standalone:true}).mount('#app')
