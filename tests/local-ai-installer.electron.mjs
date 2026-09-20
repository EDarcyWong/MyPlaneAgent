import {app,net} from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {create} from 'tar'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-installer-test-'))
app.setPath('userData',root)
const originalFetch=net.fetch
let installer
async function completed(){
 const deadline=Date.now()+10000
 while(['downloading','extracting'].includes(installer.snapshot().status)){
  if(Date.now()>deadline)throw new Error('Installer timed out')
  await new Promise(resolve=>setTimeout(resolve,20))
 }
 return installer.snapshot()
}
async function main(){try{
 await app.whenReady()
 const installerModule=process.env.LOCAL_AI_APP_ASAR
  ?pathToFileURL(path.join(process.env.LOCAL_AI_APP_ASAR,'dist-electron/main/local-ai-installer.js')).href
  :new URL('../dist-electron/main/local-ai-installer.js',import.meta.url).href
 const {LocalAiInstaller}=await import(installerModule)
 if(process.platform!=='darwin')throw new Error('Run this macOS installer integration test on macOS')
 const input=path.join(root,'input'),archive=path.join(root,'runtime.tar.gz'),installed=path.join(root,'installed')
 fs.mkdirSync(path.join(input,'llama'),{recursive:true})
 fs.writeFileSync(path.join(input,'llama','llama-server'),'#!/bin/sh\nexit 0\n',{mode:0o755})
 fs.writeFileSync(path.join(input,'llama','libggml.1.dylib'),'library')
 fs.symlinkSync('libggml.1.dylib',path.join(input,'llama','libggml.dylib'))
 await create({cwd:input,file:archive,gzip:true},['llama'])
 const body=fs.readFileSync(archive),url='https://github.com/ggml-org/llama.cpp/releases/download/b123/runtime.tar.gz'
 const asset={id:123,name:`llama-b123-bin-macos-${process.arch}.tar.gz`,size:body.length,browser_download_url:url,digest:`sha256:${createHash('sha256').update(body).digest('hex')}`}
 let corrupt=false,stall=false,configured=''
 net.fetch=async(address,options)=>{
  if(String(address).startsWith('https://api.github.com/'))return new Response(JSON.stringify([{tag_name:'b123',assets:[asset,{...asset,id:124,name:'llama-b123-bin-win-cpu-x64.zip'}]}]))
  assert.equal(address,url)
  if(stall)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))
  return new Response(corrupt?Buffer.alloc(body.length):body)
 }
 installer=new LocalAiInstaller(installed,file=>{configured=file})
 const offers=await installer.packages();assert.equal(offers.length,1);assert.equal(offers[0].flavor,'metal')
 installer.install(offers[0].id)
 let state=await completed();assert.equal(state.status,'ready',state.error);assert.equal(state.verified,true)
 assert.equal(configured,state.path);assert.ok(installer.valid(configured))
 assert.ok(installer.detect('').some(row=>row.path===configured&&row.source==='MyPlane 安装'))
 assert.equal(fs.readFileSync(path.join(path.dirname(configured),'libggml.dylib'),'utf8'),'library')
 const manifest=fs.readFileSync(path.join(installed,'installed.json'),'utf8')
 corrupt=true;installer.install(offers[0].id);state=await completed()
 assert.equal(state.status,'error');assert.match(state.error,/SHA-256/)
 assert.equal(fs.readFileSync(path.join(installed,'installed.json'),'utf8'),manifest)
 stall=true;installer.install(offers[0].id);installer.cancel();state=await completed()
 assert.equal(state.status,'cancelled');assert.equal(fs.readdirSync(installed).some(name=>name.startsWith('install-')),false)
 console.log('PASS: macOS package selection, install, checksum, saved detection, dylib links, cancellation and cleanup')
}catch(error){console.error(error);process.exitCode=1}
finally{installer?.dispose();net.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true});app.exit(process.exitCode||0)}}
void main()
