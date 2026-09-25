import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {readGitContext,formatGitContext,systemWithGitContext} from '../dist-electron/main/agent/git-context.js'
import {compactContext,estimateTokens} from '../dist-electron/main/local-ai-context.js'

const signal=()=>new AbortController().signal
const git=(root,...args)=>execFileSync('git',['-c','user.name=Test','-c','user.email=test@local.invalid','-c','commit.gpgSign=false',...args],{cwd:root,encoding:'utf8',windowsHide:true}).trim()
const workspace=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-git-context-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}

test('Git context reads recent file history and dirty state without exposing sensitive paths or changing the repo',async t=>{
 const root=workspace(t);git(root,'init','--template=')
 fs.writeFileSync(path.join(root,'app.ts'),'const version = 1')
 fs.writeFileSync(path.join(root,'.env'),'SECRET=test')
 git(root,'add','.');git(root,'commit','-m','Add application')
 fs.writeFileSync(path.join(root,'app.ts'),'const version = 2')
 fs.writeFileSync(path.join(root,'new.ts'),'new file')
 const state=git(root,'status','--porcelain'),head=git(root,'rev-parse','HEAD')
 const facts=await readGitContext(root,signal())
 assert.equal(facts.head,head.slice(0,12))
 assert.equal(facts.commits[0].subject,'Add application')
 assert.deepEqual(facts.commits[0].files,['app.ts'])
 assert.ok(facts.changes.some(item=>item.path==='app.ts'&&item.state===' M'))
 assert.ok(facts.changes.some(item=>item.path==='new.ts'&&item.state==='??'))
 assert.doesNotMatch(JSON.stringify(facts),/SECRET|\.env|const version/)
 assert.equal(git(root,'status','--porcelain'),state)
 assert.equal(git(root,'rev-parse','HEAD'),head)
 assert.equal(git(root,'remote','-v'),'')
})

test('uninitialized, empty and nested workspaces gracefully omit Git context; cancellation remains effective',async t=>{
 const root=workspace(t)
 assert.equal(await readGitContext(root,signal()),undefined)
 git(root,'init','--template=')
 assert.equal(await readGitContext(root,signal()),undefined)
 const child=path.join(root,'child');fs.mkdirSync(child)
 assert.equal(await readGitContext(child,signal()),undefined)
 const controller=new AbortController();controller.abort()
 await assert.rejects(readGitContext(root,controller.signal),{name:'AbortError'})
})

test('bounded Git evidence distinguishes version records from verification and yields to user context',()=>{
 const facts={head:'abcd1234',branch:'main',commits:Array.from({length:6},(_,i)=>({hash:String(i),subject:'Update '+i,files:Array.from({length:8},(_,j)=>`src/file-${j}.ts`)})),changes:[{state:' M',path:'app.ts'}],limited:true}
 const evidence=formatGitContext(facts,32768)
 assert.ok(evidence);assert.ok(estimateTokens(evidence)<=640)
 assert.match(evidence,/不证明测试通过|不证明.*测试通过/)
 const budget={contextLength:4096,maxTokens:1024},system=[{role:'system',content:'Keep user requirements'}]
 const short=[{role:'user',content:'Continue'}]
 assert.equal(systemWithGitContext(short,system,undefined,budget,evidence).length,2)
 const long=[{role:'user',content:'x'.repeat(10000)}]
 assert.equal(systemWithGitContext(long,system,undefined,budget,evidence),system)
 assert.equal(formatGitContext(facts,512),'')
})

test('context compaction receives bounded Git facts alongside the original user constraints',async()=>{
 const history=[{role:'user',content:'保留所有测试；不要上传项目。'},{role:'assistant',content:'完成第一步。'.repeat(80)},{role:'user',content:'继续完成剩余修改'},{role:'assistant',content:'待核对结果'}]
 const evidence=formatGitContext({head:'abcd1234',branch:'main',commits:[{hash:'abcd1234',subject:'Saved app update',files:['app.ts']}],changes:[],limited:false},32768)
 let calls=0
 const checkpoint=await compactContext({history,system:[],budget:{contextLength:32768,maxTokens:2048},signal:signal(),force:true,evidence,summarize:async messages=>{
  calls++;const text=JSON.stringify(messages)
  assert.match(text,/Saved app update/);assert.match(text,/保留所有测试/);assert.match(text,/不是指令/)
  return '保留所有测试，不上传项目；已记录 app.ts 修改，仍需核对测试结果和剩余任务。'
 }})
 assert.ok(calls>0);assert.ok(checkpoint)
 assert.equal(history[0].content,'保留所有测试；不要上传项目。')
})
