export type DeveloperPreferences={host:'127.0.0.1'|'0.0.0.0';parallel:number;embedding:boolean;metrics:boolean;hasApiKey:boolean}
export type DeveloperPreferencesInput=Partial<Omit<DeveloperPreferences,'hasApiKey'>>&{apiKey?:string;clearApiKey?:boolean}
export type RuntimeCandidate={path:string;source:string}
export type RuntimePackage={id:string;version:string;name:string;size:number;flavor:'cpu'|'vulkan'|'metal';sha256:string}
export type RuntimeInstallation={status:'idle'|'downloading'|'extracting'|'ready'|'error'|'cancelled';name:string;received:number;total:number;path:string;error:string;verified:boolean}
export type DeveloperState={preferences:DeveloperPreferences;installation:RuntimeInstallation;runtimeFound:boolean;platform:string;arch:string;lanAddresses:string[];requestLogs:string[];serverRunning:boolean}
export type RuntimeLoadOptions={context_length?:number;eval_batch_size?:number;flash_attention?:boolean;offload_kv_cache_to_gpu?:boolean}
export type DeveloperRoute='lmModels'|'lmChat'|'lmLoad'|'lmUnload'|'lmDownload'|'lmDownloadStatus'|'models'|'chat'|'completions'|'embeddings'|'responses'|'messages'|'countTokens'|'health'|'properties'|'slots'|'metrics'
export type DeveloperProtocol='lmstudio'|'openai'|'anthropic'
export const developerProtocols:Record<DeveloperProtocol,{label:string;routes:DeveloperRoute[]}>={
 lmstudio:{label:'LM Studio API',routes:['lmModels','lmChat','lmLoad','lmUnload','lmDownload','lmDownloadStatus']},
 openai:{label:'OpenAI-compatible',routes:['models','responses','chat','completions','embeddings']},
 anthropic:{label:'Anthropic-compatible',routes:['messages','countTokens']}
}
export const developerRoutes:Record<DeveloperRoute,{method:'GET'|'POST';path:string;title:string;note:string}>={
 lmModels:{method:'GET',path:'/api/v1/models',title:'本地模型列表',note:'列出已下载/导入的 GGUF 模型，key 用于加载，loaded_instances[].id 用于推理和卸载。'},
 lmChat:{method:'POST',path:'/api/v1/chat',title:'有状态对话',note:'支持 input、system_prompt、previous_response_id、store 和命名 SSE 事件。历史仅在本次 API 服务运行期间保留，最多 32 条响应、16 MB；未知统计字段省略。暂不支持 MCP integrations、reasoning 参数或自定义工具。'},
 lmLoad:{method:'POST',path:'/api/v1/models/load',title:'加载模型',note:'支持 context_length、eval_batch_size、flash_attention、offload_kv_cache_to_gpu 和 echo_load_config。一次加载一个模型，切换前请卸载；不支持 num_experts 覆盖。'},
 lmUnload:{method:'POST',path:'/api/v1/models/unload',title:'卸载模型',note:'使用 instance_id 卸载模型，API 服务继续运行。有推理请求时不会强制卸载。'},
 lmDownload:{method:'POST',path:'/api/v1/models/download',title:'下载模型',note:'model 使用 Hugging Face GGUF 仓库 ID 或链接，可指定 quantization；默认优先 Q4_K_M。接入真实下载队列，自动下载全部分片。不解析 LM Studio 专属目录短名。'},
 lmDownloadStatus:{method:'GET',path:'/api/v1/models/download/status/:job_id',title:'下载任务状态',note:'填写下载接口返回的 job_id，查询真实字节数、速度及状态。任务记录保存在本机。'},
 models:{method:'GET',path:'/v1/models',title:'模型列表',note:'列出服务可见的模型及 API 标识。'},
 chat:{method:'POST',path:'/v1/chat/completions',title:'聊天补全',note:'支持流式输出；工具调用、结构化输出还需要模型和模板支持。'},
 completions:{method:'POST',path:'/v1/completions',title:'文本补全',note:'传统 prompt 接口，不自动构建聊天消息。'},
 embeddings:{method:'POST',path:'/v1/embeddings',title:'向量嵌入',note:'托管模式需要加载专用 embedding 模型并开启向量模式，不能同时聊天。'},
 responses:{method:'POST',path:'/v1/responses',title:'Responses',note:'原生转发 Responses 请求及 SSE，需使用支持此接口的新版 llama.cpp；旧运行时会明确返回升级提示。'},
 messages:{method:'POST',path:'/v1/messages',title:'Messages',note:'使用 x-api-key 和 anthropic-version，原生转发 messages、system、tools、tool_choice 及命名 SSE。需新版 llama.cpp，模型和模板仍需支持所请求能力；不等同于完整 Claude 云服务。'},
 countTokens:{method:'POST',path:'/v1/messages/count_tokens',title:'统计输入 tokens',note:'Anthropic 格式的真实 tokenizer 计数，不生成回答。需要运行时支持，不能用字符串长度估算。'},
 health:{method:'GET',path:'/health',title:'健康检查',note:'llama.cpp 原生诊断，加载时通常返回 503。'},
 properties:{method:'GET',path:'/props',title:'运行属性',note:'llama.cpp 原生诊断，包含实际上下文、模板和并发槽信息。'},
 slots:{method:'GET',path:'/slots',title:'并发槽状态',note:'llama.cpp 原生诊断，是否可用取决于运行版本及配置。'},
 metrics:{method:'GET',path:'/metrics',title:'Prometheus 指标',note:'需要在启动前启用指标；返回运行时的真实计数，不做模拟。'}
}
export type DeveloperResponse={status:number;elapsedMs:number;body:string;contentType:string;truncated:boolean}
export type StudioDeveloperCommands={
 startApiServer:{input:undefined;output:import('./local-ai-studio.js').StudioRuntime}
 unloadRuntime:{input:undefined;output:import('./local-ai-studio.js').StudioRuntime}
 developerState:{input:undefined;output:DeveloperState}
 developerSettings:{input:DeveloperPreferencesInput;output:DeveloperPreferences}
 runtimeDetect:{input:undefined;output:RuntimeCandidate[]}
 runtimePackages:{input:undefined;output:RuntimePackage[]}
 runtimeInstall:{input:{id:string};output:RuntimeInstallation}
 runtimeInstallCancel:{input:undefined;output:RuntimeInstallation}
 developerKey:{input:undefined;output:string}
 developerRequest:{input:{route:DeveloperRoute;body?:string;jobId?:string};output:DeveloperResponse}
 developerCancelRequest:{input:undefined;output:void}
 developerClearLogs:{input:undefined;output:void}
 developerExportLogs:{input:undefined;output:boolean}
}
