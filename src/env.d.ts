/// <reference types="vite/client" />
import type {StudioCommands,StudioEvent} from '../electron/shared/local-ai-studio'
import type {AgentTask} from '../electron/shared/local-ai-agent'
declare global {
 interface Window {
  myplane:{
   localAiStudio<K extends keyof StudioCommands>(action:K,payload?:StudioCommands[K]['input']):Promise<StudioCommands[K]['output']>
   onLocalAiAgentEvent(callback:(task:AgentTask)=>void):()=>void
   onLocalAiStudioEvent(callback:(event:StudioEvent)=>void):()=>void
   openAiLink(url:string):Promise<void>
  }
 }
}
export {}
