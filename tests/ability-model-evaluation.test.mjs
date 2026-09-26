import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { AbilityModelEvaluation } from '../dist-electron/main/ability-modules/model-evaluation.js'
import { comparisonSnapshot } from '../dist-electron/main/ability-modules/comparison.js'
import { AbilityModuleManager } from '../dist-electron/main/ability-modules/manager.js'
import { stateContract } from '../dist-electron/main/ability-modules/contract.js'
import { selectionContract } from '../dist-electron/main/ability-modules/selection.js'
import { policyContracts } from '../dist-electron/main/ability-modules/policies.js'
async function fixture(t, responder) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ability-model-eval-')), requests=[]
  const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);res.setHeader('content-type','application/json');res.end(JSON.stringify(responder(body,requests.length-1)))})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>{server.closeAllConnections();server.close();fs.rmSync(root,{recursive:true,force:true})})
  return {root,requests,service:new AbilityModelEvaluation(root),connection:{endpoint:`http://127.0.0.1:${server.address().port}`,key:'secret-test-key',contextLength:32768,maxTokens:1024}}
}
const answer=(content,usage)=>({choices:[{message:{role:'assistant',content},finish_reason:'stop'}],...(usage?{usage}:{})})
test('paired benchmark runs actual pinned modules without mutating live stores or leaking grading keys',async t=>{
  const {root,requests,service,connection}=await fixture(t,()=>answer('{}'))
  const contracts=[stateContract,selectionContract,...policyContracts.filter(c=>['message-intent','task-planner','history-memory'].includes(c.id))]
  const managers=new Map(contracts.map(c=>[c.id,new AbilityModuleManager(path.join(root,'modules',c.id),undefined,c)]))
  t.after(()=>{for(const manager of managers.values())manager.dispose()})
  const snapshot=comparisonSnapshot(managers)
  const manager=managers.get('task-planner'), old=manager.version(manager.activeVersionId())
  const next=manager.saveVersion(old.id,old.code+'\n// next version','test pinning');await manager.activate(next.id)
  const before=[...managers.values()].map(m=>JSON.stringify(m.snapshot()))
  const report=await service.run('paired',connection,snapshot)
  assert.equal(report.cases.length,12)
  assert.equal(report.moduleVersions.find(v=>v.moduleId==='task-planner').versionId,old.id)
  assert.ok(report.cases.filter(c=>c.arm==='assisted').every(c=>c.trace.length===5))
  assert.deepEqual([...managers.values()].map(m=>JSON.stringify(m.snapshot())),before)
  assert.deepEqual(report.cases.slice(0,4).map(c=>c.arm),['raw','assisted','assisted','raw'])
  for(let i=0;i<12;i+=2){assert.deepEqual(requests[i].messages.slice(1),requests[i+1].messages.slice(1));assert.equal(requests[i].max_tokens,requests[i+1].max_tokens)}
  for(const req of requests){assert.ok(!req.messages[0].content.includes('"expected"'));assert.ok(!req.messages[0].content.includes('"publishB":false'))}
})
test('model benchmark uses six bounded tool-free calls and persists results and exact usage',async t=>{
  const expected=[{language:'en',maxWords:100,includeNames:false},{result:156},{steps:['read','count']},{complete:false,next:'request_permission'},{filename:'final.csv'},{publishB:false,keep:'A'}]
  const {root,requests,service,connection}=await fixture(t,(_,i)=>answer(JSON.stringify(expected[i]),{prompt_tokens:20,completion_tokens:10,total_tokens:30}))
  const report=await service.run('weak-test',connection)
  assert.equal(report.status,'complete');assert.equal(report.cases.length,6);assert.ok(report.cases.every(c=>c.passed&&c.usage.totalTokens===30))
  assert.ok(requests.every(r=>!r.tools&&r.max_tokens<=512&&r.temperature===0))
  assert.equal(new AbilityModelEvaluation(root).history()[0].id,report.id)
  assert.ok(!fs.readFileSync(path.join(root,report.id+'.json'),'utf8').includes('secret-test-key'))
})
test('bad JSON fails rather than self-scoring; absent usage stays unknown',async t=>{
  const {service,connection}=await fixture(t,()=>answer('我得了满分'))
  const report=await service.run('bad',connection)
  assert.ok(report.cases.every(c=>!c.passed&&c.error&&!c.usage))
})
test('cancellation preserves partial results, blocks overlaps and does not retry on restart',async t=>{
  const {root,service,connection}=await fixture(t,()=>{service.cancel();return answer('{}')})
  const running=service.run('cancel-test',connection)
  await assert.rejects(service.run('other',connection),/正在运行/)
  const report=await running
  assert.equal(report.status,'cancelled');assert.equal(report.cases.length,1)
  const interrupted={...report,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',status:'running'}
  fs.writeFileSync(path.join(root,interrupted.id+'.json'),JSON.stringify(interrupted))
  const restored=new AbilityModelEvaluation(root)
  assert.equal(restored.history().find(r=>r.id===interrupted.id).status,'interrupted')
})
