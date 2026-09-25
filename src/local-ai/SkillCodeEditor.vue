<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {basicSetup} from 'codemirror'
import {Compartment,EditorState} from '@codemirror/state'
import {EditorView,keymap} from '@codemirror/view'
import {indentWithTab} from '@codemirror/commands'
import {HighlightStyle,indentUnit,syntaxHighlighting} from '@codemirror/language'
import {json,jsonParseLinter} from '@codemirror/lang-json'
import {python} from '@codemirror/lang-python'
import {markdown} from '@codemirror/lang-markdown'
import {languages} from '@codemirror/language-data'
import {linter} from '@codemirror/lint'
import {tags} from '@lezer/highlight'
import AiMarkdown from '../AiMarkdown.vue'
const props=defineProps<{modelValue:string;filename:string;readonly?:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:string];save:[]}>()
const host=ref<HTMLElement>()
const preview=ref(false)
const position=ref('1:1')
const language=computed(()=>props.filename.toLowerCase().endsWith('.py')?'Python':props.filename.toLowerCase().endsWith('.json')?'JSON':'Markdown')
const editable=new Compartment()
const states=new Map<string,{state:EditorState;scrollTop:number;scrollLeft:number}>()
let view:EditorView|undefined
let activeFile=''
const colors=HighlightStyle.define([
 {tag:tags.variableName,color:'var(--code-variable)'},
 {tag:[tags.keyword,tags.modifier,tags.operatorKeyword],color:'var(--code-keyword)',fontWeight:'550'},
 {tag:[tags.string,tags.special(tags.string),tags.regexp],color:'var(--code-string)'},
 {tag:tags.number,color:'var(--code-number)'},
 {tag:[tags.bool,tags.null,tags.atom],color:'var(--code-constant)'},
 {tag:[tags.propertyName,tags.attributeName],color:'var(--code-property)'},
 {tag:[tags.function(tags.variableName),tags.function(tags.propertyName)],color:'var(--code-function)'},
 {tag:[tags.typeName,tags.className,tags.namespace],color:'var(--code-type)'},
 {tag:[tags.standard(tags.variableName),tags.special(tags.variableName)],color:'var(--code-builtin)'},
 {tag:[tags.operator,tags.punctuation],color:'var(--code-operator)'},
 {tag:[tags.meta,tags.annotation,tags.processingInstruction],color:'var(--code-builtin)'},
 {tag:tags.tagName,color:'var(--code-keyword)'},
 {tag:tags.comment,color:'var(--code-comment)',fontStyle:'italic'},
 {tag:tags.heading,color:'var(--code-keyword)',fontWeight:'650'},
 {tag:tags.strong,color:'var(--code-type)',fontWeight:'bold'},
 {tag:tags.emphasis,color:'var(--code-type)',fontStyle:'italic'},
 {tag:[tags.link,tags.url],color:'var(--code-property)',textDecoration:'underline'},
 {tag:tags.monospace,color:'var(--code-string)'},
 {tag:tags.invalid,color:'var(--s-danger)',textDecoration:'underline wavy'}
])
const theme=EditorView.theme({
 '&':{height:'100%',backgroundColor:'var(--s-bg)',color:'var(--s-text)',fontSize:'12px'},
 '.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',lineHeight:'1.85'},
 '.cm-content':{padding:'14px 0',caretColor:'var(--s-text)'},
 '.cm-line':{padding:'0 16px'},
 '.cm-gutters':{backgroundColor:'var(--s-bg)',color:'var(--s-dim)',borderRight:'1px solid var(--s-border)'},
 '.cm-gutterElement':{padding:'0 8px'},
 '.cm-activeLine,.cm-activeLineGutter':{backgroundColor:'var(--s-muted)'},
 '&.cm-focused':{outline:'none'},
 '.cm-cursor':{borderLeftColor:'var(--s-text)'},
 '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':{backgroundColor:'color-mix(in srgb, var(--s-accent) 20%, transparent)'},
 '.cm-tooltip,.cm-panels':{backgroundColor:'var(--s-panel)',color:'var(--s-text)',borderColor:'var(--s-border)'},
 '.cm-searchMatch':{backgroundColor:'color-mix(in srgb, var(--code-number) 25%, transparent)'},
 '.cm-foldPlaceholder':{backgroundColor:'var(--s-muted)',borderColor:'var(--s-border)',color:'var(--s-dim)'},
 '.cm-textfield,.cm-button':{background:'var(--s-muted)',color:'var(--s-text)',border:'1px solid var(--s-border)',borderRadius:'4px'},
 '.cm-tooltip-autocomplete > ul > li[aria-selected]':{backgroundColor:'var(--s-accent-soft)',color:'var(--s-text)'}
})
function updatePosition(){if(view){const point=view.state.selection.main.head,line=view.state.doc.lineAt(point);position.value=`${line.number}:${point-line.from+1}`}}
function createState(){
 return EditorState.create({doc:props.modelValue,extensions:[basicSetup,theme,syntaxHighlighting(colors),
  language.value==='JSON'?[json(),linter(jsonParseLinter())]:language.value==='Python'?python():[markdown({codeLanguages:languages}),EditorView.lineWrapping],
  indentUnit.of(language.value==='Python'?'    ':'  '),
  editable.of(EditorState.readOnly.of(!!props.readonly)),
  EditorView.contentAttributes.of({'aria-label':props.filename,spellcheck:'false'}),
  keymap.of([{key:'Mod-s',run:()=>{if(!props.readonly)emit('save');return true}},indentWithTab]),
  EditorView.updateListener.of(update=>{if(update.docChanged)emit('update:modelValue',update.state.doc.toString());if(update.docChanged||update.selectionSet)updatePosition()})
 ]})
}
function syncContent(){
 if(!view)return
 const current=view.state.doc.toString()
 if(current!==props.modelValue)view.dispatch({changes:{from:0,to:current.length,insert:props.modelValue}})
}
onMounted(()=>{activeFile=props.filename;view=new EditorView({parent:host.value,state:createState()});updatePosition()})
watch(()=>props.filename,()=>{
 if(!view)return
 states.set(activeFile,{state:view.state,scrollTop:view.scrollDOM.scrollTop,scrollLeft:view.scrollDOM.scrollLeft})
 activeFile=props.filename;preview.value=false
 const cached=states.get(activeFile)
 view.setState(cached?.state||createState())
 view.dispatch({effects:editable.reconfigure(EditorState.readOnly.of(!!props.readonly))})
 syncContent();updatePosition()
 view.requestMeasure({read:()=>null,write:()=>{if(view){view.scrollDOM.scrollTop=cached?.scrollTop||0;view.scrollDOM.scrollLeft=cached?.scrollLeft||0}}})
})
watch(()=>props.modelValue,syncContent)
watch(()=>props.readonly,()=>view?.dispatch({effects:editable.reconfigure(EditorState.readOnly.of(!!props.readonly))}))
watch(preview,value=>{if(!value)view?.requestMeasure()})
onBeforeUnmount(()=>view?.destroy())
</script>
<template>
 <div class="skill-code-editor">
  <div v-if="language==='Markdown'" class="document-modes" role="group" aria-label="Markdown 显示方式"><button :aria-pressed="!preview" @click="preview=false">编辑</button><button :aria-pressed="preview" @click="preview=true">预览</button></div>
  <div v-show="!preview" ref="host" class="editor-host"/>
  <div v-if="preview" class="markdown-preview"><AiMarkdown v-if="modelValue" :text="modelValue"/><p v-else>暂无文档内容</p></div>
  <footer><span>{{ language }}</span><span v-if="!preview">行:列 {{ position }}</span><span>{{ readonly ? '只读' : language==='Python'?'4 空格缩进':'2 空格缩进' }}</span><small v-if="!preview">⌘ / Ctrl + F 查找 · Esc 后按 Tab 移出编辑器</small></footer>
 </div>
