import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyTaskRelation,legacyProjectOverviewBoundary,legacyWeatherIdentityBoundary,ordinaryConversationMessage,parseTaskRelation,projectOverviewQuestion,socialConversationMessage,taskRelationShortcut} from '../dist-electron/main/ability-modules/task-relation.js'
import {routerBaseline,validateRouterOutput} from '../dist-electron/main/ability-modules/routing.js'
import {chatCapabilityAllowed} from '../dist-electron/main/agent/core/chat-runner.js'

test('a personal question after weather starts a separate topic',async()=>{
 let called=false
 const relation=await classifyTaskRelation({goal:'明天北京天气怎么样',latest:'who i am',recent:['北京明天有雨']},async()=>{called=true;return '{"relation":"same"}'})
 assert.equal(relation,'new')
 assert.equal(called,false)
 assert.deepEqual(validateRouterOutput({action:'respond'},{messages:[{id:'latest',text:'who i am'}],intent:'question',taskStatus:'complete',hasAttachments:false,relation}),{action:'respond'})
 assert.equal(ordinaryConversationMessage('who i am','supplement'),true)
 assert.equal(ordinaryConversationMessage('hello','supplement'),true)
 assert.equal(socialConversationMessage('hello'),true)
 assert.equal(chatCapabilityAllowed({name:'agent.git_status',source:{type:'builtin'}},{filesEnabled:true,webEnabled:true,conversationOnly:true}),false)
 assert.equal(taskRelationShortcut('明天北京天气怎么样','hello'),'new')
})

test('saved weather plan with a personal question starts conversation at that question',()=>{
 const messages=[{id:'weather',role:'user',content:'查询伦敦的天气预报'},{id:'answer',role:'assistant',content:'明天有雨'},{id:'identity',role:'user',content:'who i am'},{id:'greeting',role:'user',content:'hello'}]
 assert.equal(legacyWeatherIdentityBoundary('查询伦敦的天气预报\n用户补充：who i am\n用户补充：hello',messages),'identity')
 assert.equal(legacyWeatherIdentityBoundary('查询伦敦的天气预报',messages),undefined)
})

test('a project overview is a read-only question even if its intent is mislabeled as a task',()=>{
 const question='这是一个什么项目'
 assert.equal(projectOverviewQuestion(question),true)
 assert.equal(projectOverviewQuestion('修改这个项目'),false)
 assert.equal(ordinaryConversationMessage(question,'new_task'),true)
 assert.deepEqual(validateRouterOutput({action:'respond'},{messages:[{id:'overview',text:question}],intent:'new_task',taskStatus:'none',hasAttachments:false}),{action:'respond'})
 assert.equal(legacyProjectOverviewBoundary(question,[{id:'overview',role:'user',content:question}]),'overview')
 assert.equal(legacyProjectOverviewBoundary('修改这个项目',[{id:'overview',role:'user',content:question}]),undefined)
 const options={filesEnabled:true,webEnabled:true,readOnlyConversation:true}
 assert.equal(chatCapabilityAllowed({name:'agent.inspect_project',source:{type:'builtin'}},options),true)
 for(const name of ['agent.write_file','agent.replace_text','agent.run_command','agent.git_status'])assert.equal(chatCapabilityAllowed({name,source:{type:'builtin'}},options),false,name)
})

test('the relation check retains a same-project follow-up and uses bounded context',async()=>{
 let prompt
 const relation=await classifyTaskRelation({goal:'优化当前项目的对话窗口',latest:'检查当前项目的按钮',recent:['旧回答','最新界面截图说明']},async(system,user)=>{
  prompt={system,user};return '{"relation":"same"}'
 })
 assert.equal(relation,'same')
 assert.match(prompt.user,/优化当前项目的对话窗口/)
 assert.match(prompt.user,/检查当前项目的按钮/)
 assert.throws(()=>validateRouterOutput({action:'new_task'},{messages:[{id:'latest',text:'检查当前项目的按钮'}],intent:'supplement',taskStatus:'complete',hasAttachments:false,relation}),/同一任务/)
})

test('uncertain or malformed relation decisions preserve the existing task',async()=>{
 assert.equal(parseTaskRelation('not json'),'uncertain')
 assert.equal(await classifyTaskRelation({goal:'分析仓库',latest:'这是什么意思',recent:[]},async()=>'{"relation":"new","extra":true}'),'uncertain')
 assert.equal(taskRelationShortcut('分析仓库','继续修改'),'same')
 assert.equal(taskRelationShortcut('优化项目按钮','继续优化'),'same')
 assert.equal(taskRelationShortcut('介绍我是谁','who i am'),undefined)
 assert.match(routerBaseline,/input\.relation==='new'/)
})
