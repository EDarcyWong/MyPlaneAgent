import {execFile} from 'node:child_process'
export async function stopProcessTree(pid:number){
 if(!Number.isSafeInteger(pid)||pid<=1||pid===process.pid)return
 if(process.platform==='win32'){await new Promise<void>(resolve=>execFile('taskkill',['/pid',String(pid),'/T','/F'],{timeout:3000,windowsHide:true},()=>resolve()));return}
 const children=await new Promise<number[]>(resolve=>execFile('/bin/ps',['-axo','pid=,ppid='],{timeout:2000,maxBuffer:1000000},(error,stdout)=>{
  if(error){resolve([]);return}const rows=stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)),found:number[]=[]
  const walk=(parent:number,depth:number)=>{if(depth>30)return;for(const [child,owner] of rows)if(owner===parent&&child!==process.pid){walk(child,depth+1);found.push(child)}};walk(pid,0);resolve(found)
 }))
 for(const child of [...children,pid])try{process.kill(child,'SIGKILL')}catch{/* Already exited. */}
}
