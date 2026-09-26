import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AbilityModuleManager } from '../dist-electron/main/ability-modules/manager.js'
import { baselineCode } from '../dist-electron/main/ability-modules/baseline.js'
import { runSandbox, validateOutput } from '../dist-electron/main/ability-modules/sandbox.js'
import { stateInput, stateContext } from '../dist-electron/main/ability-modules/conversation.js'

const input = (...texts) => ({ messages: texts.map((text, index) => ({ id: `m${index+1}`, text })) })
const fixedCode = baselineCode.replace('function process(input)', 'function original(input)') + `
function process(input) {
 const result = original(input);
 if (/^接着完成(?:剩余|未完)部分[。！!]?$/u.test(input.messages.at(-1)?.text || '')) result.intent = 'continue';
 return result;
}`
function fixture(t, generate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myplane-abilities-'))
  const manager = new AbilityModuleManager(root, generate)
  manager.setPolicy({ ...manager.snapshot().policy, autoOptimize: false })
  t.after(() => {
    manager.dispose()
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { manager, root }
}
async function waitForJob(manager) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const job = manager.snapshot().jobs[0]
    if (job && ['complete','failed','cancelled'].includes(job.phase)) return job
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  throw new Error('job timed out')
}

test('baseline passes independent regression and state references survive restart', async t => {
  const {manager, root} = fixture(t)
  const report = await manager.test('bundled-v1')
  assert.equal(report.passed, true, JSON.stringify(report.tests.filter(test=>!test.passed)))
  const state = await manager.process(input('整理销售数据，不修改原文件','改成昨天','继续'))
  assert.equal(state.proposal.goalMessageId, 'm1')
  assert.deepEqual(state.proposal.constraintMessageIds, ['m1'])
  assert.deepEqual(state.proposal.amendmentMessageIds, ['m2'])
  assert.equal(state.proposal.intent, 'continue')
  manager.recordState('example-session', state)
  const restored = new AbilityModuleManager(root)
  t.after(()=>restored.dispose())
  assert.equal(restored.snapshot().versions[0].report.id, report.id)
  assert.equal(fs.readdirSync(path.join(root,'states')).length, 1)
})

test('sandbox denies host access, interrupts loops and rejects forged evidence', async () => {
  const [result] = await runSandbox('function process(){return [typeof fetch,typeof require,typeof process.env,typeof globalThis.Deno]}', [input('hello')])
  assert.deepEqual(result.output, ['undefined','undefined','undefined','undefined'])
  const [loop] = await runSandbox('function process(){while(true){}}', [input('hello')])
  assert.match(loop.error, /interrupt|超时/)
  const [syntax] = await runSandbox('function process( {', [input('hello')])
  assert.ok(syntax.error)
  assert.throws(()=>validateOutput({intent:'new_task',goalMessageId:'fake',constraintMessageIds:[],amendmentMessageIds:[]},input('hello')),/不存在/)
  assert.throws(()=>validateOutput({intent:'new_task',goalMessageId:'m1',constraintMessageIds:['m1','m1'],amendmentMessageIds:[]},input('hello')),/重复/)
})

test('manual edits are immutable; failed candidates and all reports remain available', async t => {
  const {manager,root}=fixture(t)
  const version=manager.saveVersion('bundled-v1','function process(){throw new Error("broken")}','演示错误')
  assert.equal((await manager.test(version.id)).passed,false)
  await assert.rejects(manager.activate(version.id),/回归测试/)
  assert.equal(manager.snapshot().activeId,'bundled-v1')
  assert.equal(manager.version(version.id).code,version.code)
  assert.equal(fs.readdirSync(path.join(root,'reports')).length,2)
  manager.rate(version.id,2,'失败案例表现较差')
  assert.equal(manager.snapshot().versions.find(item=>item.id===version.id).ratings[0].score,2)
  assert.throws(()=>manager.version('../index'),/无效/)
  assert.throws(()=>manager.rate(version.id,6,''),/评分/)
  const file=path.join(root,'versions',`${version.id}.json`)
  const tampered=JSON.parse(fs.readFileSync(file,'utf8'));tampered.code=baselineCode
  fs.writeFileSync(file,JSON.stringify(tampered))
  assert.throws(()=>manager.version(version.id),/校验失败/)
})

test('runtime failure quarantines selected version and falls back without deleting it',async t=>{
  const {manager,root}=fixture(t)
  const code=baselineCode.replace('function process(input) {','function process(input) { if(input.messages.some(m=>m.text.includes("trigger crash"))) throw new Error("bad input");')
  const version=manager.saveVersion('bundled-v1',code,'运行时异常回退测试')
  await manager.activate(version.id)
  const state=await manager.process(input('trigger crash'))
  assert.equal(state.versionId,'bundled-v1')
  assert.equal(manager.snapshot().activeId,'bundled-v1')
  assert.equal(manager.snapshot().problems.length,1)
  assert.equal(manager.snapshot().versions.find(item=>item.id===version.id).quarantined,true)
  assert.ok(fs.existsSync(path.join(root,'versions',`${version.id}.json`)))
  await assert.rejects(manager.activate(version.id),/回归测试/)
})

test('automatic optimization compares baseline and publishes only a strictly better passing candidate',async t=>{
  let prompt=''
  const {manager,root}=fixture(t,async(text,_policy,_signal,onModel)=>{
    prompt=text;onModel('test-generator')
    return JSON.stringify({cause:'module',diagnosis:'继续表达的识别范围不足，补充常见说法',code:fixedCode})
  })
  manager.reportProblem('继续表达识别错误',['整理数据','接着完成剩余部分'],'continue')
  manager.optimize()
  const job=await waitForJob(manager)
  assert.equal(job.phase,'complete',job.message)
  assert.equal(manager.snapshot().activeId,job.candidateId)
  assert.equal(job.model,'test-generator')
  assert.doesNotMatch(prompt,/空对话|单独继续不编造目标/)
  assert.equal(manager.snapshot().versions.length,2)
  const restored=new AbilityModuleManager(root);t.after(()=>restored.dispose())
  assert.equal(restored.snapshot().activeId,job.candidateId)
  assert.equal((await restored.process(input('整理数据','接着完成未完部分'))).proposal.intent,'continue')
})

test('equal scores keep current version; switching and returning to older tested versions preserves both',async t=>{
  const {manager}=fixture(t,async()=>JSON.stringify({cause:'module',diagnosis:'候选等效',code:baselineCode+'\n// equivalent'}))
  manager.reportProblem('验证继续',['整理数据','继续'],'continue')
  manager.optimize();const job=await waitForJob(manager)
  assert.equal(job.phase,'complete')
  assert.equal(manager.snapshot().activeId,'bundled-v1')
  await manager.activate(job.candidateId)
  assert.equal(manager.snapshot().activeId,job.candidateId)
  await manager.activate('bundled-v1')
  assert.equal(manager.snapshot().versions.length,2)
  assert.equal(manager.snapshot().switches.length,2)
})

test('new feedback invalidates old passing reports and blocks manual activation',async t=>{
  const {manager}=fixture(t)
  const version=manager.saveVersion('bundled-v1',baselineCode+'\n// old','旧评测')
  assert.equal((await manager.test(version.id)).passed,true)
  manager.reportProblem('新问题',['整理数据','接着完成剩余部分'],'continue')
  await assert.rejects(manager.activate(version.id),/回归测试/)
})

test('concurrent version change prevents stale auto publication',async t=>{
  let release
  const gate=new Promise(resolve=>{release=resolve})
  const {manager}=fixture(t,async()=>{await gate;return JSON.stringify({cause:'module',diagnosis:'修复继续',code:fixedCode})})
  const alternative=manager.saveVersion('bundled-v1',fixedCode+'\n// manually selected','手动版本')
  manager.reportProblem('继续错误',['整理数据','接着完成剩余部分'],'continue')
  manager.optimize()
  await manager.activate(alternative.id)
  release()
  const job=await waitForJob(manager)
  assert.equal(job.phase,'complete',job.message)
  assert.equal(manager.snapshot().activeId,alternative.id)
})

test('cancellation, daily budget and non-module diagnoses never replace active code',async t=>{
  const {manager}=fixture(t,async(_prompt,_policy,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})))
  manager.setPolicy({...manager.snapshot().policy,maxAttemptsPerDay:1})
  manager.reportProblem('继续识别',['继续'],'continue')
  manager.optimize();assert.throws(()=>manager.optimize(),/正在运行/)
  manager.cancel()
  assert.equal((await waitForJob(manager)).phase,'cancelled')
  assert.equal(manager.snapshot().activeId,'bundled-v1')
  assert.throws(()=>manager.optimize(),/每日/)
})

