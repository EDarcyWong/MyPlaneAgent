import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {ApplicationLogger} from '../dist-electron/main/application-logger.js'

function sandbox(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-logger-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}

test('application logger persists structured entries and redacts credentials',t=>{
 const logger=new ApplicationLogger(sandbox(t))
 logger.info('app','started',{version:'1.0.0',apiKey:'sk-private'})
 logger.error('network','request failed',new Error('Authorization: Bearer secret-token'))
 logger.warn('network','credentials https://alice:plain-password@example.test/v1 sk-ant-api03-abcdefghijklmnop hf_abcdefghijklmnop')
 const text=fs.readFileSync(logger.filePath,'utf8')
 assert.match(text,/\[INFO\] \[app\] started/)
 assert.match(text,/\[ERROR\] \[network\] request failed/)
 assert.doesNotMatch(text,/sk-private|secret-token|alice|plain-password|sk-ant-api03|hf_abcdefghijklmnop/)
 assert.match(text,/\[REDACTED\]/)
 const entries=logger.entries()
 assert.equal(entries.length,3)
 assert.deepEqual(entries.map(entry=>entry.level),['INFO','ERROR','WARN'])
 logger.clear()
 assert.deepEqual(logger.entries(),[])
})

test('application logger rotates bounded files',t=>{
 const logger=new ApplicationLogger(sandbox(t),{maxBytes:1024,maxFiles:2})
 for(let index=0;index<12;index++)logger.info('rotation',`entry-${index}-${'x'.repeat(180)}`)
 assert.equal(fs.existsSync(logger.filePath),true)
 assert.equal(fs.existsSync(`${logger.filePath}.1`),true)
 assert.equal(fs.existsSync(`${logger.filePath}.3`),false)
})
