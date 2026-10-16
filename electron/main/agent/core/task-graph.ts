import type {TaskItem,TaskPlan} from '../../../shared/task-plan.js'

/** Dependencies are persisted as item IDs so a saved plan survives model and app restarts. */
export function validateTaskGraph(items:TaskItem[]){
  const byId=new Map(items.map(item=>[item.id,item]))
  if(byId.size!==items.length)throw new Error('任务清单包含重复 ID')
  for(const item of items){
    if(item.parentId&&(!byId.has(item.parentId)||!byId.get(item.parentId)?.childIds?.includes(item.id)))throw new Error('父子任务关系不一致：'+item.title)
    for(const id of [...(item.dependsOn||[]),...(item.childIds||[])])if(id===item.id||!byId.has(id))throw new Error('任务依赖无效：'+item.title)
    for(const id of item.childIds||[])if(byId.get(id)?.parentId!==item.id)throw new Error('父子任务关系不一致：'+item.title)
    if(item.parallel&&item.mode!=='read'&&item.mode!=='write')throw new Error('只有读取或限定文件范围的修改任务可以并行：'+item.title)
    if(item.parallel&&item.mode==='write'&&(!item.fileScope?.length||!item.verification?.length||item.verification.some(rule=>rule.kind!=='file')))throw new Error('并行修改需要明确文件范围和文件验收；项目测试应放在后续步骤：'+item.title)
  }
  // Children inherit their ancestors' prerequisites. Validate those effective
  // edges too, otherwise a parent waiting on its own descendant can deadlock.
  for(const item of items){
    const seen=new Set([item.id])
    for(let parent=item.parentId;parent;parent=byId.get(parent)?.parentId){
      if(seen.has(parent))throw new Error('父子任务关系存在循环')
      seen.add(parent)
    }
  }
  const visited=new Set<string>(),active=new Set<string>()
  const visit=(id:string)=>{
    if(active.has(id))throw new Error('任务依赖存在循环')
    if(visited.has(id))return
    active.add(id)
    const item=byId.get(id)!
    for(const dependency of taskDependencyIds(items,item))visit(dependency)
    active.delete(id);visited.add(id)
  }
  for(const item of items)visit(item.id)
}

export function taskDependencyIds(items:TaskItem[],item:TaskItem):string[]{
  const dependencies=new Set([...(item.dependsOn||[]),...(item.childIds||[])])
  const byId=new Map(items.map(task=>[task.id,task])),seen=new Set([item.id])
  for(let parent=item.parentId;parent&&!seen.has(parent);parent=byId.get(parent)?.parentId){
    seen.add(parent)
    for(const id of byId.get(parent)?.dependsOn||[])dependencies.add(id)
  }
  return [...dependencies]
}

/** Only actual prerequisite branches contribute work and evidence to a worker. */
export function taskPrerequisites(plan:TaskPlan,item:TaskItem):TaskItem[]{
  if(!plan.graphVersion)return plan.items.filter(task=>task!==item&&task.status==='complete')
  const byId=new Map(plan.items.map(task=>[task.id,task])),seen=new Set<string>()
  const visit=(task:TaskItem)=>{for(const id of taskDependencyIds(plan.items,task)){if(seen.has(id))continue;seen.add(id);const dependency=byId.get(id);if(dependency)visit(dependency)}}
  visit(item)
  return plan.items.filter(task=>seen.has(task.id)&&task.status==='complete')
}

export function readyTaskItems(plan:TaskPlan):TaskItem[]{
  if(!plan.graphVersion){const first=plan.items.find(item=>item.status!=='complete');return first?[first]:[]}
  const byId=new Map(plan.items.map(item=>[item.id,item]))
  return plan.items.filter(item=>item.status!=='complete'&&taskDependencyIds(plan.items,item).every(id=>byId.get(id)?.status==='complete'))
}

export function readWorkerBatch(ready:TaskItem[],limit=2):TaskItem[]{
  const first=ready[0]
  if(!first?.parallel||first.mode!=='read'||first.repairPending||!first.parentId)return first?[first]:[]
  return ready.filter(item=>item.parallel&&item.mode==='read'&&!item.repairPending&&item.parentId===first.parentId).slice(0,limit)
}