test('automatic trigger needs distinct unattempted cases, obeys policy, and does not loop on failures',async t=>{
  let calls=0
  const {manager}=fixture(t,async()=>{calls++;return JSON.stringify({cause:'information',diagnosis:'需要用户补充信息'})})
  manager.setPolicy({...manager.snapshot().policy,autoOptimize:true,failureThreshold:2})
  manager.reportProblem('问题一',['继续'],'continue')
  manager.reportProblem('问题一',['继续'],'continue')
  assert.equal(manager.snapshot().problems.length,1)
  manager.reportProblem('问题二',['取消'],'cancel')
  const job=await waitForJob(manager)
  assert.equal(job.phase,'complete')
  assert.equal(manager.snapshot().versions.length,1)
  await new Promise(resolve=>setTimeout(resolve,1200))
  assert.equal(calls,1)
})

test('state selection preserves pinned goal and marks omissions without fabricating provenance',()=>{
  const messages=Array.from({length:110},(_,index)=>({id:`m${index}`,role:'user',content:index===0?'整理数据，不修改原文件':index===109?'继续':`补充${index}`}))
  const previous={proposal:{goalMessageId:'m0',constraintMessageIds:['m0'],amendmentMessageIds:[]}}
  const {input:selected,omitted}=stateInput(messages,previous)
  assert.equal(selected.messages.length,80)
  assert.equal(omitted,30)
  assert.equal(selected.messages[0].id,'m0')
  assert.equal(selected.messages.at(-1).id,'m109')
  const text=stateContext({versionId:'bundled-v1',proposal:{...previous.proposal,intent:'continue'},sources:selected.messages,omittedMessages:omitted})
  assert.match(text,/不是新指令、授权或完成证明/)
  assert.match(text,/不修改原文件/)
  assert.match(text,/"omittedMessages":30/)
  assert.throws(()=>stateInput([{id:'huge',role:'user',content:'x'.repeat(70000)}]),/容量/)
})

