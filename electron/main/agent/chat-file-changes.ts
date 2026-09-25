import fs from 'node:fs'
import {AgentWorkspace} from './workspace.js'
import type {StudioFileChange} from '../../shared/local-ai-studio.js'

export function prepareChatFileChanges(root:string,capability:string,args:Record<string,unknown>){
 if(!['agent.write_file','agent.replace_text','agent.apply_patch'].includes(capability))return
 const workspace=new AgentWorkspace(root)
 const paths=capability==='agent.apply_patch'&&Array.isArray(args.changes)?args.changes.map(change=>change?.path):[args.path]
 const read=(name:string)=>{
  const file=workspace.resolve(name,true)
  if(!fs.existsSync(file))return undefined
  if(fs.statSync(file).size>100000)throw new Error('文件过大，不保存聊天快照')
  return workspace.read(name)
 }
 const before=paths.flatMap(name=>{
  try{if(typeof name!=='string')return [];return [{path:name,before:read(name)}]}catch{return []}
 })
 return {paths:before.map(change=>change.path),finish:():StudioFileChange[]=>before.flatMap(change=>{
  try{const after=read(change.path);return after===undefined?[]:[{...change,after}]}catch{return []}
 })}
}
