import type {LocalAiSearchResult} from './local-ai.js'

export type StudioDiscoveryModel = LocalAiSearchResult & {
 metricsKnown:boolean
 lastModified:string
 parameterCount?:number
 architecture:string
 capabilities:string[]
 license:string
}
export type StudioCatalog = {
 models:StudioDiscoveryModel[]
 source:'live'|'cache'|'builtin'
 updatedAt:string
 error:string
}

// Public repository links are also the sources for these static introductions.
// Popularity, file sizes and revisions must come from the live Hub, never seeds.
const picks = [
 {id:'Qwen/Qwen3-0.6B-GGUF',description:'Qwen3 轻量语言模型，支持思考与非思考模式，适合先体验本地对话。',parameterCount:600_000_000,architecture:'qwen3',capabilities:['文本对话','推理'],license:'apache-2.0'},
 {id:'Qwen/Qwen3-4B-GGUF',description:'Qwen3 4B 多语言模型，提供多种 GGUF 量化版本，支持对话与推理。',parameterCount:4_000_000_000,architecture:'qwen3',capabilities:['文本对话','推理'],license:'apache-2.0'},
 {id:'Qwen/Qwen3-8B-GGUF',description:'Qwen3 8B 多语言模型，可选择不同量化版本，在体积与质量之间取舍。',parameterCount:8_000_000_000,architecture:'qwen3',capabilities:['文本对话','推理'],license:'apache-2.0'},
 {id:'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',description:'Qwen2.5-Coder 7B 指令模型的官方 GGUF 版本，面向代码生成与编程任务。',parameterCount:7_000_000_000,architecture:'qwen2',capabilities:['文本对话','编程'],license:'apache-2.0'},
 {id:'bartowski/Llama-3.2-3B-Instruct-GGUF',description:'Llama 3.2 3B 指令模型的社区 GGUF 量化，适合轻量级文本对话。',parameterCount:3_000_000_000,architecture:'llama',capabilities:['文本对话'],license:'llama3.2'},
 {id:'bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF',description:'DeepSeek R1 蒸馏模型的社区 GGUF 量化版本，面向推理任务。',parameterCount:7_000_000_000,architecture:'qwen2',capabilities:['文本对话','推理'],license:'mit'}
]

export function builtinCatalog(query=''):StudioCatalog {
 const words=query.trim().toLowerCase().split(/\s+/).filter(Boolean)
 return {source:'builtin',updatedAt:'',error:'',models:picks
  .filter(item=>words.every(word=>`${item.id} ${item.description}`.toLowerCase().includes(word)))
  .map(item=>({...item,author:item.id.split('/')[0],likes:0,downloads:0,tags:['gguf','text-generation'],pipelineTag:'text-generation',metricsKnown:false,lastModified:''}))}
}
