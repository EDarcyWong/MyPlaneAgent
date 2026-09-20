import {app,BrowserWindow} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:net'
import {randomUUID} from 'node:crypto'
import {LocalAiStudioService} from '../dist-electron/main/local-ai-studio.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-managed-vision-'))
app.setPath('userData',path.join(root,'profile'))
let service,win
async function until(check){const end=Date.now()+15000;while(!check()){if(Date.now()>end)throw new Error('Managed vision timed out');await new Promise(resolve=>setTimeout(resolve,50))}}
async function main(){try{
 await app.whenReady()
 const binary=path.join(root,'llama-server'),modelFile=path.join(root,'model.gguf'),projector=path.join(root,'mmproj-model.gguf'),received=path.join(root,'received.json')
 fs.writeFileSync(modelFile,'GGUF')
 fs.writeFileSync(binary,`#!/usr/bin/env node
const fs=require('node:fs'),http=require('node:http'),args=process.argv.slice(2),get=key=>args[args.indexOf(key)+1];
http.createServer(async(req,res)=>{
 if(req.headers.authorization!=='Bearer '+process.env.LLAMA_API_KEY){res.writeHead(401);res.end();return}
 res.setHeader('content-type','application/json');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:get('--alias')}]}));return}
 let text='';for await(const chunk of req)text+=chunk;
 const body=JSON.parse(text);fs.writeFileSync(${JSON.stringify(received)},JSON.stringify({body,projector:args.includes('--mmproj')?get('--mmproj'):null}));
 res.end(JSON.stringify({choices:[{message:{content:'Image received'}}]}));
}).listen(Number(get('--port')),get('--host'));
`,{mode:0o755})
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
 service=new LocalAiStudioService(path.join(root,'data'))
 service.saveStudioSettings({runtimePath:binary,runtimePort:port,source:'managed'})
 const model=service.importFiles([modelFile])[0]
 win=new BrowserWindow({show:false})
 await service.startRuntime(model.id);await until(()=>service.snapshot().runtime.state==='running')
 const session=service.newSession(),image={name:'test.png',dataUrl:'data:image/png;base64,aGVsbG8='}
 await assert.rejects(service.startChat({sessionId:session.id,requestId:randomUUID(),model:service.snapshot().runtime.modelName,text:'describe',images:[image]},win.webContents),/未加载视觉组件/)
 assert.equal(service.session(session.id).messages.length,0,'unavailable vision must not save or send a text-only substitute')
 assert.equal(fs.existsSync(received),false)
 await service.stopRuntime()
 fs.writeFileSync(projector,'GGUF')
 await service.startRuntime(model.id);await until(()=>service.snapshot().runtime.state==='running')
 await service.startChat({sessionId:session.id,requestId:randomUUID(),model:service.snapshot().runtime.modelName,text:'describe',images:[image]},win.webContents)
 await until(()=>service.session(session.id).messages.at(-1)?.role==='assistant')
 const request=JSON.parse(fs.readFileSync(received,'utf8'))
 assert.equal(fs.realpathSync(request.projector),fs.realpathSync(projector))
 assert.deepEqual(request.body.messages.at(-1).content,[{type:'text',text:'describe'},{type:'image_url',image_url:{url:image.dataUrl}}])
 assert.equal(service.session(session.id).messages[0].images[0].dataUrl,image.dataUrl)
 await service.stopRuntime()
 let enqueued=[]
 service.files=async()=>[{file:'model.gguf',format:'GGUF'},{file:'mmproj-model.gguf',format:'GGUF'},{file:'other/mmproj-other.gguf',format:'GGUF'}]
 service.downloads.enqueue=(_repo,files)=>{enqueued=files;return []}
 await service.enqueue({repoId:'test/model',file:'model.gguf'})
 assert.deepEqual(enqueued.map(item=>item.file),['model.gguf','mmproj-model.gguf'])
 console.log(JSON.stringify({ok:true,checks:['reject unavailable vision before saving','start with companion projector','preserve image through managed gateway and runtime','persist image conversation','download companion with model']}))
}catch(error){console.error(error);process.exitCode=1}
finally{if(win&&!win.isDestroyed())win.destroy();service?.dispose();app.exit(process.exitCode||0)}}
void main()
