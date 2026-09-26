import { stateContract } from './contract.js'
import { selectionContract } from './selection.js'
import { policyContracts } from './policies.js'
import { runModuleSandbox } from './sandbox.js'
import type { AbilityModuleManager } from './manager.js'
import type { AgentMessage } from '../agent/model.js'
import type { AbilityInput, SelectionOutput } from '../../shared/ability-modules.js'

// Read-only snapshot: evaluations cannot train, publish or quarantine live versions.
export function comparisonSnapshot(managers:ReadonlyMap<string,AbilityModuleManager>) {
  const contracts=[selectionContract,stateContract,...policyContracts.filter(c=>['message-intent','task-planner','history-memory'].includes(c.id))]
  const snapshots=contracts.map(contract=>{
    const manager=managers.get(contract.id)
    if(!manager)throw new Error(`对照模块未注册：${contract.id}`)
    return {contract,version:manager.version(manager.activeVersionId())}
  })
  return {
    versions:snapshots.map(({contract,version})=>({moduleId:contract.id,versionId:version.id,hash:version.hash})),
    async prepare(messages:AgentMessage[],signal:AbortSignal) {
      let users=messages.filter(m=>m.role==='user').map((m,i)=>({id:`m${i}`,text:typeof m.content==='string'?m.content:''}))
      const trace:Array<{moduleId:string;output:unknown}>=[]
      for(const {contract,version} of snapshots){
        signal.throwIfAborted()
        const input:AbilityInput=contract.id===selectionContract.id?{messages:users,requiredIds:users.length?[users.at(-1)!.id]:[],maxMessages:80,maxCharacters:60000}:
          contract.id===stateContract.id?{messages:users}:
          {messages:users,data:contract.id==='task-planner'?{maxSteps:12}:contract.id==='history-memory'?{candidates:users.slice(0,-1).map(m=>({...m,text:m.text.slice(0,1200)})),limit:3}:{}}
        const [result]=await runModuleSandbox(version.code,[input],contract.validateInput,signal)
        if(result.error)throw new Error(`${contract.id}: ${result.error}`)
        const output=contract.validateOutput(result.output,input)
        trace.push({moduleId:contract.id,output})
        if(contract.id===selectionContract.id)users=users.filter(m=>(output as SelectionOutput).selectedMessageIds.includes(m.id))
      }
      return {trace,reference:JSON.stringify({sources:users,modules:trace})}
    },
  }
}
export type ComparisonSnapshot=ReturnType<typeof comparisonSnapshot>
