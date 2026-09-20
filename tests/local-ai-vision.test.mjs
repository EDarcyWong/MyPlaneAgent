import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {findVisionProjector} from '../dist-electron/main/local-ai-vision.js'
import {LocalAiRuntime} from '../dist-electron/main/local-ai-runtime.js'

function sandbox(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-vision-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
test('vision pairing uses a companion in the model directory and rejects ambiguous or standalone projectors',t=>{
 const root=sandbox(t),model=path.join(root,'model.gguf'),projector=path.join(root,'mmproj-model-f16.gguf')
 assert.equal(findVisionProjector(model),undefined)
 fs.writeFileSync(projector,'GGUF')
 assert.equal(findVisionProjector(model),projector)
 assert.throws(()=>findVisionProjector(projector),/不能单独运行/)
 fs.writeFileSync(path.join(root,'mmproj-other.gguf'),'GGUF')
 assert.throws(()=>findVisionProjector(model),/多个视觉组件/)
})
test('managed runtime passes the real projector path to the server and reports vision availability',{skip:process.platform==='win32'},async t=>{
 const root=sandbox(t),binary=path.join(root,'llama-server'),projector=path.join(root,'mmproj-model-f16.gguf')
 fs.writeFileSync(projector,'GGUF')
 fs.writeFileSync(binary,`#!${process.execPath}\nconst fs=require('node:fs'),http=require('node:http');const args=process.argv.slice(2),get=key=>args[args.indexOf(key)+1];if(!args.includes('--mmproj')||fs.readFileSync(get('--mmproj'),'utf8')!=='GGUF')process.exit(2);http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:get('--alias')}]}))}).listen(Number(get('--port')),get('--host'));`,{mode:0o755})
 const runtime=new LocalAiRuntime();t.after(()=>runtime.dispose())
 await runtime.start({runtimePath:binary,runtimePort:8088,contextLength:512,gpuLayers:0,threads:1},{id:'vision-model',exists:true,format:'GGUF',localPath:path.join(root,'model.gguf'),file:'model.gguf'})
 const deadline=Date.now()+6000
 while(runtime.snapshot().state==='starting'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30))
 assert.equal(runtime.snapshot().state,'running',JSON.stringify(runtime.snapshot()))
 assert.equal(runtime.snapshot().vision,true)
 await runtime.stop()
})
