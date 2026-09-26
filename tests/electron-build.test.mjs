import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { runSandbox } from '../dist-electron/main/ability-modules/sandbox.js'

test('rebuilding keeps worker and preload available to the running application',async()=>{
  const worker=path.resolve('dist-electron/main/ability-modules/sandbox-worker.js')
  const preload=path.resolve('dist-electron/preload/index.cjs')
  const before=fs.statSync(worker).mtimeMs
  const child=spawn(process.execPath,['scripts/build-electron.mjs'],{stdio:['ignore','pipe','pipe']})
  let done=false, log=''
  child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk)
  const completion=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{done=true;resolve(code)})})
  let calls=0
  while(!done){
    assert.ok(fs.existsSync(worker));assert.ok(fs.existsSync(preload))
    const [result]=await runSandbox('function process(){return "available"}',[{messages:[]}])
    assert.equal(result.error,undefined);assert.equal(result.output,'available');calls++
    await new Promise(resolve=>setTimeout(resolve,30))
  }
  assert.equal(await completion,0,log);assert.ok(calls>0)
  assert.equal(fs.statSync(worker).mtimeMs,before,'unchanged worker is not replaced')
})
