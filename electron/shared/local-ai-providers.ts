/** Official DeepSeek API; custom OpenAI-compatible endpoints remain supported. */
export const DEEPSEEK_CONTEXT_TOKENS=1_000_000
export const DEEPSEEK_DEFAULT_OUTPUT_TOKENS=65_536
export const DEEPSEEK_MAX_OUTPUT_TOKENS=393_216
export const deepseekPreset = {endpoint:'https://api.deepseek.com',model:'deepseek-flash',contextLength:DEEPSEEK_CONTEXT_TOKENS,maxTokens:DEEPSEEK_DEFAULT_OUTPUT_TOKENS} as const
export const deepseekModels = ['deepseek-flash','deepseek-v4-pro'] as const
export function isDeepSeek(endpoint:string):boolean{
 try{const url=new URL(endpoint);return url.protocol==='https:'&&url.hostname==='api.deepseek.com'}catch{return false}
}
export function deepseekThinking(endpoint:string,enabled=true){
 return isDeepSeek(endpoint)?{thinking:{type:enabled?'enabled':'disabled'}}:{}
}
