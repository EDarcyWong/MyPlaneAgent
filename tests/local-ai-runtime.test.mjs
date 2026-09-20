import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {gzipSync} from 'node:zlib'
import {Header} from 'tar'
import JSZip from 'jszip'
import {extractRuntimeArchive,runtimePackageFlavor,validRuntimeExecutable} from '../dist-electron/main/local-ai-runtime-package.js'
import {LocalAiRuntime} from '../dist-electron/main/local-ai-runtime.js'

function sandbox(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-runtime-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
function tarball(root,entries){
 const chunks=[]
 for(const entry of entries){
  const body=Buffer.from(entry.body||''),header=new Header({path:entry.path,type:entry.type||'File',mode:entry.mode??0o644,size:body.length,linkpath:entry.linkpath})
  header.encode();chunks.push(header.block,body,Buffer.alloc((512-body.length%512)%512))
 }
 const archive=path.join(root,'runtime.tar.gz');fs.writeFileSync(archive,gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)])));return archive
}
const signal=()=>new AbortController().signal

test('runtime packages match macOS and Windows architectures without offering source or foreign packages',()=>{
 for(const arch of ['arm64','x64']){
  assert.equal(runtimePackageFlavor(`llama-b123-bin-macos-${arch}.tar.gz`,'darwin',arch),'metal')
  for(const flavor of ['cpu','vulkan'])assert.equal(runtimePackageFlavor(`llama-b123-bin-win-${flavor}-${arch}.zip`,'win32',arch),flavor)
 }
 for(const [name,platform,arch] of [
  ['llama-b123-bin-macos-arm64.tar.gz','darwin','x64'],
  ['llama-b123-bin-macos-x64.tar.gz','darwin','arm64'],
  ['llama-b123-bin-win-cpu-arm64.zip','darwin','arm64'],
  ['llama-b123-bin-macos-arm64.tar.gz','win32','arm64'],
  ['llama-b123-bin-win-vulkan-x64.zip','win32','arm64'],
  ['llama-b123.tar.gz','darwin','arm64'],
  ['llama-b123-bin-macos-arm64.tar.gz','linux','arm64'],
  ['llama-b123-bin-macos-ia32.tar.gz','darwin','ia32']
 ])assert.equal(runtimePackageFlavor(name,platform,arch),undefined)
})

test('macOS extraction keeps dylib chains, nested layout and executable permissions', {skip:process.platform==='win32'},async t=>{
 const root=sandbox(t),directory=path.join(root,'contents')
 const archive=tarball(root,[
  {path:'./',type:'Directory'},
  {path:'llama/lib/libggml.dylib',type:'SymbolicLink',linkpath:'libggml.0.dylib'},
  {path:'llama/lib/libggml.0.dylib',type:'SymbolicLink',linkpath:'libggml.0.1.dylib'},
  {path:'llama/lib/libggml.0.1.dylib',body:'library'},
  {path:'llama/bin/llama-server',body:'#!/bin/sh\nexit 0\n',mode:0o4755},
  {path:'llama/bin/llama-cli',body:'cli',mode:0o755}
 ])
 assert.equal(await extractRuntimeArchive(archive,directory,'darwin',signal()),'llama/bin/llama-server')
 assert.equal(fs.readFileSync(path.join(directory,'llama/lib/libggml.dylib'),'utf8'),'library')
 assert.ok(fs.lstatSync(path.join(directory,'llama/lib/libggml.dylib')).isSymbolicLink())
 assert.equal(fs.statSync(path.join(directory,'llama/bin/llama-cli')).mode&0o7777,0o755)
 const binary=path.join(directory,'llama/bin/llama-server')
 assert.equal(fs.statSync(binary).mode&0o7777,0o755);assert.ok(validRuntimeExecutable(binary,'darwin'))
 fs.chmodSync(binary,0o644);assert.equal(validRuntimeExecutable(binary,'darwin'),false)
})

