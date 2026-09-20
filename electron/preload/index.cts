import {contextBridge,ipcRenderer} from 'electron'
import type {StudioCommands,StudioEvent} from '../shared/local-ai-studio.js'
import type {AgentTask} from '../shared/local-ai-agent.js'
contextBridge.exposeInMainWorld('myplane',{
 localAiStudio:<K extends keyof StudioCommands>(action:K,payload?:StudioCommands[K]['input']):Promise<StudioCommands[K]['output']>=>ipcRenderer.invoke('local-ai:studio',action,payload),
 onLocalAiAgentEvent:(callback:(task:AgentTask)=>void)=>{const listener=(_event:unknown,task:AgentTask)=>callback(task);ipcRenderer.on('local-ai:agent-event',listener);return()=>ipcRenderer.removeListener('local-ai:agent-event',listener)},
 onLocalAiStudioEvent:(callback:(event:StudioEvent)=>void)=>{const listener=(_event:unknown,event:StudioEvent)=>callback(event);ipcRenderer.on('local-ai:studio-event',listener);return()=>ipcRenderer.removeListener('local-ai:studio-event',listener)},
 openAiLink:(url:string):Promise<void>=>ipcRenderer.invoke('ai:open-link',url),
})
