// Opt-in integration check with an installed model and its companion mmproj.
import {app,nativeImage} from 'electron'
import {EventEmitter} from 'node:events'
import {createServer} from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {LocalAiStudioService} from '../dist-electron/main/local-ai-studio.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-real-vision-'))
app.setPath('userData',path.join(root,'profile'))
let service
async function main(){try{
 await app.whenReady()
 const modelPath=process.env.MYPLANE_REAL_VISION_MODEL,runtimePath=process.env.MYPLANE_REAL_VISION_RUNTIME
 if(!modelPath||!runtimePath)throw new Error('Set MYPLANE_REAL_VISION_MODEL and MYPLANE_REAL_VISION_RUNTIME')
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
 service=new LocalAiStudioService(path.join(root,'data'))
 service.saveStudioSettings({source:'managed',runtimePath,runtimePort:port,gpuLayers:-1,contextLength:4096,threads:8,maxTokens:1024,temperature:0})
 const model=service.importFiles([modelPath])[0]
 await service.startRuntime(model.id)
 const deadline=Date.now()+300000
 while(service.snapshot().runtime.state==='starting'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,500))
 const runtime=service.snapshot().runtime
 assert.equal(runtime.state,'running',runtime.error+'\n'+runtime.logs.slice(-20).join('\n'))
 assert.equal(runtime.vision,true)
 console.log('Real model loaded with vision projector')
 const sender=new EventEmitter();sender.id=99991;sender.isDestroyed=()=>false;sender.send=(_channel,event)=>sender.emit('studio-event',event)
 for(const [expected,channel] of [['red',2],['blue',0]]){
  const pixels=Buffer.alloc(224*224*4);for(let i=0;i<pixels.length;i+=4){pixels[i+channel]=255;pixels[i+3]=255}
  const image={name:'color.png',dataUrl:nativeImage.createFromBitmap(pixels,{width:224,height:224}).toDataURL()}
  const session=service.newSession(),requestId=randomUUID()
  service.updateSession({id:session.id,systemPrompt:'Identify the main color in the supplied image. Answer directly with one English color word only. Do not explain.'})
  const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Image inference timed out')),180000);const listener=event=>{if(event.requestId===requestId&&event.type==='finished'){clearTimeout(timer);sender.off('studio-event',listener);resolve(event)}};sender.on('studio-event',listener)})
  await service.startChat({sessionId:session.id,requestId,model:runtime.modelName,text:'What is the main color of the image?',images:[image]},sender)
  const event=await result
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(event.error,undefined)
  const answer=event.session.messages.at(-1).content.trim()
  console.log(JSON.stringify({expected,answer}))
  assert.match(answer,new RegExp(`\\b${expected}\\b`,'i'))
 }
 console.log(JSON.stringify({ok:true,checks:['real model loads vision projector','red image recognized','blue image recognized'],artifacts:root}))
}catch(error){console.error(error);process.exitCode=1}
finally{if(service){await service.stopRuntime().catch(()=>{});service.dispose()}app.exit(process.exitCode||0)}}
void main()