test('macOS archives reject unsafe paths, escaping links and special files',async t=>{
 const root=sandbox(t)
 const entries=[
  {path:'../outside'}, {path:'/absolute'}, {path:'folder/../../outside'},
  {path:'llama/link',type:'SymbolicLink',linkpath:'../../outside'},
  {path:'llama/link',type:'SymbolicLink',linkpath:'/tmp/outside'},
  {path:'llama/link',type:'Link',linkpath:'../outside'},
  {path:'llama/pipe',type:'FIFO'}
 ]
 for(const [i,entry] of entries.entries())await assert.rejects(extractRuntimeArchive(tarball(root,[entry]),path.join(root,`contents-${i}`),'darwin',signal()))
 const invalidLinks=[
  [{path:'llama/a',type:'SymbolicLink',linkpath:'b'},{path:'llama/b',type:'SymbolicLink',linkpath:'a'}],
  [{path:'llama/a',type:'SymbolicLink',linkpath:'missing'}],
  [{path:'llama/a',type:'Directory'},{path:'llama/b',type:'SymbolicLink',linkpath:'a'}],
  [{path:'llama/a',type:'SymbolicLink',linkpath:'target'},{path:'llama/a/child',body:'bad'},{path:'llama/target',body:'file'}],
  [{path:'llama/a',body:'first'},{path:'llama/A',body:'duplicate'}]
 ]
 for(const [i,entries] of invalidLinks.entries())await assert.rejects(extractRuntimeArchive(tarball(root,entries),path.join(root,`links-${i}`),'darwin',signal()))
})

test('archives require a server binary and honour cancellation',async t=>{
 const root=sandbox(t),archive=tarball(root,[{path:'llama/README',body:'source'}])
 await assert.rejects(extractRuntimeArchive(archive,path.join(root,'missing'),'darwin',signal()),/未找到 llama-server/)
 const controller=new AbortController();controller.abort()
 await assert.rejects(extractRuntimeArchive(archive,path.join(root,'cancelled'),'darwin',controller.signal),{name:'AbortError'})
 fs.writeFileSync(archive,Buffer.from('corrupt archive'))
 await assert.rejects(extractRuntimeArchive(archive,path.join(root,'corrupt'),'darwin',signal()))
})

test('Windows ZIP installation still preserves the server and DLL files',async t=>{
 const root=sandbox(t),zip=new JSZip(),archive=path.join(root,'runtime.zip'),directory=path.join(root,'contents')
 zip.file('release/llama-server.exe','exe');zip.file('release/ggml.dll','dll')
 fs.writeFileSync(archive,await zip.generateAsync({type:'nodebuffer'}))
 assert.equal(await extractRuntimeArchive(archive,directory,'win32',signal()),path.join('release','llama-server.exe'))
 assert.equal(fs.readFileSync(path.join(directory,'release/ggml.dll'),'utf8'),'dll')
 assert.ok(validRuntimeExecutable(path.join(directory,'release/llama-server.exe'),'win32'))
 const unsafe=new JSZip();unsafe.file('../outside','bad');fs.writeFileSync(archive,await unsafe.generateAsync({type:'nodebuffer'}))
 await assert.rejects(extractRuntimeArchive(archive,path.join(root,'unsafe'),'win32',signal()))
})

test('managed runtime starts a Unix executable in a path with spaces, checks readiness and stops', {skip:process.platform==='win32'},async t=>{
 const root=sandbox(t),directory=path.join(root,'runtime with spaces');fs.mkdirSync(directory)
 const binary=path.join(directory,'llama-server')
 fs.writeFileSync(binary,`#!${process.execPath}\nconst http=require('node:http');const args=process.argv.slice(2);const get=key=>args[args.indexOf(key)+1];if(get('--n-gpu-layers')!=='-1')process.exit(2);const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+process.env.LLAMA_API_KEY){res.writeHead(401);res.end();return}res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:get('--alias')}]}))});server.listen(Number(get('--port')),get('--host'));`,{mode:0o755})
 const runtime=new LocalAiRuntime();t.after(()=>runtime.dispose())
 const state=await runtime.start({runtimePath:binary,runtimePort:8088,contextLength:512,gpuLayers:-1,threads:1},{id:'test-model',exists:true,format:'GGUF',localPath:path.join(root,'model.gguf'),file:'model.gguf'})
 assert.equal(state.state,'starting')
 const deadline=Date.now()+6000
 while(runtime.snapshot().state==='starting'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30))
 assert.equal(runtime.snapshot().state,'running',JSON.stringify(runtime.snapshot()))
 assert.equal((await runtime.stop()).state,'stopped')
})
