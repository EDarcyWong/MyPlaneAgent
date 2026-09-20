import {app} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'node:net'
import {LocalAiStudioService} from '../dist-electron/main/local-ai-studio.js'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-profiles-'))
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function run(){
 await app.whenReady()
 const service=new LocalAiStudioService(root)
 try{
  service.saveStudioSettings({endpoint:'https://first.example/v1',model:'first-model',apiKey:'secret-one'})
  const migrated=service.remoteProfiles();assert.equal(migrated.length,1);assert.equal(migrated[0].hasApiKey,true)
  const created=service.remoteProfileSave({name:'第二个服务',apiFormat:'anthropic',endpoint:'https://second.example/v1',model:'second-model',contextLength:65536,apiKey:'secret-two'})
  assert.equal(created.settings.endpoint,'https://second.example/v1');assert.equal(created.profiles.length,2)
  const second=created.profiles.find(profile=>profile.name==='第二个服务');assert.equal(second.apiFormat,'anthropic');assert.equal(second.contextLength,65536)
  const updated=service.remoteProfileSave({id:second.id,name:'第二个服务（已修改）',apiFormat:'openai',endpoint:'https://changed.example/v1',model:'changed-model',contextLength:32768})
  assert.equal(updated.profiles.length,2);assert.equal(updated.profiles.find(profile=>profile.id===second.id).name,'第二个服务（已修改）');assert.equal(updated.profiles.find(profile=>profile.id===second.id).model,'changed-model')
  const stored=fs.readFileSync(path.join(root,'local-ai-remote-profiles.json'),'utf8');assert.doesNotMatch(stored,/secret-one|secret-two/)
  const switched=service.remoteProfileUse(migrated[0].id);assert.equal(switched.settings.endpoint,'https://first.example/v1');assert.equal(switched.settings.model,'first-model');assert.equal(switched.settings.hasApiKey,true)
  const remaining=service.remoteProfileDelete(second.id);assert.equal(remaining.length,1)
  service.saveStudioSettings({runtimePort:await freePort()});await service.startApiServer();assert.equal(service.studioSettings().source,'managed')
  service.saveStudioSettings({source:'external'});assert.equal(service.studioSettings().source,'external');assert.equal(service.snapshot().runtime.endpoint.startsWith('http://127.0.0.1:'),true)
  service.saveStudioSettings({source:'managed'});assert.equal(service.studioSettings().source,'managed')
  console.log(JSON.stringify({ok:true,checks:['migrates current remote settings','stores protocol and context budget','updates a named profile without adding history','stores encrypted key references only','switches profiles','deletes history','switches inference source while local API keeps running']}))
 }finally{await service.dispose();app.exit(0)}
}
void run().catch(error=>{console.error(error);app.exit(1)})
