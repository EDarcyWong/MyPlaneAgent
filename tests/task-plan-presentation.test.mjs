import test from 'node:test'
import assert from 'node:assert/strict'
import {visibleTaskPlan} from '../dist-electron/shared/task-plan-presentation.js'

test('task list shows milestones and hides internal children and final scheduler review',()=>{
 const items=[
  {id:'child',parentId:'analysis',title:'读取 package.json',status:'complete'},
  {id:'analysis',title:'分析当前项目',status:'pending'},
  {id:'advice',title:'提出优化建议',status:'running'},
  {id:'review',title:'核对整体任务结果',status:'pending'},
 ]
 const view=visibleTaskPlan({taskId:'task',workspace:'/',items,updatedAt:''})
 assert.deepEqual(view.items.map(entry=>entry.item.title),['分析当前项目','提出优化建议'])
 assert.deepEqual(view.items.map(entry=>entry.status),['verifying','running'])
 assert.equal(view.total,2)
 assert.equal(view.completed,0)
 items[0].status='blocked';items[0].summary='需要确认源码结构'
 const blocked=visibleTaskPlan({taskId:'task',workspace:'/',items,updatedAt:''})
 assert.equal(blocked.items[0].status,'blocked')
 assert.equal(blocked.items[0].attention.summary,'需要确认源码结构')
 items[1].status='complete';items[2].status='complete'
 assert.equal(visibleTaskPlan({taskId:'task',workspace:'/',items,updatedAt:''}).completed,2)
})

test('single task stays visible while its checks remain internal',()=>{
 const item={id:'only',title:'梳理并确认可优化项清单',status:'blocked',summary:'测试失败',reviewQueue:{revision:0,checks:[{id:'test',title:'运行测试',status:'failed'}]}}
 const view=visibleTaskPlan({taskId:'task',workspace:'/',items:[item],updatedAt:''})
 assert.equal(view.total,1)
 assert.equal(view.items[0].item.title,item.title)
 assert.equal(view.items[0].status,'blocked')
})
