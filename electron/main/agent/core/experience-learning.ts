import {convertibleKind,type ExperienceEntry} from '../../../shared/experience.js'
import type {ExperienceStore} from './experience-store.js'
import {ExperienceFlow,flowInputs} from './experience-flow.js'
import type {StudioToolActivity} from '../../../shared/local-ai-studio.js'

/** Validate only evidence already produced by the authorized run; never replay tools or replace user edits. */
export function learnExperience(store:ExperienceStore,entry:ExperienceEntry|undefined,query:string,workspace:string,activities:StudioToolActivity[],complete:boolean){
 if(!store.state().enabled||!entry||!entry.revision||entry.revision!==1&&!entry.learning||entry.enabled||entry.verification)return
 activities=activities.slice(-32)
 if(!complete){store.noteLearning(entry.id,entry.revision,'blocked','本次未完成或工具受阻，没有足够证据改进方法。');return}
 if(entry.recipe!.kind==='unsupported'){
  const kind=convertibleKind(entry)
  if(!kind||kind==='weather-web'){
   store.noteLearning(entry.id,entry.revision,'candidate',kind==='weather-web'?'缺少可确认的天气来源，等待成功页面证据或手动补充。':'尚无适配的只读方法模板，保留记录等待扩展。');return
  }
  store.convert(entry.id,entry.revision);entry=store.get(entry.id)
 }
 if(!['file-read','web-research','weather-web'].includes(entry.recipe!.kind))return
 const values=flowInputs(query,entry.recipe!)
 if(values){
  // A run may have made several attempts. Accept a complete chain, not a fabricated combination of different targets.
  for(let start=0;start<activities.length;start++){
   try{
    const flow=new ExperienceFlow(entry,values,workspace)
    let action=flow.next()
    for(const activity of activities.slice(start)){
     if(!action||activity.status!=='complete'||activity.capability!==action.capability)continue
     if(action.args.url&&activity.args?.url!==action.args.url||action.args.path&&activity.args?.path!==action.args.path)continue
     flow.observe(activity)
     if(flow.finished)break
     action=flow.next()
    }
    if(flow.passed){
     store.verify(entry.id,entry.revision!,true,flow.checks,'已用本次实际执行证据验证只读方法；不代表全部事实正确。')
     store.noteLearning(entry.id,entry.revision!,'verified','已从成功执行提炼方法并核对当前证据，等待启用；没有重放工具。');return
    }
   }catch{/* Incomplete or unsupported evidence remains a candidate. */}
  }
 }
 store.noteLearning(entry.id,entry.revision!,'candidate','已提炼候选方法，但证据链不完整；需填写参数试运行，当前流程未被自动启用。')
}
