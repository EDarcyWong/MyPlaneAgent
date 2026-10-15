import type {TaskItem,TaskPlan} from '../../../shared/task-plan.js'

/** Dependencies are persisted as item IDs so a saved plan survives model and app restarts. */
export function validateTaskGraph(items:TaskItem[]){
  const byId=new Map(items.map(item=>[item.id,item]))
  if(byId.size!==items.length)throw new Error('任务清单包含重复 ID')
  for(const item of items){
    for(const id of [...(item.dependsOn||[]),...(item.childIds||[])])if(id===item.id||!byId.has(id))throw new Error('任务依赖无效：'+item.title)
    for(const id of item.childIds||[])if(byId.get(id)?.parentId!==item.id)throw new Error('父子任务关系不一致：'+item.title)
    if(item.parallel&&item.mode!=='read')throw new Error('只有只读子任务可以并行：'+item.title)
  }
  const visited=new Set<string>(),active=new Set<string>()
  const visit=(id:string)=>{
    if(active.has(id))throw new Error('任务依赖存在循环')
    if(visited.has(id))return
    active.add(id)
    const item=byId.get(id)!
    for(const dependency of [...(item.dependsOn||[]),...(item.childIds||[])])visit(dependency)
    active.delete(id);visited.add(id)
  }
  for(const item of items)visit(item.id)
}

export function readyTaskItems(plan:TaskPlan):TaskItem[]{
  if(!plan.graphVersion){const first=plan.items.find(item=>item.status!=='complete');return first?[first]:[]}
  const byId=new Map(plan.items.map(item=>[item.id,item]))
  const ready=(item:TaskItem):boolean=>{
    if(![...(item.dependsOn||[]),...(item.childIds||[])].every(id=>byId.get(id)?.status==='complete'))return false
    const parent=item.parentId?byId.get(item.parentId):undefined
    return !parent||readyParentDependencies(parent)
  }
  const readyParentDependencies=(parent:TaskItem):boolean=>(parent.dependsOn||[]).every(id=>byId.get(id)?.status==='complete')&&(!parent.parentId||readyParentDependencies(byId.get(parent.parentId)!))
  return plan.items.filter(item=>item.status!=='complete'&&ready(item))
}

export function readWorkerBatch(ready:TaskItem[],limit=2):TaskItem[]{
  const first=ready[0]
  if(!first?.parallel||first.mode!=='read'||first.repairPending||!first.parentId)return first?[first]:[]
  return ready.filter(item=>item.parallel&&item.mode==='read'&&!item.repairPending&&item.parentId===first.parentId).slice(0,limit)
}
