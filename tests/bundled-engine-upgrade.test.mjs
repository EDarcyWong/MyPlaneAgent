import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {upgradeBundledEngine} from '../dist-electron/main/agent/core/bundled-engine-upgrade.js'
test('engine upgrades archive original bytes, preserve custom engines and avoid repeated replacements',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-engine-upgrade-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const source=path.join(root,'next.py'),destination=path.join(root,'engine.py'),history=path.join(root,'archive')
 const old='old engine\r\n',next='new engine\n',known=new Set([createHash('sha256').update(old.replace(/\r\n/g,'\n')).digest('hex')])
 fs.writeFileSync(source,next);fs.writeFileSync(destination,old)
 assert.equal(upgradeBundledEngine(source,destination,history,known),true)
 assert.equal(fs.readFileSync(destination,'utf8'),next)
 assert.equal(fs.readFileSync(path.join(history,fs.readdirSync(history)[0]),'utf8'),old)
 assert.equal(upgradeBundledEngine(source,destination,history,known),false)
 fs.writeFileSync(destination,'custom engine')
 assert.equal(upgradeBundledEngine(source,destination,history,known),false)
 assert.equal(fs.readFileSync(destination,'utf8'),'custom engine')
})
