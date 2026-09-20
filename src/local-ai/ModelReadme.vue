<script setup lang="ts">
import {computed,ref} from 'vue'
import {marked} from 'marked'
import createDOMPurify from 'dompurify'
import {ElMessage} from 'element-plus'

const props=defineProps<{text:string;repoId:string;revision?:string}>()
const root=ref<HTMLElement>()
const purifier=createDOMPurify(window)
const repository=computed(()=>`https://huggingface.co/${props.repoId.split('/').map(encodeURIComponent).join('/')}`)
const revision=computed(()=>props.revision&&/^[a-f\d]{40,64}$/i.test(props.revision)?props.revision:'main')

function resourceUrl(raw:string,image=false){
 const value=raw.trim()
 if(!value)return ''
 if(!image&&value.startsWith('#'))return value
 try{
  const url=new URL(value,`${repository.value}/${image?'resolve':'blob'}/${revision.value}/`)
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return ''
  if(image){
   if(url.protocol!=='https:')return ''
   const host=url.hostname.toLowerCase()
   if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.includes(':')||/^\d+(?:\.\d+){3}$/.test(host))return ''
   if(url.hostname==='huggingface.co')url.pathname=url.pathname.replace('/blob/','/resolve/')
  }
  return url.href
 }catch{return ''}
}

purifier.addHook('afterSanitizeAttributes',node=>{
 if(!(node instanceof Element))return
 if(node.tagName==='A'){
  const url=resourceUrl(node.getAttribute('href')||'')
  if(url)node.setAttribute('href',url);else node.removeAttribute('href')
  node.setAttribute('rel','noopener noreferrer')
 }
 if(node.tagName==='IMG'){
  const url=resourceUrl(node.getAttribute('src')||'',true)
  if(url)node.setAttribute('src',url);else node.removeAttribute('src')
  node.setAttribute('loading','lazy');node.setAttribute('decoding','async');node.setAttribute('referrerpolicy','no-referrer')
 }
 if(node.tagName==='INPUT'){node.setAttribute('type','checkbox');node.setAttribute('disabled','')}
 if(/^H[1-6]$/.test(node.tagName)&&!node.id){
  const slug=(node.textContent||'').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s+/g,'-')
  if(slug)node.id=`readme-${slug}`
 }
})

const html=computed(()=>{
 const source=props.text.replace(/^\uFEFF/,'').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'')
 return purifier.sanitize(marked.parse(source,{async:false,gfm:true}),{
  ALLOWED_TAGS:['a','abbr','b','blockquote','br','caption','center','code','col','colgroup','dd','del','details','div','dl','dt','em','figcaption','figure','h1','h2','h3','h4','h5','h6','hr','i','img','input','kbd','li','mark','ol','p','pre','s','section','small','span','strong','sub','summary','sup','table','tbody','td','tfoot','th','thead','tr','ul'],
  ALLOWED_ATTR:['href','src','alt','title','width','height','align','colspan','rowspan','start','open','checked','disabled','type','id'],
  ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,SANITIZE_NAMED_PROPS:true
 })
})

async function navigate(event:MouseEvent){
 const anchor=event.target instanceof Element?event.target.closest('a'):null
 if(!anchor||!root.value?.contains(anchor))return
 event.preventDefault();event.stopPropagation()
 const href=anchor.getAttribute('href');if(!href)return
 if(href.startsWith('#')){
  let id=href.slice(1);try{id=decodeURIComponent(id)}catch{}
  const target=Array.from(root.value.querySelectorAll<HTMLElement>('[id]')).find(element=>[id,`user-content-${id}`,`readme-${id}`].includes(element.id))
  if(target){target.scrollIntoView({block:'start',behavior:'smooth'});return}
 }
 const url=href.startsWith('#')?`${repository.value}${href}`:resourceUrl(href)
 if(url)try{await window.myplane.openAiLink(url)}catch(error){ElMessage.error(String(error))}
}
</script>

<template><div ref="root" class="model-readme" @click="navigate" @auxclick="navigate" v-html="html"></div></template>

<style scoped>
.model-readme{min-width:0;overflow-wrap:anywhere;font-size:13px;line-height:1.8}
.model-readme :deep(:first-child){margin-top:0}
.model-readme :deep(:last-child){margin-bottom:0}
.model-readme :deep(p){margin:10px 0}
.model-readme :deep(h1),.model-readme :deep(h2),.model-readme :deep(h3),.model-readme :deep(h4),.model-readme :deep(h5),.model-readme :deep(h6){line-height:1.45;margin:22px 0 10px;font-weight:650;scroll-margin-top:80px}
.model-readme :deep(h1){font-size:25px}.model-readme :deep(h2){font-size:21px}.model-readme :deep(h3){font-size:17px}
.model-readme :deep(a){color:var(--d-accent,#0d9488);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.model-readme :deep(img){display:inline-block;max-width:100%;height:auto;vertical-align:middle;object-fit:contain}
.model-readme :deep([align="center"]){text-align:center}.model-readme :deep([align="right"]){text-align:right}
.model-readme :deep(ul),.model-readme :deep(ol){padding-left:24px;margin:10px 0}
.model-readme :deep(li){margin:4px 0}.model-readme :deep(li>p){margin:4px 0}
.model-readme :deep(pre){padding:14px 16px;overflow-x:auto;max-width:100%;border:1px solid var(--d-border);border-radius:8px;background:var(--d-panel);white-space:pre;line-height:1.6}
.model-readme :deep(code),.model-readme :deep(kbd){font-family:Consolas,'SFMono-Regular',monospace;font-size:12px}
.model-readme :deep(:not(pre)>code),.model-readme :deep(kbd){padding:2px 5px;border-radius:4px;background:var(--d-panel)}
.model-readme :deep(table){display:block;width:max-content;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:14px 0;font-size:12px}
.model-readme :deep(th),.model-readme :deep(td){border:1px solid var(--d-border);padding:8px 12px;text-align:left;min-width:64px;vertical-align:top}
.model-readme :deep(th){font-weight:600;background:var(--d-panel)}
.model-readme :deep(blockquote){padding:3px 14px;margin:14px 0;border-left:3px solid var(--d-accent);color:var(--d-muted)}
.model-readme :deep(hr){border:0;border-top:1px solid var(--d-border);margin:20px 0}
.model-readme :deep(details){padding:10px 12px;margin:12px 0;border:1px solid var(--d-border);border-radius:8px}
.model-readme :deep(summary){cursor:pointer;font-weight:600}
.model-readme :deep(input[type="checkbox"]){vertical-align:middle;margin-right:6px}
</style>
