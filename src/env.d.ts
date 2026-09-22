/// <reference types="vite/client" />
import type {StudioCommands,StudioEvent} from '../electron/shared/local-ai-studio'
import type {AgentTask} from '../electron/shared/local-ai-agent'
import type {ApplicationLogAction,ApplicationLogResult} from '../electron/shared/application-log'
declare global {
 interface Window {
  myplane:{
   localAiStudio<K extends keyof StudioCommands>(action:K,payload?:StudioCommands[K]['input']):Promise<StudioCommands[K]['output']>
   onLocalAiAgentEvent(callback:(task:AgentTask)=>void):()=>void
   onLocalAiStudioEvent(callback:(event:StudioEvent)=>void):()=>void
   applicationLogs(action:ApplicationLogAction,limit?:number):Promise<ApplicationLogResult>
   onApplicationLogToggle(callback:()=>void):()=>void
   openAiLink(url:string):Promise<void>
   openWorkflowEditor(workflowId?:string):Promise<void>
   openHelpDocument(documentId?:'workflow'):Promise<void>
   closeWorkflowEditor():Promise<void>
   workflowEditorSaved(workflowId:string):Promise<void>
   onWorkflowSaved(callback:(workflowId?:string)=>void):()=>void
  }
 }
}
export {}
