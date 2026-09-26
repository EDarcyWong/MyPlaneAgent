import type {StudioRuntime,StudioLocalModel,StudioRemoteModelCache,StudioServerModel} from './local-ai-studio.js'
import type {LocalAiRemoteProfile,RemoteApiFormat} from './local-ai.js'
import {modelFileRole} from './model-library.js'

export type ChatModelOption={id:string;name:string;source:'local'|'remote';modelId:string;endpoint?:string;apiFormat?:RemoteApiFormat;profileId?:string}
export function chatModelOptions(models:StudioLocalModel[],caches:StudioRemoteModelCache[],profiles:LocalAiRemoteProfile[],current:{apiFormat:RemoteApiFormat;endpoint:string;model:string;source:string},reported:StudioServerModel[]=[]):ChatModelOption[]{
 const rows:ChatModelOption[]=models.filter(item=>item.exists&&item.format==='GGUF'&&modelFileRole(item.file)==='model').map(item=>({id:`local:${item.id}`,name:`本地 · ${item.file.split(/[\\/]/).pop()}`,source:'local',modelId:item.id}))
 const remote=new Map<string,ChatModelOption>()
 function add(apiFormat:RemoteApiFormat,endpoint:string,item:StudioServerModel,profile?:LocalAiRemoteProfile){
  const modelId=item.instanceId||item.id,id=JSON.stringify(['remote',apiFormat,endpoint,modelId])
  const existing=remote.get(id)
  remote.set(id,{id,name:existing?.name||`远程 · ${item.name||item.id}`,source:'remote',modelId,apiFormat,endpoint,profileId:profile?.id||existing?.profileId})
 }
 if(current.source==='external')for(const item of reported)add(current.apiFormat,current.endpoint,item,profiles.find(p=>p.apiFormat===current.apiFormat&&p.endpoint===current.endpoint))
 for(const cache of caches)for(const item of cache.models)add(cache.apiFormat==='anthropic'?'anthropic':'openai',cache.endpoint,item,profiles.find(p=>p.apiFormat===cache.apiFormat&&p.endpoint===cache.endpoint&&p.model===(item.instanceId||item.id))||profiles.find(p=>p.apiFormat===cache.apiFormat&&p.endpoint===cache.endpoint))
 for(const profile of profiles)if(profile.model)add(profile.apiFormat,profile.endpoint,{id:profile.model,name:profile.model},profile)
 if(current.model)add(current.apiFormat,current.endpoint,{id:current.model,name:current.model},profiles.find(p=>p.apiFormat===current.apiFormat&&p.endpoint===current.endpoint&&p.model===current.model))
 return [...rows,...remote.values()]
}

export async function prepareLocalChatModel(id:string,actions:{snapshot:()=>Promise<StudioRuntime>;confirm:()=>Promise<unknown>;stop:()=>Promise<unknown>;start:()=>Promise<StudioRuntime>;wait:()=>Promise<void>}):Promise<StudioRuntime>{
 let state=await actions.snapshot()
 if(state.state==='running'&&state.modelId===id)return state
 await actions.confirm()
 state=await actions.snapshot()
 if(state.state==='running'&&state.modelId===id)return state
 if((state.modelId!==id||state.state!=='starting')&&(state.pid||['running','starting','stopping'].includes(state.state)))await actions.stop()
 if(state.modelId!==id||state.state!=='starting')state=await actions.start()
 const deadline=Date.now()+310_000
 while(state.state==='starting'&&state.modelId===id&&Date.now()<deadline){await actions.wait();state=await actions.snapshot()}
 if(state.state!=='running'||state.modelId!==id)throw new Error(state.error||'本地模型未能启动，请查看模型服务日志。')
 return state
}

/** Managed instance aliases expire when another model is loaded. */
export function currentModelSelection(selected:string,source:string,runtime?:Pick<StudioRuntime,'state'|'modelName'>):string{
 if(source!=='managed'||runtime?.state!=='running'||!runtime.modelName)return selected
 return !selected||/^myplane-[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{2}$/i.test(selected)?runtime.modelName:selected
}