</template>
<style scoped>
.skill-code-editor{--code-keyword:light-dark(#8839a4,#cba6f7);--code-string:light-dark(#357a38,#a6d89b);--code-number:light-dark(#a45516,#efb879);--code-constant:light-dark(#9d3b6a,#f2a9ca);--code-property:light-dark(#096d9d,#89c9ee);--code-function:light-dark(#276bb0,#89b4fa);--code-variable:light-dark(#383d49,#cdd6e6);--code-type:light-dark(#926515,#f2cf87);--code-builtin:light-dark(#087c78,#81d4c4);--code-operator:light-dark(#6c5178,#c2adc9);--code-comment:light-dark(#68776b,#94a698);display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}.editor-host{flex:1;min-height:180px;overflow:hidden}.document-modes{display:flex;gap:4px;padding:7px 20px;border-bottom:1px solid var(--s-border)}.document-modes button{font:inherit;font-size:11px;background:transparent;color:var(--s-dim);border:0;border-radius:5px;padding:4px 12px;cursor:pointer}.document-modes button[aria-pressed=true]{background:var(--s-muted);color:var(--s-text)}.document-modes button:focus-visible{outline:2px solid var(--s-accent)}.markdown-preview{flex:1;min-height:180px;overflow:auto;padding:24px;line-height:1.8}.markdown-preview>p{color:var(--s-dim)}footer{display:flex;flex-wrap:wrap;gap:14px;flex:none;border-top:1px solid var(--s-border);padding:6px 14px;color:var(--s-dim);font-size:10px}footer small{margin-left:auto;font-size:10px}
</style>
