import type {TaskItem,TaskPlan} from './task-plan.js'

export type VisibleTask={item:TaskItem;status:TaskItem['status'];attention?:TaskItem}

/** Keep the task list about user-visible milestones, not scheduler checks. */
export function visibleTaskPlan(plan:TaskPlan):{items:VisibleTask[];completed:number;total:number}{
 const roots=plan.items.filter(item=>!item.parentId&&item.title!=='核对整体任务结果')
 const displayed=roots.length?roots:plan.items.filter(item=>!item.parentId).slice(0,1)
 const items=displayed.map(item=>{
  const children=plan.items.filter(child=>child.parentId===item.id)
  let status=item.status
  if(status!=='complete'&&children.length){
   if(children.some(child=>child.status==='blocked'))status='blocked'
   else if(children.some(child=>child.status==='running'))status='running'
   else if(children.some(child=>child.status==='verifying')||children.every(child=>child.status==='complete'))status='verifying'
   else if(children.some(child=>child.status==='complete'))status='running'
  }
  return {item,status,attention:status==='blocked'?children.find(child=>child.status==='blocked')||item:undefined}
 })
 return {items,completed:items.filter(entry=>entry.status==='complete').length,total:items.length}
}
