import test from 'node:test'
import assert from 'node:assert/strict'
import {isWebLookup,createTaskScope,implementsPriorAdvice,projectAdviceRequested,projectChecksRequested} from '../dist-electron/shared/task-scope.js'
import {chatCapabilityAllowed} from '../dist-electron/main/agent/core/chat-runner.js'
import {reviewActionAllowed} from '../dist-electron/main/agent/core/review-dispatch.js'

test('information requests are recognized by operation across topics',()=>{
 for(const goal of ['成都市明天限行尾号多少','查询成都市明天限行尾号','成都今天限行吗','查一下明天成都限行时段','明天限行区域有哪些','成都博物馆几点开门','查询上海到杭州的高铁时刻表','人民币兑美元汇率是多少','搜索最新科技新闻','读取 https://www.example.com/news','成都市明天下雨吗','What are the opening hours tomorrow?']){
  assert.equal(isWebLookup(goal),true,goal)
  const scope=createTaskScope(goal)
  for(const name of ['agent.get_diagnostics','agent.run_test','agent.run_test_case','agent.build_project']){
   const capability={name,source:{type:'skill',skillId:'agent-tools'}}
   assert.equal(chatCapabilityAllowed(capability,{filesEnabled:true,webEnabled:true,taskScope:scope}),false,goal+name)
   assert.equal(reviewActionAllowed({title:'检查',capability:name,args:{},basis:goal,required:true},scope),false)
  }
  assert.equal(chatCapabilityAllowed({name:'agent.web_search',source:{type:'skill',skillId:'agent-tools'}},{filesEnabled:false,webEnabled:true,taskScope:scope}),true)
 }
})
test('implementation, explicit checks and mixed actions retain their original path',()=>{
 for(const goal of ['修复限行查询程序','实现一个天气查询网站','查询限行信息并写入文件','查询数据并运行测试','检查 TypeScript 项目','搜索代码中的问题','查询数据库记录','读取 README.md','查询明天车票并购买','查一下并发送邮件','运行项目','继续','明天呢',''])assert.equal(isWebLookup(goal),false,goal)
})
test('project gate does not depend on enumerating information topics or query words',()=>{
 for(const goal of ['成都博物馆开放时间','2026年中秋节放假安排','火星与地球的距离','梳理这篇文章的主要观点','比较两种交通方案','调整出行计划','安装空调的价格是多少']){
  assert.equal(projectChecksRequested(goal),false)
  const scope=createTaskScope(goal),capability={name:'agent.get_diagnostics',source:{type:'skill',skillId:'agent-tools'}}
  assert.equal(chatCapabilityAllowed(capability,{filesEnabled:true,webEnabled:true,taskScope:scope}),false)
  assert.equal(chatCapabilityAllowed(capability,{filesEnabled:true,webEnabled:true,taskScope:scope,currentStep:{implementationChanged:true}}),true)
 }
 for(const goal of ['修复天气查询程序','运行测试','检查项目类型','给网站添加搜索功能','做一个网页',''])assert.equal(projectChecksRequested(goal),true,goal)
})
test('project optimization advice treats tests as findings rather than required execution',()=>{
 for(const goal of ['项目还可以怎么优化','梳理并确认可优化项清单','分析项目的性能、代码质量、可维护性、用户体验和测试覆盖']){
  assert.equal(projectAdviceRequested(goal),true,goal)
  assert.equal(projectChecksRequested(goal),false,goal)
  const scope=createTaskScope(goal)
  for(const name of ['agent.run_test_case','agent.run_test','agent.get_diagnostics','agent.build_project','agent.run_command']){
   const capability={name,source:{type:'skill',skillId:'agent-tools'}}
   assert.equal(chatCapabilityAllowed(capability,{filesEnabled:true,webEnabled:true,taskScope:scope}),false,goal+name)
  }
  assert.equal(chatCapabilityAllowed({name:'agent.read_file',source:{type:'skill',skillId:'agent-tools'}},{filesEnabled:true,webEnabled:true,taskScope:scope}),true)
 }
 for(const followUp of ['按建议完成修改','按建议优化','根据上述建议改进','落实刚才的建议']){
  assert.equal(implementsPriorAdvice(followUp),true,followUp)
  const goal='项目还可以怎么优化\n用户补充：'+followUp
  assert.equal(projectAdviceRequested(goal),false,goal)
  assert.equal(projectAdviceRequested(goal+'\n用户补充：继续'),false,goal)
  assert.equal(projectChecksRequested(goal),true,goal)
  assert.equal(chatCapabilityAllowed({name:'agent.write_file',source:{type:'skill',skillId:'agent-tools'}},{filesEnabled:true,webEnabled:true,taskScope:createTaskScope(goal)}),true,goal)
 }
 for(const goal of ['优化项目并运行测试','梳理项目后修复代码'])assert.equal(projectAdviceRequested(goal),false,goal)
 assert.equal(implementsPriorAdvice('项目还可以怎么优化'),false)
 assert.equal(implementsPriorAdvice('项目还可以怎么优化\n用户补充：按建议优化\n用户补充：现在只列建议，不修改文件'),false)
 assert.equal(projectAdviceRequested('项目还可以怎么优化\n用户补充：按建议优化\n用户补充：现在只列建议，不修改文件'),true)
 assert.equal(chatCapabilityAllowed({name:'agent.run_test_case',source:{type:'skill',skillId:'agent-tools'}},{filesEnabled:true,webEnabled:true,taskScope:createTaskScope('运行测试')}),true)
})
