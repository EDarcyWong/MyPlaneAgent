import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { KernelReport } from '../../shared/ability-catalog.js'
import type { AbilityModuleManager } from './manager.js'
import { readIntegrationJson, writeIntegrationJson } from '../integration-store.js'
import { validateToolArguments, validateExecutionPlan } from '../agent/core/execution-guards.js'
import { AgentExecutor } from '../agent/core/agent-executor.js'
import type { CapabilityRegistry } from '../agent/core/capability-registry.js'
import { runSandbox } from './sandbox.js'

export const kernelIds = new Set(['session-persistence','step-executor','call-validation','regression-evaluation','sandbox-runtime','version-release'])
export async function checkKernel(id: string, directory: string, managers: ReadonlyMap<string, AbilityModuleManager>, implementationVersion?: string): Promise<KernelReport> {
  if (!kernelIds.has(id)) throw new Error('此模块不是受保护内核')
  const report: KernelReport = {id:randomUUID(),moduleId:id,createdAt:new Date().toISOString(),implementationVersion,passed:false,tests:[]}
  const check = async (name: string, work: () => unknown) => {
    try { await work(); report.tests.push({name,passed:true}) }
    catch (error) { report.tests.push({name,passed:false,error:String(error).slice(0,1000)}) }
  }
  const ensure = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
  const rejects = (work:()=>unknown) => { let rejected=false;try{work()}catch{rejected=true}ensure(rejected,'不合法输入未被拒绝') }
  if (id==='session-persistence') {
    await check('原子写入、重读及独立旧快照保留',()=>{
      const root=path.join(directory,'kernel-checks','probes',report.id)
      const old={message:'用户原文',version:'old'}, next={...old,version:'new'}
      writeIntegrationJson(path.join(root,'history.json'),old)
      writeIntegrationJson(path.join(root,'current.json'),old)
      writeIntegrationJson(path.join(root,'current.json'),next)
      ensure(JSON.stringify(readIntegrationJson(path.join(root,'history.json'),null))===JSON.stringify(old),'历史快照被覆盖')
      ensure(JSON.stringify(readIntegrationJson(path.join(root,'current.json'),null))===JSON.stringify(next),'新状态未完整写入')
    })
    await check('损坏记录明确报错，不静默重置',()=>{
      const file=path.join(directory,'kernel-checks','probes',report.id,'corrupt.json')
      fs.writeFileSync(file,'{broken')
      rejects(()=>readIntegrationJson(file,{}))
    })
  } else if (id==='call-validation') {
    const schema={type:'object',properties:{path:{type:'string',minLength:1}},required:['path'],additionalProperties:false}
    await check('合法参数可通过',()=>validateToolArguments(schema,{path:'example.txt'}))
    await check('缺失、伪造及错误类型参数被阻止',()=>{for(const args of [{},{path:4},{path:'x',allowAll:true},[],null])rejects(()=>validateToolArguments(schema,args))})
  } else if (id==='step-executor') {
    await check('阻止空计划和循环/前向依赖',()=>{
      for(const steps of [[],[{capability:'check',args:{},dependsOn:[0]}],[{capability:'check',args:{},dependsOn:[-1]}]])rejects(()=>validateExecutionPlan({taskId:'probe',createdAt:0,reasoning:'',steps}))
    })
    await check('失败依赖不执行；已成功操作不重放',async()=>{
      const calls:string[]=[]
      const registry={get:()=>({}),execute:async(request:{capability:string})=>{calls.push(request.capability);return {success:request.capability!=='bad',output:'probe',error:'probe failure'}}} as unknown as CapabilityRegistry
      const result=await new AgentExecutor(registry).execute({taskId:'probe',createdAt:0,reasoning:'',steps:[{capability:'good',args:{}},{capability:'bad',args:{},optional:true},{capability:'dependent',args:{},dependsOn:[1]}]},directory,new AbortController().signal)
      ensure(!result.success&&calls.join(',')==='good,bad','依赖失败仍执行或重放')
    })
  } else if (id==='sandbox-runtime') {
    await check('文件、网络和进程能力不可见',async()=>{
      const [result]=await runSandbox('function process(){return [typeof require,typeof fetch,typeof process.env,typeof Deno]}',[{messages:[]}])
      ensure(!result.error&&JSON.stringify(result.output)===JSON.stringify(['undefined','undefined','undefined','undefined']),'宿主能力泄漏')
    })
    await check('无限循环被中断',async()=>{const [result]=await runSandbox('function process(){while(true){}}',[{messages:[]}]);ensure(!!result.error,'无限循环未被阻止')})
  } else if (id==='regression-evaluation') {
    for (const [moduleId,manager] of managers) await check(`${moduleId} 当前版本独立验收`,async()=>{const result=await manager.test(manager.activeVersionId());ensure(result.passed,`验收未全部通过：${result.score} 分`)})
  } else if (id==='version-release') {
    for (const [moduleId,manager] of managers) await check(`${moduleId} 历史源码哈希与活动指针完整`,()=>{
      const snapshot=manager.snapshot(), ids=new Set(snapshot.versions.map(version=>version.id))
      ensure(ids.has(snapshot.activeId),'活动版本缺失')
      for(const version of snapshot.versions){manager.version(version.id);ensure(!version.parentId||ids.has(version.parentId),'父版本缺失')}
    })
  }
  report.passed=report.tests.length>0&&report.tests.every(test=>test.passed)
  writeIntegrationJson(path.join(directory,'kernel-checks',id,`${report.id}.json`),report)
  return report
}
