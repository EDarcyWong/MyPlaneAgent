import fs from 'node:fs'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const execute=promisify(execFile)
const queues=new Map<string,Promise<unknown>>()

export async function ensureLocalGitHistory(root:string):Promise<string|undefined>{
 const result=JSON.parse(await withLocalGitHistory(root,[],async()=>'{}'))
 return result.localHistoryWarning
}

// This recorder has no network operations. Existing repositories are opt-out.
export async function withLocalGitHistory(root:string,paths:string[],action:()=>Promise<string>):Promise<string>{
 const key=process.platform==='win32'?root.toLowerCase():root
 const previous=queues.get(key)||Promise.resolve()
 const pending=previous.catch(()=>{}).then(async()=>{
  const meta=path.join(root,'.git'),warnings:string[]=[]
  const git=async(args:string[])=>{
   const result=await execute('git',['-c','core.hooksPath='+path.join(meta,'myplane-disabled-hooks'),'-c','core.fsmonitor=false','-c','commit.gpgSign=false','-c','user.name=MyPlaneAgent','-c','user.email=local@myplane.invalid',...args],{
    cwd:root,windowsHide:true,timeout:15000,maxBuffer:1024*1024,
    env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_LITERAL_PATHSPECS:args[0]==='check-ignore'?'0':'1'},
   })
   return result.stdout.trim()
  }
  let enabled=false
  try{
   let insideRepository=false
   for(let dir=root;;dir=path.dirname(dir)){
    if(fs.existsSync(path.join(dir,'.git'))){insideRepository=true;break}
    if(path.dirname(dir)===dir)break
   }
   if(!insideRepository){
    await git(['init','--template='])
    await git(['config','--local','myplane.localHistory','true'])
   }
   if(fs.existsSync(meta)&&fs.lstatSync(meta).isDirectory()&&!fs.lstatSync(meta).isSymbolicLink()){
    enabled=await git(['config','--local','--get','myplane.localHistory']).catch(()=>'')==='true'
   }
  }catch(error){warnings.push('本地 Git 记录不可用：'+String(error))}
  const checkpoint=async(label:string)=>{
   const selected:string[]=[]
   for(const name of [...new Set(paths)]){
    // Respect user ignores and never consume changes they have staged themselves.
    if(await git(['diff','--cached','--name-only','--',name]))continue
    const tracked=await git(['ls-files','--',name])
    if(!tracked){
     if(!fs.existsSync(path.join(root,name)))continue
     const ignored=await git(['check-ignore','--quiet','--',name]).then(()=>true,error=>{if(error.code===1)return false;throw error})
     if(ignored)continue
    }
    selected.push(name)
   }
   if(!selected.length)return
   await git(['add','-A','--',...selected])
   if(!await git(['diff','--cached','--name-only','--',...selected]))return
   await git(['commit','--only','--no-verify','-m',label,'--',...selected])
  }
  if(enabled)try{await checkpoint('MyPlaneAgent: before file change')}catch(error){enabled=false;warnings.push('本地 Git 基线记录失败：'+String(error))}
  const output=await action()
  if(enabled)try{await checkpoint('MyPlaneAgent: file change')}catch(error){warnings.push('文件已修改，但本地 Git 记录失败：'+String(error))}
  if(!warnings.length)return output
  return JSON.stringify({...JSON.parse(output),localHistoryWarning:warnings.join('\n').slice(0,2000)})
 })
 queues.set(key,pending)
 try{return await pending}finally{if(queues.get(key)===pending)queues.delete(key)}
}
