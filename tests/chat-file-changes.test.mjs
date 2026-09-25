import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {prepareChatFileChanges} from '../dist-electron/main/agent/chat-file-changes.js'
test('chat snapshots record complete content and distinguish a new file from an empty existing file',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-chat-snapshot-'))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 fs.writeFileSync(path.join(root,'existing.txt'),'')
 const snapshot=prepareChatFileChanges(root,'agent.apply_patch',{changes:[{path:'new.txt'},{path:'existing.txt'},{path:'../outside.txt'},{path:'.env'}]})
 assert.deepEqual(snapshot.paths,['new.txt','existing.txt'])
 fs.writeFileSync(path.join(root,'new.txt'),'new')
 fs.writeFileSync(path.join(root,'existing.txt'),'updated')
 assert.deepEqual(snapshot.finish(),[{path:'new.txt',before:undefined,after:'new'},{path:'existing.txt',before:'',after:'updated'}])
 assert.equal(prepareChatFileChanges(root,'agent.read_file',{path:'new.txt'}),undefined)
})
