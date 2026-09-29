import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import {verificationIssues,compareVerification} from '../dist-electron/main/agent/core/verification-baseline.js'

const workspace=path.join(os.tmpdir(),'baseline-analysis'),rule={kind:'diagnostics',checker:'typescript'}
const row=(data,passed=false)=>({rule,passed,summary:String(data.output||''),fingerprint:'fallback',...(passed?{issues:[],issuesComplete:true}:verificationIssues(rule,data,String(data.output||''),workspace))})
const baseline=results=>({createdAt:'2026-09-27',passed:results.every(result=>result.passed),results})

test('diagnostic identity survives line movement and unchanged issues stay existing',()=>{
 const before=row({diagnostics:[{path:'src/value.ts',line:2,column:1,message:'TS2322: incompatible type'}],truncated:false})
 const after=row({diagnostics:[{path:'./src/value.ts',line:80,column:5,message:'TS2322: incompatible type'}],truncated:false})
 const comparison=compareVerification(baseline([before]),[after],['src/value.ts'],workspace)
 assert.equal(comparison.failures[0].origin,'existing');assert.equal(comparison.failures[0].related,true)
 assert.equal(comparison.resolved.length,0)
})

test('passing baseline identifies new failures; later pass resolves the original issue',()=>{
 const failure=row({output:'src/value.ts(8,2): error TS2322: incompatible type'})
 assert.equal(compareVerification(baseline([row({},true)]),[failure],[],workspace).failures[0].origin,'new')
 assert.equal(compareVerification(baseline([failure]),[row({},true)],[],workspace).resolved.length,1)
 assert.equal(compareVerification(undefined,[failure],[],workspace).failures[0].origin,'unknown')
})

test('incomplete or blocked previous output cannot prove an error is new or resolved',()=>{
 const before=row({output:'not ok 1 - old assertion\nduration_ms: 123'})
 const after=row({output:'not ok 4 - different assertion\nduration_ms: 654'})
 const comparison=compareVerification(baseline([before]),[after],[],workspace)
 assert.equal(comparison.failures[0].origin,'unknown');assert.equal(comparison.resolved.length,0)
 const denied={...row({},true),passed:false,blocked:true}
 assert.equal(compareVerification(baseline([denied]),[after],[],workspace).failures[0].origin,'unknown')
 const parsed=row({diagnostics:[{path:'file.ts',message:'one recognizable error'}],truncated:false})
 assert.equal(parsed.issuesComplete,false,'a plugin diagnostic subset is not a complete failure inventory')
})

test('test names ignore TAP numbering and timing differences',()=>{
 const before=row({output:'not ok 1 - same assertion\nduration_ms: 123'})
 const after=row({output:'not ok 7 - same assertion\nduration_ms: 456'})
 assert.equal(before.issues[0].key,after.issues[0].key)
})

test('dependency and service failures include environment recovery advice',()=>{
 for(const output of ["Error: Cannot find package 'missing-library'",'Error: ECONNREFUSED 127.0.0.1:8080','Error: EADDRINUSE','command not found: npm']){
  const failure=row({output})
  assert.equal(failure.issues[0].category,'environment')
  assert.ok(failure.issues[0].advice)
  assert.equal(failure.issuesComplete,false)
 }
})

test('file acceptance directly associates an unmet condition with the current item',()=>{
 const fileRule={kind:'file',path:'index.html',contains:'hello'}
 const failure={rule:fileRule,passed:false,summary:'file condition failed',fingerprint:'file',...verificationIssues(fileRule,{},'file condition failed',workspace)}
 assert.equal(compareVerification(undefined,[failure],[],workspace).failures[0].related,true)
})
test('custom PASS/FAIL summary exposes individual failures and a complete inventory',()=>{
 const testRule={kind:'test',script:'test'}
 const text='=== 测试14：强度对比 ===\n  FAIL  困难档强于普通档 — 困难 14 : 普通 16\n=== 测试22：搜索 ===\n  FAIL  空盘迭代加深返回合法着法 — 无着法\n  FAIL  二次搜索命中置换表 — hits=0\n===== 汇总：78 通过 / 3 失败 ====='
 const parsed=verificationIssues(testRule,{output:text,truncated:false},text,workspace)
 assert.equal(parsed.issues.length,3)
 assert.equal(parsed.issuesComplete,true)
 assert.ok(parsed.issues.some(issue=>issue.message.includes('二次搜索命中置换表')))
 const incomplete=verificationIssues(testRule,{output:text,truncated:true},text,workspace)
 assert.equal(incomplete.issuesComplete,false)
 const oldSummary='===== 汇总：65 通过 / 1 失败 ====='
 const oldText='  FAIL  困难档强于普通档 — 困难 14 : 普通 16\n'+oldSummary
 const legacy={rule:testRule,passed:false,summary:'agent.run_test 退出码 1\n'+oldText,fingerprint:'legacy',issues:[{key:'legacy',category:'unknown',message:oldText}],issuesComplete:false}
 const current={rule:testRule,passed:false,summary:text,fingerprint:'current',...parsed}
 const comparison=compareVerification(baseline([legacy]),[current],[],workspace)
 assert.equal(comparison.failures.filter(failure=>failure.origin==='new').length,2)
 assert.equal(comparison.failures.filter(failure=>failure.origin==='existing').length,1)
})
test('direct test script links custom failures to a previously edited test file',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myplane-test-attribution-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node tests/gomoku.test.js'}}))
 const rule={kind:'test',script:'test'},output='  FAIL  空盘迭代加深返回合法着法 — 无着法\n===== 汇总：78 通过 / 1 失败 ====='
 const parsed=verificationIssues(rule,{output,truncated:false},output,root)
 const current={rule,passed:false,summary:output,fingerprint:'custom',...parsed}
 const comparison=compareVerification(undefined,[current],['tests/gomoku.test.js'],root)
 assert.equal(comparison.failures[0].origin,'unknown')
 assert.equal(comparison.failures[0].related,true)
})
