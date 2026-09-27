import test from 'node:test'
import assert from 'node:assert/strict'
import {createTaskScope,scopeExcludes} from '../dist-electron/shared/task-scope.js'
import {enqueueReviewActions,nextReviewCheck,recoverReviewQueue,reviewActionAllowed} from '../dist-electron/main/agent/core/review-dispatch.js'
import {initImplementationStage,returnToImplementation,missingImplementation} from '../dist-electron/main/agent/core/implementation-stage.js'
const action=(capability='browser.read_page',args={})=>({title:'读取页面',capability,args,basis:'测试页面',required:true})
test('opening a project has bounded acceptance while explicit full testing remains in scope',()=>{
 const scope=createTaskScope('打开项目')
 assert.equal(scope.kind,'open-preview');assert.equal(scopeExcludes(scope,'index2.html 和性能 FPS 测试'),true)
 assert.equal(createTaskScope('打开项目并测试 index2.html 和所有按钮').kind,'general')
 assert.equal(reviewActionAllowed({...action('browser.open',{url:'http://localhost/index2.html'}),basis:'打开项目'},scope),false)
 assert.equal(reviewActionAllowed({...action('browser.read_page'),basis:'打开项目'},scope),true)
 assert.equal(reviewActionAllowed(action('agent.run_command',{command:'echo hi'}),createTaskScope('测试页面')),false)
 assert.equal(reviewActionAllowed({...action(),basis:'编造的要求'},createTaskScope('测试页面')),false)
})
test('queue saves independent checks, deduplicates successes and permits a new observation after a change',()=>{
 const queue={revision:0,checks:[]},scope=createTaskScope('测试页面')
 enqueueReviewActions(queue,[action()],scope)
 const first=nextReviewCheck(queue);first.status='complete';first.activityId='evidence'
 enqueueReviewActions(queue,[{...action(),title:'换个标题仍是相同读取'}],scope)
 assert.equal(nextReviewCheck(queue),undefined);assert.equal(queue.checks.length,1)
 queue.revision++
 enqueueReviewActions(queue,[action()],scope)
 assert.ok(nextReviewCheck(queue));assert.equal(queue.checks.length,2)
 const restored=JSON.parse(JSON.stringify(queue));recoverReviewQueue(restored)
 assert.equal(restored.checks[0].status,'complete');assert.equal(restored.checks[1].status,'failed')
})
test('actual failed checks are retried at most twice across persisted resumes',()=>{
 const queue={revision:0,checks:[]},scope=createTaskScope('测试页面')
 for(let attempt=1;attempt<=2;attempt++){
  enqueueReviewActions(queue,[action()],scope)
  const check=nextReviewCheck(queue);assert.equal(check.attempts,attempt);check.status='failed'
 }
 enqueueReviewActions(queue,[action()],scope);assert.equal(nextReviewCheck(queue),undefined)
 assert.equal(queue.checks[0].attempts,2)
 const click={...action('browser.click',{url:'http://localhost/',ref:1,snapshot:'old'}),title:'切换视角'}
 const interrupted={revision:0,checks:[]};enqueueReviewActions(interrupted,[click],scope);nextReviewCheck(interrupted);recoverReviewQueue(interrupted)
 enqueueReviewActions(interrupted,[{...click,args:{...click.args,snapshot:'new'}}],scope)
 assert.equal(nextReviewCheck(interrupted),undefined,'interrupted click cannot be replayed with a new snapshot')
})
test('optional checks never enter execution and queue size is bounded',()=>{
 const queue={revision:0,checks:[]}
 enqueueReviewActions(queue,[{...action(),required:false}]);assert.equal(queue.checks.length,0)
 for(let n=0;n<20;n++)enqueueReviewActions(queue,[action('agent.read_file',{path:n+'.txt'})])
 assert.equal(queue.checks.length,16)
})

test('pending legacy verification waits for implementation and source reads survive browser changes',()=>{
 const queue={revision:3,checks:[]}
 enqueueReviewActions(queue,[action('agent.read_file',{path:'src/exterior.js',startLine:114,endLine:200})])
 const read=nextReviewCheck(queue);read.status='complete'
 enqueueReviewActions(queue,[action()])
 initImplementationStage(queue,'为玻璃门添加花纹')
 assert.equal(queue.phase,'implement');assert.equal(queue.checks[1].status,'deferred');assert.equal(nextReviewCheck(queue),undefined)
 queue.phase='verify';queue.revision++
 enqueueReviewActions(queue,[action('agent.read_file',{path:'src/exterior.js',startLine:114,endLine:200})])
 assert.equal(nextReviewCheck(queue),undefined,'clicks must not expire source reads')
 queue.fileRevision=1
 enqueueReviewActions(queue,[action('agent.read_file',{path:'src/exterior.js',startLine:114,endLine:200})])
 assert.ok(nextReviewCheck(queue),'real code changes require new source evidence')
 returnToImplementation(queue);assert.equal(nextReviewCheck(queue),undefined)
 assert.equal(missingImplementation({missingEvidence:['src/exterior.js 中不存在任何玻璃门花纹实现']}),true)
})

test('invalid browser parameters never consume actual retries or block later valid checks',()=>{
 const queue={revision:0,checks:[]}
 enqueueReviewActions(queue,[action('browser.click',{label:'手动开门'})],undefined,()=>"required property 'snapshot'")
 assert.equal(queue.checks[0].status,'invalid');assert.equal(queue.checks[0].attempts,0);assert.equal(nextReviewCheck(queue),undefined)
 enqueueReviewActions(queue,[action('browser.click',{label:'手动开门',snapshot:'fresh',ref:1,url:'http://localhost/'})],undefined,()=>undefined)
 assert.ok(nextReviewCheck(queue))
 const old={revision:4,checks:[{...queue.checks[0],status:'failed',attempts:2,summary:'工具未执行，请修正参数后重试：missing snapshot'}]}
 recoverReviewQueue(old);assert.equal(old.checks[0].status,'invalid');assert.equal(old.checks[0].attempts,0)
})

test('pre-edit interaction success cannot certify the same interaction after a code change',()=>{
 const queue={revision:0,fileRevision:0,checks:[]}
 const click=action('browser.click',{url:'http://localhost/',snapshot:'before',ref:1,label:'开门'})
 enqueueReviewActions(queue,[click]);nextReviewCheck(queue).status='complete'
 queue.revision++
 enqueueReviewActions(queue,[{...click,args:{...click.args,snapshot:'another'}}]);assert.equal(nextReviewCheck(queue),undefined)
 queue.fileRevision++
 enqueueReviewActions(queue,[{...click,args:{...click.args,snapshot:'after-edit'}}]);assert.ok(nextReviewCheck(queue))
})
