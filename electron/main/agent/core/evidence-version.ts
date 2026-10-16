import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'

/** A bounded source snapshot. Incomplete snapshots must never certify freshness. */
export function workspaceVersion(workspace:string):string|undefined {
  if(!workspace)return
  const hash=createHash('sha256'),excluded=new Set(['node_modules','.git','dist','dist-electron','build','release','coverage','.venv','venv','__pycache__','.cache','.next','test-results','playwright-report'])
  let files=0,entries=0,bytes=0,complete=true
  const visit=(directory:string,depth=0)=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(!complete)return
      if(++entries>10000||depth>20){complete=false;return}
      if(excluded.has(entry.name)||entry.name.startsWith('.electron-build-'))continue
      const file=path.join(directory,entry.name),relative=path.relative(workspace,file)
      if(entry.isSymbolicLink()){complete=false;continue}
      if(entry.isDirectory()){visit(file,depth+1);continue}
      if(!entry.isFile())continue
      const size=fs.statSync(file).size
      if(++files>5000||(bytes+=size)>32_000_000){complete=false;return}
      hash.update(relative+'\0').update(fs.readFileSync(file)).update('\0')
    }
  }
  try{visit(workspace);return complete?hash.digest('hex'):undefined}catch{return undefined}
}
