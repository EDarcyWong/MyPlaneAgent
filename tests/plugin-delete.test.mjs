import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,cpSync,existsSync,renameSync,rmSync} from 'node:fs'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {SkillPlatform} from '../dist-electron/main/agent/core/skill-platform.js'
import {CapabilityRegistry} from '../dist-electron/main/agent/core/capability-registry.js'
test('plugin deletion stops runtime, removes capabilities and rolls back failed removal',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'myplane-delete-')),directory=path.join(root,'skills'),plugin=path.join(directory,'file-operations')
 mkdirSync(directory);cpSync(path.resolve('skills/file-operations'),plugin,{recursive:true})
 let stopped=0,release
 const runtime={stopWorker:async()=>{stopped++},execute:async()=>{await new Promise(resolve=>{release=resolve});return {output:'ok'}}}
 const platform=new SkillPlatform(directory,runtime),registry=new CapabilityRegistry(platform)
 try{
  await platform.initialize();await registry.initialize()
  const running=platform.executeTool('file-operations','read',{path:'a.txt'},new AbortController().signal)
  await assert.rejects(platform.uninstall('file-operations'),/正在执行/)
  while(!release)await new Promise(resolve=>setTimeout(resolve,0))
  release();await running
  await assert.rejects(platform.uninstall('file-operations',async()=>{throw Error('trash failed')}),/trash failed/)
  assert.equal(platform.get('file-operations').enabled,true);assert.ok(existsSync(plugin))
  await platform.uninstall('file-operations',async target=>renameSync(target,path.join(root,'trash')))
  await registry.reload();assert.equal(platform.get('file-operations'),undefined);assert.equal(registry.list().length,0)
  assert.ok(stopped>=2);assert.equal(existsSync(plugin),false);assert.ok(existsSync(path.join(root,'trash','skill.json')))
 }finally{rmSync(root,{recursive:true,force:true})}
})
