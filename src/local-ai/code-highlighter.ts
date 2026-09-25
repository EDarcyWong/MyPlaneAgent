import {LanguageDescription} from '@codemirror/language'
import {languages} from '@codemirror/language-data'
import {highlightTree,tagHighlighter,tags} from '@lezer/highlight'
import {highlightCode,syntaxLanguage} from './syntax-highlight'

const escape=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const colors=tagHighlighter([
 {tag:tags.keyword,class:'tok-keyword'},{tag:tags.comment,class:'tok-comment'},
 {tag:[tags.string,tags.regexp],class:'tok-string'},{tag:tags.number,class:'tok-number'},
 {tag:[tags.bool,tags.null,tags.atom],class:'tok-keyword'},
 {tag:[tags.propertyName,tags.attributeName],class:'tok-property'},
 {tag:[tags.typeName,tags.className],class:'tok-type'},
 {tag:[tags.function(tags.variableName),tags.function(tags.propertyName)],class:'tok-function'},
 {tag:tags.tagName,class:'tok-tag'},{tag:tags.operator,class:'tok-operator'},
 {tag:[tags.meta,tags.annotation],class:'tok-meta'}
])

export function sourceLanguage(code:string,language?:string,fragment=false){
 return fragment&&/\.(vue|svelte|html?)$/i.test(language||'')&&!/<\/?[A-Za-z][\w:-]*(?:\s|>|\/)/.test(code)?'typescript':language
}

export async function highlightSource(code:string,language='text'){
 const name=syntaxLanguage(language),fallback=highlightCode(code,name)
 if(code.length>200000||name==='text'||name==='diff')return fallback
 const description=LanguageDescription.matchFilename(languages,language)||LanguageDescription.matchLanguageName(languages,name==='markup'?'html':name)
 if(!description)return fallback
 try{
  const support=await description.load()
  let output='',last=0
  highlightTree(support.language.parser.parse(code),colors,(from,to,classes)=>{
   // Each line has balanced markup, even inside multiline comments or strings.
   output+=escape(code.slice(last,from))+code.slice(from,to).split('\n').map(line=>`<span class="${classes}">${escape(line)}</span>`).join('\n');last=to
  })
  return output+escape(code.slice(last))
 }catch{return fallback}
}
