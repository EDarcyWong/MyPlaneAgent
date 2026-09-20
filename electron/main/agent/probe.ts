import {randomUUID} from 'node:crypto'
import {requestAgentModel,type AgentConnection,type AgentMessage} from './model.js'
import type {ToolDefinition} from './registry.js'
import {readIntegrationJson,writeIntegrationJson} from '../integration-store.js'
import {sumTokenUsage,type TokenUsage} from '../../shared/local-ai-usage.js'
import type {AgentModelProfile} from '../../shared/local-ai-agent.js'
import {visionChallenge} from './vision-probe.js'
export type ModelProbe=AgentModelProfile
export function modelProfile(file:string,endpoint:string,model:string):ModelProbe|null{return readIntegrationJson<ModelProbe[]>(file,[]).find(item=>item.model===model&&item.endpoint===endpoint)||null}
export async function probeModel(file:string,connection:AgentConnection,model:string,signal:AbortSignal,kind:'tools'|'image'='tools'):Promise<ModelProbe>{
 const previous=modelProfile(file,connection.endpoint,model),started=Date.now(),reports:(TokenUsage|undefined)[]=[]
 const profile:ModelProbe={...previous,model,endpoint:connection.endpoint,testedAt:new Date().toISOString(),contextLength:connection.contextLength,image:previous?.image||'not-tested',lastTest:kind,error:undefined}
 async function request(messages:AgentMessage[],tools:false|ToolDefinition[]){const index=reports.length;reports.push(undefined);return requestAgentModel({...connection,maxTokens:256},model,messages,signal,{tools,timing:{firstResponseMs:60000,idleMs:30000,totalMs:90000},onUsage:usage=>{reports[index]=usage}})}
 try{
  if(kind==='tools'){
   const nonce=randomUUID(),definition:ToolDefinition={type:'function',function:{name:'report_probe',description:'Return the exact nonce requested by the user. This is a harmless capability test.',parameters:{type:'object',properties:{nonce:{type:'string'}},required:['nonce'],additionalProperties:false}}}
   const answer=await request([{role:'user',content:'Call report_probe exactly once with nonce '+nonce+'. Do not return a prose answer.'}],[definition]),calls=answer.tool_calls||[]
   const args=calls.length===1?JSON.parse(calls[0].function.arguments):null;profile.tools=calls.length===1&&calls[0].function.name==='report_probe'&&args?.nonce===nonce&&Object.keys(args).length===1
   if(!profile.tools)profile.error='模型没有按要求返回工具调用，建议仅使用对话模式。'
  }else{
   let exclude=-1;profile.imagePassed=0
   for(let round=0;round<2;round++){
    signal.throwIfAborted();const challenge=visionChallenge(exclude);exclude=challenge.target
    const answer=await request([{role:'user',content:[{type:'text',text:'图片是 4 行 4 列的色块。行从上到下为 A、B、C、D，列从左到右为 1、2、3、4。请找出唯一红色色块的位置，只输出两个字符的坐标，不要解释。'},{type:'image_url',image_url:{url:challenge.dataUrl}}]}],false)
    if(answer.content?.trim().toUpperCase()===challenge.answer)profile.imagePassed++
   }
   profile.image=profile.imagePassed===2?'passed':'failed';if(profile.image!=='passed')profile.error='未能连续识别两张随机图片，请检查视觉模型或投影文件配置。'
  }
 }catch(error){if(signal.aborted)throw signal.reason||new Error('测试已取消');if(kind==='tools')profile.tools=false;else profile.image='failed';profile.error=String(error).slice(0,500)}
 signal.throwIfAborted();if(kind==='tools')profile.toolsTestedAt=profile.testedAt;else profile.imageTestedAt=profile.testedAt
 profile.elapsedMs=Date.now()-started;profile.lastUsage=sumTokenUsage(reports);profile.usage=undefined
 if(reports.length){const usage:TokenUsage={};for(const key of ['inputTokens','outputTokens','totalTokens'] as const)if(reports.every(report=>report?.[key]!==undefined))usage[key]=reports.reduce((sum,report)=>sum+report![key]!,0);if(Object.keys(usage).length)profile.usage=usage}
 const all=readIntegrationJson<ModelProbe[]>(file,[]),latest=all.find(item=>item.model===model&&item.endpoint===connection.endpoint)
 if(latest){if(kind==='tools'){profile.image=latest.image;profile.imagePassed=latest.imagePassed;profile.imageTestedAt=latest.imageTestedAt}else{profile.tools=latest.tools;profile.toolsTestedAt=latest.toolsTestedAt}}
 for(const key of Object.keys(profile) as (keyof ModelProbe)[])if(profile[key]===undefined)delete profile[key]
 writeIntegrationJson(file,[profile,...all.filter(item=>item.model!==model||item.endpoint!==connection.endpoint)].slice(0,100));return profile
}
