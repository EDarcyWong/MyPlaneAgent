import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {sseData,modelFile,repoId,inside,formatModel} from '../dist-electron/main/local-ai-utils.js'
import {LocalAiDownloads} from '../dist-electron/main/local-ai-downloads.js'

const revision='a'.repeat(40)
const sha=value=>createHash('sha256').update(value).digest('hex')
async function until(check){const deadline=Date.now()+4000;while(!check()){if(Date.now()>deadline)throw new Error('Timed out waiting for download');await new Promise(resolve=>setTimeout(resolve,10))}}
function sandbox(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-local-ai-test-'));t.after(()=>{assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'myplane-local-ai-test-')));fs.rmSync(root,{recursive:true,force:true})});return root}
function mockFetch(t,handler){const original=globalThis.fetch;globalThis.fetch=handler;t.after(()=>{globalThis.fetch=original})}

test('SSE preserves split UTF-8, CRLF frames, comments, and multiline data',async()=>{
 const input=new TextEncoder().encode(': heartbeat\r\ndata: {"text":"你好"}\r\n\r\ndata: line one\ndata: line two\n\ndata: [DONE]\n\n')
 const body=new ReadableStream({start(controller){for(const byte of input)controller.enqueue(Uint8Array.of(byte));controller.close()}})
 const output=[];for await(const data of sseData(body))output.push(data)
 assert.deepEqual(output,['{"text":"你好"}','line one\nline two','[DONE]'])
})
test('SSE flushes a final frame and releases a cancelled reader',async()=>{
 const controller=new AbortController();const body=new ReadableStream({start(stream){stream.enqueue(new TextEncoder().encode('data: last'));stream.close()}})
 assert.deepEqual(await Array.fromAsync(sseData(body)),['last']);assert.equal(body.locked,false)
 controller.abort();const cancelled=new ReadableStream({start(stream){stream.close()}})
 await assert.rejects(async()=>{for await(const _ of sseData(cancelled,controller.signal)){}},{name:'AbortError'});assert.equal(cancelled.locked,false)
})
test('model paths reject traversal, Windows devices and stream syntax',()=>{
 for(const name of ['../secret','C:/file.gguf','sub/../../x','sub\\x','con.gguf','file.gguf:stream','folder./x'])assert.throws(()=>modelFile(name))
 assert.equal(modelFile('weights/model-Q4_K_M.gguf'),'weights/model-Q4_K_M.gguf')
 assert.throws(()=>repoId('org/../other'));assert.throws(()=>inside('C:\\models','../private'))
 assert.equal(formatModel('model-Q4_K_M.gguf').quantization,'Q4_K_M')
})
test('resumes a persisted partial download using immutable revision and validates SHA-256',async t=>{
 const root=sandbox(t),target=path.join(root,'models','weights','model.gguf'),file=path.join(root,'queue.json'),body=Buffer.from('GGUF-resumable-content'),id='resume-test'
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(`${target}.${id}.part`,body.subarray(0,6));fs.writeFileSync(file,JSON.stringify([{id,repoId:'org/model',file:'weights/model.gguf',revision,sha256:sha(body),target,status:'downloading',received:6,total:body.length,speed:0,error:'',createdAt:new Date().toISOString()}]))
 mockFetch(t,async(url,options)=>{assert.ok(url.includes(`/resolve/${revision}/weights/model.gguf`));assert.equal(options.headers.Range,'bytes=6-');return new Response(body.subarray(6),{status:206,headers:{'content-range':`bytes 6-${body.length-1}/${body.length}`,'content-length':String(body.length-6)}})})
 const completed=[],queue=new LocalAiDownloads(file,()=>path.join(root,'models'),()=>({}),entry=>completed.push(entry));t.after(()=>queue.dispose())
 assert.equal(queue.list()[0].status,'paused');queue.action(id,'resume');await until(()=>queue.list()[0].status==='completed')
 assert.deepEqual(fs.readFileSync(target),body);assert.equal(completed[0].id,id);assert.equal(fs.existsSync(`${target}.${id}.part`),false)
})
test('a server ignoring Range restarts the file instead of corrupting it',async t=>{
 const root=sandbox(t),target=path.join(root,'model.gguf'),file=path.join(root,'queue.json'),body=Buffer.from('GGUF-full-content'),id='restart-test'
 fs.writeFileSync(`${target}.${id}.part`,'old bytes');fs.writeFileSync(file,JSON.stringify([{id,repoId:'org/model',file:'model.gguf',revision,sha256:sha(body),target,status:'paused',received:9,total:body.length,speed:0,error:'',createdAt:new Date().toISOString()}]))
 mockFetch(t,async()=>new Response(body,{headers:{'content-length':String(body.length)}}))
 const queue=new LocalAiDownloads(file,()=>root,()=>({}),()=>{});t.after(()=>queue.dispose());queue.action(id,'resume');await until(()=>queue.list()[0].status==='completed');assert.deepEqual(fs.readFileSync(target),body)
})
test('split model files share a directory and completed IDs stay stable',async t=>{
 const root=sandbox(t),body=Buffer.from('GGUF-test'),completed=[]
 mockFetch(t,async()=>new Response(body,{headers:{'content-length':String(body.length)}}))
 const queue=new LocalAiDownloads(path.join(root,'queue.json'),()=>path.join(root,'models'),()=>({}),entry=>completed.push(entry));t.after(()=>queue.dispose())
 queue.enqueue('org/model',[1,2].map(index=>({file:`model-0000${index}-of-00002.gguf`,size:body.length,type:'file',format:'GGUF',quantization:'',revision,sha256:sha(body)})))
 await until(()=>queue.list().every(row=>row.status==='completed'));assert.equal(completed.length,2);assert.equal(path.dirname(completed[0].localPath),path.dirname(completed[1].localPath));assert.equal(completed[0].id,queue.list()[0].id)
})
test('failed checksum never registers a model and a retry can recover',async t=>{
 const root=sandbox(t),body=Buffer.from('GGUF-correct'),completed=[];let corrupted=true
 mockFetch(t,async()=>new Response(corrupted?Buffer.from('GGUF-corrupt'):body))
 const queue=new LocalAiDownloads(path.join(root,'queue.json'),()=>path.join(root,'models'),()=>({}),entry=>completed.push(entry));t.after(()=>queue.dispose())
 const row=queue.enqueue('org/model',[{file:'model.gguf',size:body.length,type:'file',format:'GGUF',quantization:'',revision,sha256:sha(body)}])[0]
 await until(()=>queue.list()[0].status==='failed');assert.equal(completed.length,0);assert.equal(fs.existsSync(row.target),false);corrupted=false;queue.action(row.id,'resume');await until(()=>queue.list()[0].status==='completed');assert.equal(completed.length,1)
})
test('a fully received file interrupted before verification resumes without an invalid Range request',async t=>{
 const root=sandbox(t),target=path.join(root,'model.gguf'),file=path.join(root,'queue.json'),body=Buffer.from('GGUF-complete'),id='verify-test'
 fs.writeFileSync(`${target}.${id}.part`,body);fs.writeFileSync(file,JSON.stringify([{id,repoId:'org/model',file:'model.gguf',revision,sha256:sha(body),target,status:'verifying',received:body.length,total:body.length,speed:0,error:'',createdAt:new Date().toISOString()}]))
 mockFetch(t,async()=>{assert.fail('A complete partial file must not be downloaded again')})
 const completed=[],queue=new LocalAiDownloads(file,()=>root,()=>({}),entry=>completed.push(entry));t.after(()=>queue.dispose());queue.action(id,'resume');await until(()=>queue.list()[0].status==='completed');assert.deepEqual(fs.readFileSync(target),body);assert.equal(completed.length,1)
})
