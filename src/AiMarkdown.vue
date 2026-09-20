<script setup lang="ts">
import {computed,h,type VNodeChild} from 'vue'
import {ElMessage} from 'element-plus'
const props=defineProps<{text:string}>()
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
function inline(text:string,depth=0):VNodeChild[]{
 if(depth>3)return [text]
 const pattern=/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|~~[^~\n]+~~|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g
 const result:VNodeChild[]=[];let last=0
 for(const match of text.matchAll(pattern)){const index=match.index!,token=match[0];if(index>last)result.push(text.slice(last,index));if(token.startsWith('`'))result.push(h('code',token.slice(1,-1)));else if(token.startsWith('**')||token.startsWith('__'))result.push(h('strong',inline(token.slice(2,-2),depth+1)));else if(token.startsWith('~~'))result.push(h('del',token.slice(2,-2)));else if(token.startsWith('*'))result.push(h('em',inline(token.slice(1,-1),depth+1)));else{const link=token.match(/^\[([^\]]+)\]\((.+)\)$/)!;result.push(h('a',{href:link[2],title:link[2],onClick:(e:MouseEvent)=>{e.preventDefault();void open(link[2])}},link[1]))}last=index+token.length}
 if(last<text.length)result.push(text.slice(last));return result
}
const Inline=(value:{text:string})=>h('span',inline(value.text))
async function copy(value:string){try{await navigator.clipboard.writeText(value);ElMessage.success('代码已复制')}catch(e){ElMessage.error(String(e))}}
</script>
<template><div class="ai-markdown"><template v-for="(block,index) in blocks" :key="index"><section v-if="block.kind==='code'" class="code-block"><header><span>{{block.language}}</span><button @click="copy(block.text)">复制代码</button></header><pre><code>{{block.text}}</code></pre></section><component :is="'h'+block.level" v-else-if="block.kind==='heading'"><Inline :text="block.text"/></component><hr v-else-if="block.kind==='rule'"><blockquote v-else-if="block.kind==='quote'"><Inline :text="block.text"/></blockquote><component :is="block.ordered?'ol':'ul'" v-else-if="block.kind==='list'" :start="block.ordered?block.start:undefined"><li v-for="(item,itemIndex) in block.items" :key="itemIndex"><Inline :text="item"/></li></component><div v-else-if="block.kind==='table'" class="markdown-table"><table><thead><tr><th v-for="(cell,column) in block.headers" :key="column"><Inline :text="cell"/></th></tr></thead><tbody><tr v-for="(row,rowIndex) in block.rows" :key="rowIndex"><td v-for="(_cell,column) in block.headers" :key="column"><Inline :text="row[column]??''"/></td></tr></tbody></table></div><p v-else><Inline :text="block.text"/></p></template></div></template>
<style scoped>
.ai-markdown{font-size:13px;line-height:1.75;overflow-wrap:anywhere}.ai-markdown>:first-child{margin-top:0}.ai-markdown>:last-child{margin-bottom:0}p{margin:8px 0;white-space:pre-wrap}h1,h2,h3,h4,h5,h6{line-height:1.5;margin:16px 0 6px;font-weight:650}h1{font-size:20px}h2{font-size:18px}h3{font-size:15px}h4,h5,h6{font-size:13px}ul,ol{padding-left:23px;margin:8px 0}li{padding-left:2px;margin:3px 0}blockquote{border-left:3px solid var(--border,#dce4ed);color:var(--text-muted,#7d899a);margin:10px 0;padding:3px 12px;white-space:pre-wrap}hr{border:0;border-top:1px solid var(--border,#dce4ed);margin:16px 0}.ai-markdown :deep(code){font-family:Consolas,'SFMono-Regular',monospace;font-size:12px}.ai-markdown :deep(span>code){padding:2px 5px;border-radius:4px;background:var(--surface-muted,#f1f3f5)}.ai-markdown :deep(a){color:var(--nav-accent,#356d9b);text-decoration:underline;text-underline-offset:3px}.code-block{border:1px solid var(--border,#dce4ed);border-radius:8px;overflow:hidden;margin:10px 0}.code-block header{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:var(--surface-muted,#f3f5f7);font-size:11px;color:var(--text-muted,#7d899a)}.code-block button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}.code-block button:focus-visible{outline:2px solid var(--nav-accent,#356d9b)}pre{margin:0;padding:12px 14px;overflow:auto;max-height:500px;background:var(--surface,#fff);white-space:pre;line-height:1.65}.markdown-table{overflow:auto;margin:10px 0}table{border-collapse:collapse;min-width:260px;width:100%;font-size:12px}th,td{border:1px solid var(--border,#dce4ed);padding:7px 10px;text-align:left}th{background:var(--surface-muted,#f3f5f7);font-weight:600}
</style>
