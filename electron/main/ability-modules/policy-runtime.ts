import type { StateModuleInput, PolicyOutput } from '../../shared/ability-modules.js'
import type { AbilityModuleManager } from './manager.js'
import type { PolicyId, PolicyResults } from './policies.js'

// Per-run facade pins versions and only supplies explicit, bounded host facts.
export class AbilityPolicyRuntime {
  private readonly versions = new Map<string, string>()
  constructor(private readonly managers: ReadonlyMap<string, AbilityModuleManager>) {}
  fork(): AbilityPolicyRuntime { return new AbilityPolicyRuntime(this.managers) }
  async invoke<K extends PolicyId>(id: K, data: Record<string, unknown>, text = '', signal?: AbortSignal, messages?: StateModuleInput['messages']): Promise<PolicyResults[K]> {
    const manager = this.managers.get(id)
    if (!manager) throw new Error(`能力策略未注册：${id}`)
    if (!this.versions.has(id)) this.versions.set(id, manager.activeVersionId())
    const input = { data, messages: messages || (text ? [{ id: 'current', text: text.slice(0, 12000) }] : []) }
    const result = await manager.execute(input, signal, this.versions.get(id))
    manager.recordSample(input, result.versionId)
    return (result.output as PolicyOutput).result as unknown as PolicyResults[K]
  }
}
