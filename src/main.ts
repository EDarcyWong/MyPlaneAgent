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
 void window.myplane.localAiStudio('bootstrap').then(bootstrap=>{
  document.title=params.get('workflowId')?'编辑工作流 · MyPlaneAgent':'新建工作流 · MyPlaneAgent'
  createApp(WorkflowDesigner,{windowMode:true,workflowId:params.get('workflowId')||'',model:bootstrap.settings.model,models:bootstrap.models.map(item=>({id:item.id}))}).mount('#app')
 })
}else createApp(LocalAiStudio,{standalone:true}).mount('#app')
