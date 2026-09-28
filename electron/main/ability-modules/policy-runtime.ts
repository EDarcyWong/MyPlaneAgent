import type { StateModuleInput, PolicyOutput } from '../../shared/ability-modules.js'
import type { AbilityModuleManager } from './manager.js'
import type { PolicyId, PolicyResults } from './policies.js'
export type PolicyInspector = <T>(id:string,input:StateModuleInput,execute:(input:StateModuleInput)=>Promise<T>)=>Promise<T>

// Per-run facade pins versions and only supplies explicit, bounded host facts.
export class AbilityPolicyRuntime {
  private readonly versions = new Map<string, string>()
  constructor(private readonly managers: ReadonlyMap<string, AbilityModuleManager>, private readonly inspect?:PolicyInspector) {}
  fork(inspect?:PolicyInspector): AbilityPolicyRuntime { return new AbilityPolicyRuntime(this.managers,inspect) }
  async invoke<K extends PolicyId>(id: K, data: Record<string, unknown>, text = '', signal?: AbortSignal, messages?: StateModuleInput['messages']): Promise<PolicyResults[K]> {
    const manager = this.managers.get(id)
    if (!manager) throw new Error(`能力策略未注册：${id}`)
    if (!this.versions.has(id)) this.versions.set(id, manager.activeVersionId())
    const input = { data, messages: messages || (text ? [{ id: 'current', text: text.slice(0, 12000) }] : []) }
    let effective:StateModuleInput=input
    const execute=(value:StateModuleInput)=>{effective=value;return manager.execute(value,signal,this.versions.get(id))}
    const result = this.inspect ? await this.inspect(id,input,execute) : await execute(input)
    manager.recordSample(effective, result.versionId)
    return (result.output as PolicyOutput).result as unknown as PolicyResults[K]
  }
}
