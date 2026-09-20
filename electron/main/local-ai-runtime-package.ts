import {accessSync,chmodSync,constants,createReadStream,createWriteStream,linkSync,mkdirSync,readFileSync,statSync,symlinkSync} from 'node:fs'
import path from 'node:path'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {createGunzip} from 'node:zlib'
import {Unpack,type ReadEntry} from 'tar'
import JSZip from 'jszip'
import {inside,modelFile} from './local-ai-utils.js'
import type {RuntimePackage} from '../shared/local-ai-developer.js'

export const maxRuntimeArchive=250*1024*1024
const maxExpanded=1500*1024*1024,maxEntries=1500
export function runtimeExecutableName(platform:NodeJS.Platform=process.platform){return platform==='win32'?'llama-server.exe':'llama-server'}
export function validRuntimeExecutable(file:string,platform:NodeJS.Platform=process.platform){
 try{
  if(!file||!path.isAbsolute(file)||path.basename(file).toLowerCase()!==runtimeExecutableName(platform)||!statSync(file).isFile())return false
  accessSync(file,platform==='win32'?constants.F_OK:constants.X_OK)
  return true
 }catch{return false}
}
export function runtimePackageFlavor(name:string,platform:NodeJS.Platform,arch:string):RuntimePackage['flavor']|undefined{
 if(!['arm64','x64'].includes(arch))return
 if(platform==='darwin')return name.match(/^llama-.+-bin-macos-(arm64|x64)\.tar\.gz$/i)?.[1]?.toLowerCase()===arch?'metal':undefined
 if(platform==='win32'){
  const match=name.match(/^llama-.+-bin-win-(cpu|vulkan)-(x64|arm64)\.zip$/i)
  if(match?.[2].toLowerCase()===arch)return match[1].toLowerCase() as 'cpu'|'vulkan'
 }
}

// Extract only into a new, private directory. Keep the complete library layout.
export async function extractRuntimeArchive(archive:string,directory:string,platform:NodeJS.Platform,signal:AbortSignal):Promise<string>{
 mkdirSync(directory,{recursive:true})
 const name=runtimeExecutableName(platform)
 let binary='',expanded=0
 const safePath=(value:string)=>modelFile(value.replace(/^(\.\/)+/,'').replace(/\/$/,''))
 if(platform==='darwin'){
  let count=0,invalid:Error|undefined
  const paths=new Set<string>(),links=new Map<string,{target:string;hard:boolean}>()
  const unpack=new Unpack({cwd:directory,strict:true,preserveOwner:false,chmod:true,umask:0o022,filter:(_file,raw)=>{
   if(invalid)return false
   try{
    signal.throwIfAborted()
    const entry=raw as ReadEntry
    if(++count>maxEntries)throw new Error('压缩包文件数量超过安全上限')
    if(entry.type==='Directory'&&/^(\.\/)*\.?\/?$/.test(entry.path))return false
    const safe=safePath(entry.path);inside(directory,safe)
    if(paths.has(safe.toLowerCase()))throw new Error('运行包包含重复路径')
    paths.add(safe.toLowerCase())
    if(!['File','Directory','SymbolicLink','Link'].includes(entry.type))throw new Error('运行包包含不支持的文件类型')
    expanded+=entry.size
    if(!Number.isSafeInteger(entry.size)||entry.size<0||expanded>maxExpanded)throw new Error('运行包解压体积超过安全上限')
    if(entry.type==='SymbolicLink'||entry.type==='Link'){
     const link=entry.linkpath||''
     if(!link||path.posix.isAbsolute(link)||link.includes('\\'))throw new Error('运行包链接超出安装目录')
     const resolved=path.posix.normalize(path.posix.join(entry.type==='SymbolicLink'?path.posix.dirname(safe):'',link))
     inside(directory,modelFile(resolved))
     // Defer links until regular files are complete. This also supports dylib
     // chains which node-tar deliberately refuses to extract through.
     links.set(safe,{target:resolved,hard:entry.type==='Link'})
     return false
    }
    // Strip special permission bits while retaining executable files.
    entry.mode=entry.type==='Directory'?0o755:((entry.mode||0)&0o111)?0o755:0o644
    if(entry.type==='File'&&path.posix.basename(safe)===name)binary=safe
    return true
   }catch(error){invalid=error instanceof Error?error:new Error(String(error));return false}
  }})
  let inflated=0
  const limit=new Transform({transform(chunk:Buffer,_encoding,done){inflated+=chunk.length;done(inflated>maxExpanded+16*1024*1024?new Error('运行包解压体积超过安全上限'):null,chunk)}})
  await pipeline(createReadStream(archive),createGunzip(),limit,unpack,{signal})
  if(invalid)throw invalid
  const linkPaths=new Set([...links.keys()].map(file=>file.toLowerCase()))
  const checkParents=(file:string)=>{
   for(let parent=path.posix.dirname(file);parent!=='.';parent=path.posix.dirname(parent))if(linkPaths.has(parent.toLowerCase()))throw new Error('运行包不能通过符号链接写入目录')
  }
  // Validate every link before creating any of them; only regular file targets
  // are permitted, never directories, missing targets or cyclic chains.
  const resolvedLinks=[...links].map(([file,link])=>{
   checkParents(file)
   let target=link.target;const seen=new Set([file])
   while(links.has(target)){
    if(seen.has(target))throw new Error('运行包包含循环符号链接')
    seen.add(target);target=links.get(target)!.target
   }
   checkParents(target)
   if(!statSync(inside(directory,target)).isFile())throw new Error('运行包链接必须指向包内文件')
   return {file,target,hard:link.hard}
  })
  for(const {file,target,hard} of resolvedLinks){
   signal.throwIfAborted()
   const destination=inside(directory,file),source=inside(directory,target)
   mkdirSync(path.dirname(destination),{recursive:true})
   if(hard)linkSync(source,destination)
   else symlinkSync(path.relative(path.dirname(destination),source),destination)
  }
 }else{
  const zip=await JSZip.loadAsync(readFileSync(archive)),entries=Object.values(zip.files)
  if(entries.length>maxEntries)throw new Error('压缩包文件数量超过安全上限')
  for(const entry of entries){
   signal.throwIfAborted()
   const original=(entry as typeof entry&{unsafeOriginalName?:string}).unsafeOriginalName||entry.name
   if(!original||/^(\.\/)+$/.test(original))continue
   const safe=safePath(original),target=inside(directory,safe)
   if((Number(entry.unixPermissions)&0xf000)===0xa000)throw new Error('运行包中包含不允许的符号链接')
   if(entry.dir){mkdirSync(target,{recursive:true});continue}
   mkdirSync(path.dirname(target),{recursive:true})
   const limit=new Transform({transform(chunk:Buffer,_encoding,done){expanded+=chunk.length;done(expanded>maxExpanded?new Error('运行包解压体积超过安全上限'):null,chunk)}})
   await pipeline(entry.nodeStream('nodebuffer'),limit,createWriteStream(target,{flags:'wx'}),{signal})
   if(path.basename(safe).toLowerCase()===name)binary=safe
  }
 }
 signal.throwIfAborted()
 if(!binary)throw new Error(`运行包中未找到 ${name}，请选择二进制运行包而非源码包`)
 const executable=inside(directory,binary)
 if(platform!=='win32')chmodSync(executable,0o755)
 if(!validRuntimeExecutable(executable,platform))throw new Error(`运行文件 ${name} 无效或没有执行权限`)
 return binary
}
