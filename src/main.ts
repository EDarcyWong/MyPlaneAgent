import {createApp} from 'vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './style.css'
import LocalAiStudio from './LocalAiStudio.vue'
import WorkflowDesigner from './local-ai/WorkflowDesigner.vue'
import {installTooltips} from './tooltips'
const disposeTooltips=installTooltips()
if(import.meta.hot)import.meta.hot.dispose(disposeTooltips)
const params=new URLSearchParams(location.search)
if(params.get('surface')==='workflow-editor'){
 void Promise.all([window.myplane.localAiStudio('bootstrap'),window.myplane.localAiStudio('connect',{reason:'startup'})]).then(([bootstrap,connection])=>{
  document.title=params.get('workflowId')?'编辑工作流 · MyPlaneAgent':'新建工作流 · MyPlaneAgent'
  const models=bootstrap.settings.source==='managed'?[{id:bootstrap.runtime.modelName||bootstrap.settings.model,name:bootstrap.runtime.modelName||'当前本地模型'}]:connection.models.map(item=>({id:item.id,name:item.name}))
  createApp(WorkflowDesigner,{windowMode:true,workflowId:params.get('workflowId')||'',model:bootstrap.settings.source==='managed'?bootstrap.runtime.modelName:bootstrap.settings.model,models}).mount('#app')
 })
}else createApp(LocalAiStudio,{standalone:true}).mount('#app')
