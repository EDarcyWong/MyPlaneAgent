import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {scanModelDirectory,mergeScannedModels} from '../dist-electron/main/local-ai-model-library.js'

test('library scan discovers nested model files, ignores partial downloads and refreshes changed files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'myplane-library-'))
 t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const nested=path.join(root,'publisher','model');await fs.mkdir(nested,{recursive:true})
 await Promise.all(['model-Q4_K_M.GGUF','weights.safetensors','model.gguf.part','README.md'].map(file=>fs.writeFile(path.join(nested,file),'test')))
 const found=await scanModelDirectory(root)
 assert.deepEqual(found.map(item=>item.file).sort(),['model-Q4_K_M.GGUF','weights.safetensors'])
 const previous={...found[0],id:'download-id',repoId:'publisher/model',downloadedAt:'2026-01-01'}
 const outside={...found[1],id:'import-id',localPath:path.join(root,'elsewhere.gguf')}
 await fs.writeFile(found[0].localPath,'changed weights')
 const merged=mergeScannedModels([previous,outside],await scanModelDirectory(root))
 assert.equal(merged.length,3)
 assert.deepEqual(merged[0],{...previous,size:15})
 assert.deepEqual(merged[1],outside)
 assert.deepEqual(mergeScannedModels(merged,await scanModelDirectory(root)),merged)
 await fs.unlink(found[0].localPath)
 assert.ok(mergeScannedModels(merged,await scanModelDirectory(root)).some(item=>item.id==='download-id'),'missing records are retained for the missing-files filter')
 assert.deepEqual(await scanModelDirectory(path.join(root,'missing')),[])
})

test('library scan does not follow directory junctions or recurse in a loop',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'myplane-library-'))
 t.after(()=>fs.rm(root,{recursive:true,force:true}))
 await fs.writeFile(path.join(root,'model.gguf'),'test')
 await fs.symlink(root,path.join(root,'loop'),process.platform==='win32'?'junction':'dir')
 assert.equal((await scanModelDirectory(root)).length,1)
})
