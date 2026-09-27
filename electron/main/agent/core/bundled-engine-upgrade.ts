import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex')
const shippedEngineHashes=new Set(['ed45e6e3ca697b67e5333085450ce3faf675c8f21747e31afa7ac438a028bb93'])
/** Upgrade only a recognized shipped engine. Keep user-edited engines and an immutable copy of the old one. */
export function upgradeBundledEngine(source:string,destination:string,history:string,knownHashes:ReadonlySet<string>=shippedEngineHashes):boolean{
  if(!fs.existsSync(source)||!fs.existsSync(destination))return false
  const previous=fs.readFileSync(destination),next=fs.readFileSync(source)
  if(previous.equals(next)||!knownHashes.has(hash(Buffer.from(previous.toString('utf8').replace(/\r\n/g,'\n')))))return false
  fs.mkdirSync(history,{recursive:true})
  const archive=path.join(history,hash(previous)+'.py')
  if(!fs.existsSync(archive))fs.writeFileSync(archive,previous,{flag:'wx'})
  const temp=destination+'.'+randomUUID()+'.tmp'
  try{
    fs.writeFileSync(temp,next,{flag:'wx'})
    if(!fs.readFileSync(destination).equals(previous))return false
    fs.renameSync(temp,destination)
    return true
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}
}
