<script setup lang="ts">
import {computed,h,type VNodeChild} from 'vue'
import {ElMessage} from 'element-plus'
import {highlightCode,syntaxLanguage} from './local-ai/syntax-highlight'
type FileReference={path:string;line?:number}
const props=defineProps<{text:string;files?:FileReference[]}>()
const emit=defineEmits<{fileEnter:[path:string,line:number,event:MouseEvent];fileLeave:[];fileClick:[path:string,line:number]}>()
type Block={kind:'paragraph'|'heading'|'quote'|'code'|'rule'|'list'|'table';text:string;level?:number;language?:string;ordered?:boolean;start?:number;items?:string[];headers?:string[];rows?:string[][]}
const fence=/^\s*(`{3,}|~{3,})([^\s`]*)\s*$/
const list=/^\s*(?:(\d+)[.)]|[-+*])\s+(.+)$/
const heading=/^\s{0,3}(#{1,6})\s+(.+)$/
const rule=/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const tableRule=(s:string)=>s.includes('|')&&s.trim().replace(/^\||\|$/g,'').split('|').every(v=>/^\s*:?-{3,}:?\s*$/.test(v))
const cells=(s:string)=>s.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(v=>v.trim().replace(/\\\|/g,'|'))
const blocks=computed(()=>{
 const lines=props.text.replace(/\r\n?/g,'\n').split('\n'),result:Block[]=[]
 let i=0
 while(i<lines.length){
  const line=lines[i];if(!line.trim()){i++;continue}
  const code=line.match(fence)
  if(code){const body:string[]=[];i++;while(i<lines.length&&!new RegExp('^\\s*'+code[1][0]+'{'+code[1].length+',}\\s*$').test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;result.push({kind:'code',text:body.join('\n'),language:code[2]||'text'});continue}
  const title=line.match(heading);if(title){result.push({kind:'heading',text:title[2],level:title[1].length});i++;continue}
  if(rule.test(line)){result.push({kind:'rule',text:''});i++;continue}
  if(i+1<lines.length&&line.includes('|')&&tableRule(lines[i+1])){const headers=cells(line),rows:string[][]=[];i+=2;while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))rows.push(cells(lines[i++]));result.push({kind:'table',text:'',headers,rows});continue}
  const first=line.match(list)
  if(first){const items:string[]=[],ordered=!!first[1];while(i<lines.length){const entry=lines[i].match(list);if(!entry||!!entry[1]!==ordered)break;items.push(entry[2]);i++}result.push({kind:'list',text:'',ordered,start:Number(first[1])||1,items});continue}
  if(/^\s*>/.test(line)){const quote:string[]=[];while(i<lines.length&&/^\s*>/.test(lines[i]))quote.push(lines[i++].replace(/^\s*>\s?/,''));result.push({kind:'quote',text:quote.join('\n')});continue}
  const paragraph=[line];i++
  while(i<lines.length&&lines[i].trim()&&!fence.test(lines[i])&&!heading.test(lines[i])&&!rule.test(lines[i])&&!list.test(lines[i])&&!/^\s*>/.test(lines[i])&&!(i+1<lines.length&&lines[i].includes('|')&&tableRule(lines[i+1])))paragraph.push(lines[i++])
  result.push({kind:'paragraph',text:paragraph.join('\n')})
 }
 return result
})
async function open(url:string){try{await window.myplane.openAiLink(url)}catch(e){ElMessage.error(String(e))}}
const normalizedFiles=computed(()=>{
 const result=new Map<string,FileReference>(),basenames=new Map<string,FileReference[]>()
 for(const file of props.files||[]){
  const normalized=file.path.replace(/\\/g,'/').replace(/^\.\//,'')
  if(!normalized)continue
  result.set(normalized,{...file,path:file.path})
  const basename=normalized.split('/').at(-1)!
  basenames.set(basename,[...(basenames.get(basename)||[]),file])
 }
 for(const [basename,files] of basenames)if(files.length===1&&basename.includes('.'))result.set(basename,files[0])
 return result
})
function resolveFile(value:string){
 const raw=value.trim().replace(/^<|>$/g,'').replace(/^file:\/\//,'').replace(/\\/g,'/'),location=raw.match(/(?::(\d+)(?::\d+)?|#L(\d+))$/i)
 const path=raw.slice(0,location?.index??raw.length).replace(/^\.\//,'')
 const exact=normalizedFiles.value.get(path),matches=exact?[exact]:[...new Map([...normalizedFiles.value.entries()].filter(([candidate])=>candidate.endsWith('/'+path)||path.endsWith('/'+candidate)).map(([,file])=>[file.path,file])).values()]
 if(matches.length!==1)return
 return {path:matches[0].path,line:Number(location?.[1]||location?.[2]||matches[0].line||1)}
}
function fileNode(label:string,file:{path:string;line:number},code=false){
 return h('button',{type:'button',class:'ai-file-reference',title:`预览 ${file.path}（第 ${file.line} 行）`,onMouseenter:(event:MouseEvent)=>emit('fileEnter',file.path,file.line,event),onMouseleave:()=>emit('fileLeave'),onClick:()=>emit('fileClick',file.path,file.line)},code?h('code',label):label)
}
function plain(text:string):VNodeChild[]{
 if(!normalizedFiles.value.size)return [text]
 const aliases=[...normalizedFiles.value.keys()].sort((a,b)=>b.length-a.length),result:VNodeChild[]=[]
 let offset=0
 while(offset<text.length){
  let found:{index:number;alias:string}|undefined
  for(const alias of aliases){const index=text.indexOf(alias,offset);if(index>=0&&(!found||index<found.index||index===found.index&&alias.length>found.alias.length))found={index,alias}}
  if(!found){result.push(text.slice(offset));break}
  const before=found.index?text[found.index-1]:'',after=text[found.index+found.alias.length]||''
  if(/[\w./\\-]/.test(before)||/[\w/\\-]/.test(after)){result.push(text.slice(offset,found.index+found.alias.length));offset=found.index+found.alias.length;continue}
  if(found.index>offset)result.push(text.slice(offset,found.index))
  const suffix=text.slice(found.index+found.alias.length).match(/^(?::(\d+)(?::\d+)?|#L(\d+))/i)?.[0]||'',file=resolveFile(found.alias+suffix)!
  result.push(fileNode(found.alias+suffix,file));offset=found.index+found.alias.length+suffix.length
 }
 return result
}
function inline(text:string,depth=0):VNodeChild[]{
 if(depth>3)return [text]
 const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^\s)]+\))/g
 const result:VNodeChild[]=[];let last=0
 for(const match of text.matchAll(pattern)){
  const index=match.index!,token=match[0];if(index>last)result.push(...plain(text.slice(last,index)))
  if(token.startsWith('`')){const label=token.slice(1,-1),file=resolveFile(label);result.push(file?fileNode(label,file,true):h('code',label))}
  else if(token.startsWith('**')||token.startsWith('__'))result.push(h('strong',inline(token.slice(2,-2),depth+1)))
  else if(token.startsWith('~~'))result.push(h('del',inline(token.slice(2,-2),depth+1)))
  else if(token.startsWith('*'))result.push(h('em',inline(token.slice(1,-1),depth+1)))
  else{const link=token.match(/^\[([^\]]+)\]\((.+)\)$/)!,file=resolveFile(link[2]);if(file)result.push(fileNode(link[1],file));else if(/^https?:\/\//.test(link[2]))result.push(h('a',{href:link[2],title:link[2],onClick:(e:MouseEvent)=>{e.preventDefault();void open(link[2])}},link[1]));else result.push(...plain(token))}
  last=index+token.length
 }
 if(last<text.length)result.push(...plain(text.slice(last)))
 return result
}
const Inline=(value:{text:string})=>h('span',inline(value.text))
const codeLanguage=(value?:string)=>syntaxLanguage(value||'text')
async function copy(value:string){try{await navigator.clipboard.writeText(value);ElMessage.success('代码已复制')}catch(e){ElMessage.error(String(e))}}
</script>
<template><div class="ai-markdown"><template v-for="(block,index) in blocks" :key="index"><section v-if="block.kind==='code'" class="code-block" :class="'language-'+codeLanguage(block.language)"><header><span>{{codeLanguage(block.language)}}</span><button @click="copy(block.text)">复制代码</button></header><pre><code v-html="highlightCode(block.text,block.language)"></code></pre></section><component :is="'h'+block.level" v-else-if="block.kind==='heading'"><Inline :text="block.text"/></component><hr v-else-if="block.kind==='rule'"><blockquote v-else-if="block.kind==='quote'"><Inline :text="block.text"/></blockquote><component :is="block.ordered?'ol':'ul'" v-else-if="block.kind==='list'" :start="block.ordered?block.start:undefined"><li v-for="(item,itemIndex) in block.items" :key="itemIndex"><Inline :text="item"/></li></component><div v-else-if="block.kind==='table'" class="markdown-table"><table><thead><tr><th v-for="(cell,column) in block.headers" :key="column"><Inline :text="cell"/></th></tr></thead><tbody><tr v-for="(row,rowIndex) in block.rows" :key="rowIndex"><td v-for="(_cell,column) in block.headers" :key="column"><Inline :text="row[column]??''"/></td></tr></tbody></table></div><p v-else><Inline :text="block.text"/></p></template></div></template>
<style scoped>
.ai-markdown{font-size:13px;line-height:1.75;overflow-wrap:anywhere}.ai-markdown>:first-child{margin-top:0}.ai-markdown>:last-child{margin-bottom:0}p{margin:8px 0;white-space:pre-wrap}h1,h2,h3,h4,h5,h6{line-height:1.5;margin:16px 0 6px;font-weight:650}h1{font-size:20px}h2{font-size:18px}h3{font-size:15px}h4,h5,h6{font-size:13px}ul,ol{padding-left:23px;margin:8px 0}li{padding-left:2px;margin:3px 0}blockquote{border-left:3px solid var(--border,#dce4ed);color:var(--text-muted,#7d899a);margin:10px 0;padding:3px 12px;white-space:pre-wrap}hr{border:0;border-top:1px solid var(--border,#dce4ed);margin:16px 0}.ai-markdown :deep(code){font-family:Consolas,'SFMono-Regular',monospace;font-size:12px}.ai-markdown :deep(span>code){padding:2px 5px;border-radius:4px;background:var(--surface-muted,#f1f3f5)}.ai-markdown :deep(a){color:#2563eb;text-decoration:underline;text-underline-offset:3px}.ai-markdown :deep(.ai-file-reference){appearance:none;display:inline;width:auto;height:auto;min-width:0;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:none;color:#2563eb;font:inherit;line-height:inherit;vertical-align:baseline;text-align:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;cursor:pointer}.ai-markdown :deep(.ai-file-reference:hover){background:none;color:#1d4ed8;text-decoration-thickness:2px}.ai-markdown :deep(.ai-file-reference:focus-visible){outline:2px solid #2563eb;outline-offset:2px;border-radius:2px}.ai-markdown :deep(.ai-file-reference code){padding:0;border-radius:0;background:transparent;color:inherit;font:inherit}.code-block{border:1px solid var(--border,#dce4ed);border-radius:8px;overflow:hidden;margin:10px 0}.code-block header{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:var(--surface-muted,#f3f5f7);font-size:11px;color:var(--text-muted,#7d899a);text-transform:uppercase}.code-block button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}.code-block button:focus-visible{outline:2px solid var(--nav-accent,#356d9b)}pre{margin:0;padding:12px 14px;overflow:auto;max-height:500px;background:var(--surface,#fff);white-space:pre;line-height:1.65;tab-size:2}.code-block :deep(.tok-comment){color:#6f8175;font-style:italic}.code-block :deep(.tok-string){color:#66863e}.code-block :deep(.tok-number){color:#ad682d}.code-block :deep(.tok-keyword){color:#8754b1;font-weight:550}.code-block :deep(.tok-property),.code-block :deep(.tok-attr){color:#2d7898}.code-block :deep(.tok-tag){color:#b65353}.code-block :deep(.tok-function){color:#16806c}.code-block :deep(.tok-type){color:#9a7225}.code-block :deep(.tok-variable){color:#376fa4}.code-block :deep(.tok-operator){color:#915878}.code-block :deep(.tok-meta){color:#718079}.code-block :deep(.tok-inserted){color:#28834d}.code-block :deep(.tok-deleted){color:#c34e4e}.markdown-table{overflow:auto;margin:10px 0}table{border-collapse:collapse;min-width:260px;width:100%;font-size:12px}th,td{border:1px solid var(--border,#dce4ed);padding:7px 10px;text-align:left}th{background:var(--surface-muted,#f3f5f7);font-weight:600}
</style>
