import test from 'node:test'
import assert from 'node:assert/strict'
import {visualReviewCard,validateVisualDecision,visualDecisionText} from '../dist-electron/shared/visual-review.js'
const hash='a'.repeat(64)
function fixture(){
 const item={id:'glass',title:'检查门头玻璃',acceptance:'正面视角下门头为玻璃墙',status:'blocked',outcome:'needs_input',evidenceIds:['shot'],attempts:1,summary:''}
 const shot={id:'shot',capability:'browser.screenshot',status:'complete',args:{},output:JSON.stringify({imageHash:hash,url:'http://127.0.0.1:1234/',capturedAt:'2026-09-27'}),images:[{name:'截图',dataUrl:'data:image/jpeg;base64,/9j/2Q=='}]}
 const messages=[{role:'assistant',toolActivity:[shot]}]
 return {item,shot,messages,plan:{items:[item]},decision:{itemId:'glass',activityId:'shot',imageHash:hash,decision:'accept'}}
}
test('legacy saved evidence becomes an offline visual card without parsing prose',()=>{
 const {item,messages}=fixture(),card=visualReviewCard(item,messages)
 assert.equal(card.canAccept,true);assert.match(card.image.dataUrl,/^data:/);assert.equal(card.question,item.acceptance)
})

test('unfinished implementation cannot be presented as a user visual approval',()=>{
 const f=fixture();f.item.reviewQueue={revision:0,checks:[],phase:'implement'}
 assert.equal(visualReviewCard(f.item,f.messages),undefined)
 f.item.reviewQueue.phase='verify';assert.ok(visualReviewCard(f.item,f.messages))
})

test('overall acceptance shows the saved thumbnail when review discovers a visual gap',()=>{
 const f=fixture()
 f.item.title='核对整体任务结果';f.item.acceptance='对照用户原始目标与约束核对所有步骤的实际结果，执行必要的集成验证'
 f.item.completionReview={status:'needs_input',reason:'需要用户确认',nextStep:'请用户查看已保存的截图',missingEvidence:['画面渲染正确性的视觉证据（需用户确认）','三个按钮的实际点击效果','性能验收证据']}
 const card=visualReviewCard(f.item,f.messages)
 assert.equal(card.image.dataUrl,f.shot.images[0].dataUrl)
 assert.equal(card.canAccept,true)
 assert.match(card.question,/画面渲染/)
 assert.deepEqual(validateVisualDecision(f.plan,f.messages,f.decision),f.decision)
 assert.equal(f.item.status,'blocked','confirming a picture must not complete remaining integration checks')
 f.item.completionReview={status:'needs_input',reason:'缺少测试配置',nextStep:'请提供测试脚本',missingEvidence:['测试脚本']}
 assert.equal(visualReviewCard(f.item,f.messages),undefined)
})
test('confirmation is bound to the active item and exact screenshot',()=>{
 const f=fixture()
 assert.deepEqual(validateVisualDecision(f.plan,f.messages,f.decision),f.decision)
 for(const changed of [{itemId:'other'},{activityId:'old'},{imageHash:'b'.repeat(64)},{decision:'complete'},{note:123}])assert.throws(()=>validateVisualDecision(f.plan,f.messages,{...f.decision,...changed}))
 f.plan.items.unshift({...f.item,id:'earlier',status:'pending'})
 assert.throws(()=>validateVisualDecision(f.plan,f.messages,f.decision),/任务已变化/)
})
test('missing or foreign screenshot cannot be confirmed but recapture is available',()=>{
 const f=fixture();f.item.evidenceIds=[]
 const card=visualReviewCard(f.item,f.messages);assert.equal(card.image,undefined);assert.equal(card.canAccept,false)
 const decision={...f.decision,activityId:'',imageHash:''}
 assert.throws(()=>validateVisualDecision(f.plan,f.messages,decision))
 assert.equal(validateVisualDecision(f.plan,f.messages,{...decision,decision:'recapture'}).decision,'recapture')
})
test('later page or file changes invalidate saved screenshots; reads do not',()=>{
 for(const capability of ['browser.click','browser.open','agent.write_file','agent.run_command']){
  const f=fixture();f.messages.push({role:'assistant',toolActivity:[{id:'changed',status:'complete',capability,args:{}}]})
  assert.equal(visualReviewCard(f.item,f.messages).stale,true)
  assert.throws(()=>validateVisualDecision(f.plan,f.messages,f.decision),/过期/)
 }
 const f=fixture();f.messages[0].toolActivity.push({id:'read',status:'complete',capability:'browser.read_page',args:{}})
 assert.equal(visualReviewCard(f.item,f.messages).canAccept,true)
})
test('saved response prevents duplicate acceptance after reload and permits new evidence',()=>{
 const f=fixture();f.item.visualResponses=[{...f.decision,createdAt:'now'}]
 const restored=JSON.parse(JSON.stringify(f))
 assert.equal(visualReviewCard(restored.item,restored.messages).responded,true)
 assert.throws(()=>validateVisualDecision(f.plan,f.messages,f.decision))
 assert.equal(validateVisualDecision(f.plan,f.messages,{...f.decision,decision:'recapture'}).decision,'recapture')
 f.item.evidenceIds.push('new');f.messages[0].toolActivity.push({...f.shot,id:'new'})
 assert.equal(visualReviewCard(f.item,f.messages).canAccept,true)
})
test('reject and recapture provide actionable instructions without accepting the item',()=>{
 const f=fixture()
 assert.match(visualDecisionText(f.item,{...f.decision,decision:'reject',note:'仍为实墙'}),/排查修复.*重新截图/)
 assert.match(visualDecisionText(f.item,{...f.decision,decision:'recapture'}),/暂不修改代码/)
 assert.match(visualDecisionText(f.item,f.decision),/核验其余条件/)
 assert.equal(f.item.status,'blocked')
})
