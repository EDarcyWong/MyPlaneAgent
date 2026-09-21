import {spawnSync} from 'node:child_process'
import path from 'node:path'

export type SandboxCapability={available:boolean;runtime?:'docker'|'podman';image:string;reason:string}
export type SandboxMetadata={active:boolean;runtime?:'docker'|'podman';image?:string;network:'none'|'host';home:'temporary';reason:string}

let cached:{key:string;at:number;value:SandboxCapability}|undefined
const configuredImage=(override?:string)=>override?.trim()||process.env.MYPLANE_SANDBOX_IMAGE?.trim()||'node:22-bookworm-slim'
const quote=(value:string)=>`'${value.replace(/'/g,"'\\''")}'`

export function sandboxCapability(force=false,imageOverride?:string):SandboxCapability{
 const image=configuredImage(imageOverride),disabled=process.env.MYPLANE_SANDBOX_DISABLE==='1',preferred=process.env.MYPLANE_SANDBOX_RUNTIME?.trim(),key=JSON.stringify({image,disabled,preferred,path:process.env.PATH})
 if(!force&&cached?.key===key&&Date.now()-cached.at<30_000)return cached.value
 if(disabled){const value={available:false,image,reason:'容器沙盒已由环境配置禁用'};cached={key,at:Date.now(),value};return value}
 const candidates=(preferred?[preferred]:['docker','podman']).filter((name,index,all)=>/^(docker|podman)$/.test(name)&&all.indexOf(name)===index) as ('docker'|'podman')[]
 for(const runtime of candidates){
  const version=spawnSync(runtime,['version'],{encoding:'utf8',stdio:'ignore',timeout:2500,windowsHide:true})
  if(version.status!==0)continue
  const inspected=spawnSync(runtime,['image','inspect',image],{encoding:'utf8',stdio:'ignore',timeout:5000,windowsHide:true})
  if(inspected.status===0){const value={available:true,runtime,image,reason:`使用本机已有 ${runtime} 镜像 ${image}`};cached={key,at:Date.now(),value};return value}
 }
 const value={available:false,image,reason:`未发现可用的 Docker/Podman 运行时及本地镜像 ${image}；不会自动拉取镜像`};cached={key,at:Date.now(),value};return value
}

export function buildSandboxedRequest(request:{executable:string;args?:string[];shell?:boolean;cwd:string},capability:SandboxCapability){
 if(!capability.available||!capability.runtime)throw new Error('容器沙盒不可用')
 const workspace=path.resolve(request.cwd),command=request.shell===true?request.executable:[request.executable,...request.args||[]].map(quote).join(' ')
 const args=['run','--rm','--init','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=512m,mode=1777','--tmpfs','/home/agent:rw,nosuid,nodev,size=64m,mode=1777','-e','HOME=/home/agent','-e','CI=1','-v',`${workspace}:/workspace:rw`,'-w','/workspace']
 const user=typeof process.getuid==='function'&&typeof process.getgid==='function'?`${process.getuid()}:${process.getgid()}`:'65532:65532';args.push('--user',user)
 args.push(capability.image,'/bin/sh','-lc',command)
 return {executable:capability.runtime,args,cwd:workspace,shell:false}
}

export const sandboxMetadata=(capability:SandboxCapability,active:boolean):SandboxMetadata=>({active,...(active&&capability.runtime?{runtime:capability.runtime,image:capability.image}:{}),network:active?'none':'host',home:'temporary',reason:active?capability.reason:`${capability.reason}；本次仅在用户确认后以宿主机权限执行`})