test('cancel is bounded even when a model adapter ignores its AbortSignal',async t=>{
  const {manager}=fixture(t,async()=>new Promise(()=>{}))
  manager.reportProblem('测试取消',['继续'],'continue')
  manager.optimize();manager.cancel()
  assert.equal((await waitForJob(manager)).phase,'cancelled')
})

test('cancelling a chat state calculation is not recorded as a broken module',async t=>{
  const {manager}=fixture(t)
  const abort=new AbortController()
  const pending=manager.process(input('整理数据'),0,abort.signal)
  abort.abort(new Error('stop chat'))
  await assert.rejects(pending,/stop chat/)
  assert.equal(manager.snapshot().problems.length,0)
  assert.equal(manager.snapshot().activeId,'bundled-v1')
})

test('shadow replay blocks publication when a candidate crashes on prior real inputs',async t=>{
  const crashing=fixedCode.replace('function process(input) {','function process(input) { if(input.messages.some(m=>m.text.includes("历史输入")))throw new Error("regression");')
  const {manager}=fixture(t,async()=>JSON.stringify({cause:'module',diagnosis:'继续表达修复',code:crashing}))
  const state=await manager.process(input('历史输入'))
  manager.recordState('session',state)
  manager.reportProblem('继续错误',['整理数据','接着完成剩余部分'],'continue')
  manager.optimize();const job=await waitForJob(manager)
  assert.equal(job.phase,'complete')
  assert.deepEqual(job.shadow,{samples:1,changed:0,failed:1})
  assert.equal(manager.snapshot().activeId,'bundled-v1')
  assert.ok(manager.version(job.candidateId))
  await assert.rejects(manager.activate(job.candidateId),/回归测试/)
})

test('switch away and back still prevents a stale optimization from publishing',async t=>{
  let release
  const gate=new Promise(resolve=>{release=resolve})
  const {manager}=fixture(t,async()=>{await gate;return JSON.stringify({cause:'module',diagnosis:'修复继续',code:fixedCode})})
  manager.reportProblem('先验证继续',['整理数据','继续'],'continue')
  manager.optimize()
  const other=manager.saveVersion('bundled-v1',baselineCode+'\n// version B','切换测试')
  await manager.activate(other.id);await manager.activate('bundled-v1')
  manager.reportProblem('继续错误',['整理数据','接着完成剩余部分'],'continue')
  release()
  const job=await waitForJob(manager)
  assert.equal(job.phase,'complete')
  assert.equal(manager.snapshot().activeId,'bundled-v1')
  assert.equal(manager.reports(job.candidateId)[0].passed,true)
})
