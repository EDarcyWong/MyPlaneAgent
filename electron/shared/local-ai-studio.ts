import type {ContextCheckpoint,ContextStatus} from './local-ai-context.js'
import type {TokenUsage,TokenUsageTotals} from './local-ai-usage.js'
import type {LocalAiSettings,LocalAiSettingsInput,LocalAiSearchResult,LocalAiModelFile,LocalAiDownloadEntry,LocalAiRemoteProfile,LocalAiRemoteProfileInput} from './local-ai.js'
import type {StudioCatalog,StudioDiscoveryModel} from './local-ai-catalog.js'
import type {McpCommands} from './local-ai-mcp.js'
import type {AgentCommands} from './local-ai-agent.js'
import type {AgentToolCommands} from './local-ai-tools.js'
import type {StudioDeveloperCommands} from './local-ai-developer.js'

export type StudioSettings = LocalAiSettings & {
  source: 'external'|'managed'
  runtimePath: string
  runtimePort: number
  contextLength: number
  gpuLayers: number
  threads: number
  temperature: number
  topP: number
  repeatPenalty: number
  systemPrompt: string
  theme: 'system'|'light'|'dark'
}
export type StudioSettingsInput = LocalAiSettingsInput & Partial<Omit<StudioSettings,'hasApiKey'|'hasHfToken'>>
export type StudioModelFile = LocalAiModelFile & {format:string;quantization:string;revision?:string;sha256?:string}
export type StudioModelDetails = {model:StudioDiscoveryModel;files:StudioModelFile[];revision:string;gated:boolean;contextLength?:number}
export type StudioLocalModel = LocalAiDownloadEntry & {exists:boolean;format:string;quantization:string;imported?:boolean}
export type StudioDownload = {
  id:string;repoId:string;file:string;revision:string;sha256?:string;target:string
  status:'queued'|'downloading'|'paused'|'verifying'|'completed'|'failed'|'cancelled'
  received:number;total:number;speed:number;error:string;createdAt:string;etag?:string
}
export type StudioRuntime = {
  state:'stopped'|'starting'|'running'|'stopping'|'error';modelId:string;modelName:string
  endpoint:string;pid?:number;error:string;logs:string[];startedAt?:number;host?:string;parallel?:number;contextLength?:number;embedding?:boolean;vision?:boolean
}
export type StudioServerModel = {id:string;name:string;loaded?:boolean;instanceId?:string;contextLength?:number}
export type StudioConnection = {ok:boolean;endpoint:string;latencyMs:number;models:StudioServerModel[];error:string;provider:'lmstudio'|'openai'|'deepseek'|'anthropic'}
export type StudioImage = {name:string;dataUrl:string}
export type StudioMessage = {usage?:TokenUsage;id:string;role:'user'|'assistant';content:string;images?:StudioImage[];reasoning?:string;createdAt:string;model?:string;elapsedMs?:number;tokens?:number;status?:'complete'|'stopped'|'error'}
export type StudioSession = {projectId?:string;checkpoint?:ContextCheckpoint;context?:ContextStatus;usage?:TokenUsageTotals;id:string;title:string;model:string;systemPrompt:string;messages:StudioMessage[];createdAt:string;updatedAt:string}
export type StudioSessionSummary = Omit<StudioSession,'messages'> & {messageCount:number}
export type StudioEvent = {type:'context';requestId:string;context:ContextStatus;sessionUsage?:TokenUsageTotals}|{type:'delta';requestId:string;content:string;reasoning:string;usage?:TokenUsage;sessionUsage?:TokenUsageTotals}|{type:'finished';requestId:string;session:StudioSession;error?:string}
export type StudioHardware = {platform:string;arch:string;cpu:string;threads:number;totalMemory:number;freeMemory:number}
export type StudioSnapshot = {downloads:StudioDownload[];runtime:StudioRuntime;hardware:StudioHardware}
export type StudioBootstrap = StudioSnapshot & {settings:StudioSettings;models:StudioLocalModel[];sessions:StudioSessionSummary[];chatImagesSupported?:boolean}

export type StudioCommands = {
  bootstrap:{input:undefined;output:StudioBootstrap}
  settings:{input:StudioSettingsInput;output:StudioSettings}
  remoteProfiles:{input:undefined;output:LocalAiRemoteProfile[]}
  remoteProfileSave:{input:LocalAiRemoteProfileInput;output:{settings:StudioSettings;profiles:LocalAiRemoteProfile[]}}
  remoteProfileUse:{input:{id:string};output:{settings:StudioSettings;profiles:LocalAiRemoteProfile[]}}
  remoteProfileDelete:{input:{id:string};output:LocalAiRemoteProfile[]}
  snapshot:{input:undefined;output:StudioSnapshot}
  connect:{input:undefined;output:StudioConnection}
  search:{input:{query:string;format:'gguf'|'all';sort:'downloads'|'likes'|'lastModified'};output:LocalAiSearchResult[]}
  catalog:{input:{query:string;format:'gguf'|'all';sort:'downloads'|'likes'|'lastModified';cachedOnly?:boolean};output:StudioCatalog}
  modelDetails:{input:{repoId:string};output:StudioModelDetails}
  modelIcon:{input:{author:string};output:string}
  readme:{input:{repoId:string;revision:string};output:string}
  files:{input:{repoId:string};output:StudioModelFile[]}
  enqueue:{input:{repoId:string;file:string};output:StudioDownload[]}
  downloadAction:{input:{id:string;action:'pause'|'resume'|'cancel'|'remove'};output:StudioDownload[]}
  models:{input:undefined;output:StudioLocalModel[]}
  importModels:{input:undefined;output:StudioLocalModel[]}
  removeModel:{input:{id:string;deleteFile:boolean};output:StudioLocalModel[]}
  revealModel:{input:{id:string};output:void}
  chooseDirectory:{input:undefined;output:string|null}
  chooseRuntime:{input:undefined;output:string|null}
  startRuntime:{input:{id:string};output:StudioRuntime}
  stopRuntime:{input:undefined;output:StudioRuntime}
  loadExternal:{input:{id:string;unload?:boolean};output:StudioConnection}
  sessions:{input:undefined;output:StudioSessionSummary[]}
  session:{input:{id:string};output:StudioSession}
  newSession:{input:undefined;output:StudioSession}
  updateSession:{input:{id:string;projectId?:string;title?:string;model?:string;systemPrompt?:string};output:StudioSession}
  deleteSession:{input:{id:string};output:void}
  exportSession:{input:{id:string};output:boolean}
  chat:{input:{sessionId:string;requestId:string;text:string;images?:StudioImage[];model:string;regenerate?:boolean};output:{started:boolean}}
  compactSession:{input:{sessionId:string;requestId:string;model:string};output:{started:boolean}}
  stopChat:{input:{requestId:string};output:void}
}&StudioDeveloperCommands&AgentCommands&AgentToolCommands&McpCommands
