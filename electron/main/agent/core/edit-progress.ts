import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {AgentWorkspace} from '../workspace.js'

export type EditProgressState = {files:Record<string,string[]>;ineffective:number}
type Edit = {file:string;before:string;after:string}
const digest=(value:Buffer|string|undefined)=>value===undefined?'missing':createHash('sha256').update(value).digest('hex')
export const textEditTools=new Set(['agent.write_file','agent.replace_text','agent.apply_patch'])

/** Inspect exact bytes without normalizing whitespace or changing the file. Invalid edits stay with the tool validator. */
export function inspectTextEdit(workspace:string,name:string,args:Record<string,unknown>):Edit[]|undefined{
  if(!textEditTools.has(name))return
  try{
    const root=new AgentWorkspace(workspace)
    const changes=name==='agent.apply_patch'?args.changes:[args]
    if(!Array.isArray(changes)||!changes.length)return
    const seen=new Set<string>(),edits:Edit[]=[]
    for(const change of changes){
      if(typeof change?.path!=='string')return
      const relative=path.relative(root.root,path.resolve(root.root,change.path)).split(path.sep).join('/')
      const file=root.resolve(relative,true)
      const identity=process.platform==='win32'?file.toLowerCase():file
      if(seen.has(identity))return
      seen.add(identity)
      const exists=fs.existsSync(file)
      if(exists&&fs.statSync(file).size>2_000_000)return
      const before=exists?fs.readFileSync(file):undefined
      const source=before?.toString('utf8')
      if(before&&!Buffer.from(source!,'utf8').equals(before))return
      let after:unknown
      if(name==='agent.write_file')after=args.content
      else if(name==='agent.apply_patch'){
        if(source!==(change.before??undefined))return
        after=change.after
      }else{
        if(source===undefined||typeof args.oldText!=='string'||!args.oldText||typeof args.newText!=='string')return
        const positions:number[]=[]
        for(let offset=source.indexOf(args.oldText);offset>=0;offset=source.indexOf(args.oldText,offset+args.oldText.length))positions.push(offset)
        const matches=args.startLine===undefined?positions:positions.filter(offset=>source.slice(0,offset).split('\n').length===args.startLine)
        if(matches.length!==1)return
        const index=matches[0]
        after=source.slice(0,index)+args.newText+source.slice(index+args.oldText.length)
      }
      if(typeof after!=='string')return
      edits.push({file:identity,before:digest(before),after:digest(after)})
    }
    return edits
  }catch{return}
}

export class EditProgress {
  constructor(readonly state:EditProgressState={files:{},ineffective:0}){}
  /** A resumed run keeps file hashes for cycle detection but gets its own failure budget. */
  beginAttempt(){this.state.ineffective=0}
  inspect(edits:Edit[]|undefined):'unchanged'|'cycle'|undefined{
    if(!edits)return
    if(edits.every(edit=>edit.before===edit.after))return 'unchanged'
    for(const edit of edits){
      const history=this.state.files[edit.file]
      // A -> B -> A may be a valid rollback; repeating A -> B after that is a loop.
      if(history?.at(-1)===edit.before&&history.length>=3){
        for(let i=0;i<history.length-1;i++)if(history[i]===edit.before&&history[i+1]===edit.after&&edit.before!==edit.after)return 'cycle'
      }
    }
  }
  record(edits:Edit[]|undefined,unchanged:boolean){
    if(unchanged){this.state.ineffective++;return}
    if(!edits)return
    let changed=false
    for(const edit of edits){
      let actual:string
      try{actual=digest(fs.readFileSync(edit.file))}catch{continue}
      if(actual!==edit.after||edit.before===edit.after)continue
      const previous=this.state.files[edit.file]
      const history=previous?.at(-1)===edit.before?previous:[edit.before]
      this.state.files[edit.file]=[...history,actual].slice(-8);changed=true
    }
    if(changed)this.state.ineffective=0
    const keys=Object.keys(this.state.files)
    for(const key of keys.slice(0,Math.max(0,keys.length-256)))delete this.state.files[key]
  }
}
