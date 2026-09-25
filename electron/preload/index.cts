import type {BrowserAction,BrowserState} from '../shared/browser.js'
import {contextBridge,ipcRenderer} from 'electron'
import type {StudioCommands,StudioEvent,AgentCoreUiEvent} from '../shared/local-ai-studio.js'
import type {AgentTask} from '../shared/local-ai-agent.js'
import type {ApplicationLogAction,ApplicationLogResult} from '../shared/application-log.js'
contextBridge.exposeInMainWorld('myplane',{
 localAiStudio:<K extends keyof StudioCommands>(action:K,payload?:StudioCommands[K]['input']):Promise<StudioCommands[K]['output']>=>ipcRenderer.invoke('local-ai:studio',action,payload),
 onLocalAiAgentEvent:(callback:(task:AgentTask)=>void)=>{const listener=(_event:unknown,task:AgentTask)=>callback(task);ipcRenderer.on('local-ai:agent-event',listener);return()=>ipcRenderer.removeListener('local-ai:agent-event',listener)},
 onAgentCoreEvent:(callback:(event:AgentCoreUiEvent)=>void)=>{const listener=(_event:unknown,data:AgentCoreUiEvent)=>callback(data);ipcRenderer.on('local-ai:agent-core-event',listener);return()=>ipcRenderer.removeListener('local-ai:agent-core-event',listener)},
 onLocalAiStudioEvent:(callback:(event:StudioEvent)=>void)=>{const listener=(_event:unknown,event:StudioEvent)=>callback(event);ipcRenderer.on('local-ai:studio-event',listener);return()=>ipcRenderer.removeListener('local-ai:studio-event',listener)},
 applicationLogs:(action:ApplicationLogAction,limit?:number):Promise<ApplicationLogResult>=>ipcRenderer.invoke('app:logs',action,limit),
 onApplicationLogToggle:(callback:()=>void)=>{const listener=()=>callback();ipcRenderer.on('app:toggle-log-output',listener);return()=>ipcRenderer.removeListener('app:toggle-log-output',listener)},
 browser:(action:BrowserAction,value?:string|boolean):Promise<BrowserState>=>ipcRenderer.invoke('browser:action',action,value),
 onBrowserState:(callback:(state:BrowserState)=>void)=>{const listener=(_event:unknown,state:BrowserState)=>callback(state);ipcRenderer.on('browser:state',listener);return()=>ipcRenderer.removeListener('browser:state',listener)},
 openAiLink:(url:string):Promise<void>=>ipcRenderer.invoke('ai:open-link',url),
 openWorkflowEditor:(workflowId?:string):Promise<void>=>ipcRenderer.invoke('workflow:open-editor',workflowId),
 openHelpDocument:(documentId:'workflow'='workflow'):Promise<void>=>ipcRenderer.invoke('help:open-document',documentId),
 closeWorkflowEditor:():Promise<void>=>ipcRenderer.invoke('workflow:editor-close'),
 workflowEditorSaved:(workflowId:string):Promise<void>=>ipcRenderer.invoke('workflow:editor-saved',workflowId),
 onWorkflowSaved:(callback:(workflowId?:string)=>void)=>{const listener=(_event:unknown,workflowId?:string)=>callback(workflowId);ipcRenderer.on('workflow:saved',listener);return()=>ipcRenderer.removeListener('workflow:saved',listener)},
})
