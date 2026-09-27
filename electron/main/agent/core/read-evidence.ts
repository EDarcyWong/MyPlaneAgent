import path from 'node:path'
import type {StudioToolActivity} from '../../../shared/local-ai-studio.js'
import {parsedToolResult} from './task-verification.js'

/** Classification only. Never grants permission or executes/re-writes a command. */
export function readCommandPath(command:unknown):string|undefined{
 if(typeof command!=='string'||/[;&|<>%$`\r\n()]/.test(command))return
 const match=command.trim().match(/^(?:head|tail)(?:\s+-\d+|\s+-n\s+\d+)?\s+("[^"*?]+"|'[^'*?]+'|[\w./\\:-]+)$|^(?:cat|type|Get-Content)\s+("[^"*?]+"|'[^'*?]+'|[\w./\\:-]+)$/i)
 const target=match?.[1]||match?.[2]
 if(!target)return
 const value=target.replace(/^["']|["']$/g,'')
 if(value.startsWith('-'))return
 return value
}
export function isReadCommand(name:string,args:Record<string,unknown>){return name==='agent.run_command'&&!!readCommandPath(args.command)}
const fileKey=(workspace:string,value:unknown)=>{const resolved=typeof value==='string'?path.resolve(workspace,value).replace(/\\/g,'/'):'';return process.platform==='win32'?resolved.toLowerCase():resolved}
export function recoveredReadFailure(workspace:string,failure:StudioToolActivity,success:StudioToolActivity,allowStructuralSearch=false){
 if(success.status!=='complete'||failure.status!=='error')return false
 const target=failure.capability==='agent.code_outline'&&/支持的代码文件|unsupported/i.test(failure.output||'')?failure.args.path:
  isReadCommand(failure.capability,failure.args)?readCommandPath(failure.args.command):undefined
 if(!target)return false
 const result=parsedToolResult(success.output),key=fileKey(workspace,target)
 const text=result.text??result.content
 if(success.capability==='agent.read_file')return fileKey(workspace,success.args.path)===key&&result.truncated!==true&&typeof text==='string'&&!!text.trim()
 // Structural search is a fallback source of project/entry information, not a
 // claim that the failed shell command ran successfully or a full file was read.
 return allowStructuralSearch&&success.capability==='agent.search_files'&&result.truncated===false&&Array.isArray(result.matches)&&result.matches.some((row:Record<string,unknown>)=>fileKey(workspace,row.path)===key&&typeof row.text==='string'&&/<script\b|\b(?:import|export|function|class)\b/.test(row.text))
}
