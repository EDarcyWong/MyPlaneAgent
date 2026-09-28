import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EditProgress,inspectTextEdit} from '../dist-electron/main/agent/core/edit-progress.js'
test('actual content tracks equivalent edits, allows one rollback and prevents oscillation across tools',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-edit-progress-'))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const file=path.join(root,'file.txt');fs.writeFileSync(file,'A')
 const tracker=new EditProgress()
 let edits=inspectTextEdit(root,'agent.write_file',{path:'./file.txt',content:'A'})
 assert.equal(tracker.inspect(edits),'unchanged');tracker.record(edits,true)
 assert.equal(tracker.state.ineffective,1)
 edits=inspectTextEdit(root,'agent.replace_text',{path:'file.txt',oldText:'A',newText:'B'})
 assert.equal(tracker.inspect(edits),undefined);fs.writeFileSync(file,'B');tracker.record(edits,false)
 assert.equal(tracker.state.ineffective,0)
 edits=inspectTextEdit(root,'agent.apply_patch',{changes:[{path:'file.txt',before:'B',after:'A'}]})
 assert.equal(tracker.inspect(edits),undefined);fs.writeFileSync(file,'A');tracker.record(edits,false)
 const restored=new EditProgress(JSON.parse(JSON.stringify(tracker.state)))
 assert.equal(restored.inspect(inspectTextEdit(root,'agent.write_file',{path:'file.txt',content:'B'})),'cycle')
 restored.state.ineffective=3
 restored.beginAttempt()
 assert.equal(restored.state.ineffective,0)
 assert.equal(restored.inspect(inspectTextEdit(root,'agent.write_file',{path:'file.txt',content:'B'})),'cycle','a new attempt retains prior file versions')
 fs.writeFileSync(file,'external edit')
 assert.equal(restored.inspect(inspectTextEdit(root,'agent.write_file',{path:'file.txt',content:'B'})),undefined)
})
test('missing and empty files differ; invalid patches and non-UTF8 inputs do not invent evidence',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-edit-input-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 assert.equal(new EditProgress().inspect(inspectTextEdit(root,'agent.write_file',{path:'new.txt',content:''})),undefined)
 fs.writeFileSync(path.join(root,'a.txt'),'a')
 assert.equal(inspectTextEdit(root,'agent.apply_patch',{changes:[{path:'a.txt',before:'b',after:'c'}]}),undefined)
 fs.writeFileSync(path.join(root,'binary.txt'),Buffer.from([255,254]))
 assert.equal(inspectTextEdit(root,'agent.write_file',{path:'binary.txt',content:'x'}),undefined)
})
