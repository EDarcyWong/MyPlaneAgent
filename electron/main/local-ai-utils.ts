import path from 'node:path'
import {createHash} from 'node:crypto'

export function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
export function textValue(value:unknown,max=1000){return typeof value==='string'?value.slice(0,max):''}
export function required(value:unknown,label:string,max=1000){const text=textValue(value,max).trim();if(!text)throw new Error(`${label}不能为空`);return text}
export function numeric(value:unknown,min:number,max:number,fallback:number){return typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback}
export function stableId(value:string){return createHash('sha256').update(value).digest('hex')}
export function repoId(value:unknown){const id=required(value,'模型仓库',300);if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*(\/[a-zA-Z0-9][a-zA-Z0-9_.-]*)?$/.test(id))throw new Error('模型仓库格式应为 author/model');return id}
export function modelFile(value:unknown){const file=required(value,'模型文件',800);if(file.includes('\\')||file.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new Error('不安全的模型文件路径');return file}
export function inside(root:string,file:string){const target=path.resolve(root,file),relative=path.relative(path.resolve(root),target);if(!relative||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw new Error('文件路径超出模型目录');return target}
export function formatModel(file:string){const ext=path.extname(file).slice(1).toUpperCase();return {format:ext||'FILE',quantization:file.match(/(?:^|[._-])((?:IQ|Q)\d(?:_[A-Z0-9]+)*|BF16|F16|F32)(?=[.-]|$)/i)?.[1]?.toUpperCase()||''}}
export function endpoint(value:string){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('服务地址必须是 HTTP(S) 地址，密钥请单独填写');url.search='';url.hash='';return url.href.replace(/\/$/,'')}
export async function jsonResponse(response:Response):Promise<unknown>{if(!response.ok){const body=(await response.text()).slice(0,600);throw new Error(`HTTP ${response.status}: ${body||response.statusText}`)}return response.json() as Promise<unknown>}

// Decode complete SSE frames across arbitrary UTF-8/network chunk boundaries.
export async function* sseData(body:ReadableStream<Uint8Array>,signal?:AbortSignal):AsyncGenerator<string>{
 const reader=body.getReader(),decoder=new TextDecoder();let buffer=''
 try{while(true){signal?.throwIfAborted();const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});let match:RegExpExecArray|null
   while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const lines=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,''));if(lines.length)yield lines.join('\n')}
   if(buffer.length>2_000_000)throw new Error('模型返回的数据帧过大')
   if(chunk.done){if(buffer.trim()){const lines=buffer.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart());if(lines.length)yield lines.join('\n')}break}
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
