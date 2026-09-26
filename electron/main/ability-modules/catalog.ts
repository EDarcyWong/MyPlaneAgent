import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { abilityStages, type AbilityCatalog, type AbilityCatalogItem, type AbilityDescriptor, type AbilityModuleDetails } from '../../shared/ability-catalog.js'
import type { AbilityModuleManager } from './manager.js'
import { policyContracts } from './policies.js'
import { checkKernel, kernelIds } from './kernel-checks.js'
import type { KernelReport } from '../../shared/ability-catalog.js'
import type { AbilityAcceptanceReport } from '../../shared/ability-catalog.js'
import { randomUUID } from 'node:crypto'
import { readIntegrationJson, writeIntegrationJson } from '../integration-store.js'

// Logical capabilities can share implementation. Only registered managed modules
// expose mutation APIs; a category or source file never grants execution rights.
export const abilityDefinitions: AbilityDescriptor[] = [
  { id: 'conversation-state', stageId: 'state', name: '目标与约束提取', description: '从用户消息中提取目标、约束和纠正来源，生成有来源依据的状态建议。', mode: 'managed', protected: false,
    inputs: ['按时间排列的用户消息'], outputs: ['目标消息引用', '约束与纠正引用', '意图建议'], dependencies: [], implementation: ['ability-modules/baseline.js', 'ability-modules/conversation.js'], integrationNote: '已接入聊天；代码、版本、评测、反馈和优化策略独立保存。' },
  { id: 'state-context-selection', stageId: 'state', name: '状态来源与上下文选择', description: '优先保留当前目标、约束和最近消息，明确标记省略内容。', mode: 'managed', protected: false,
    inputs: ['原始用户消息候选', '上轮状态的必保留引用', '输入容量'], outputs: ['按时间排序的消息引用', '宿主计算的省略数量'], dependencies: ['conversation-state'], implementation: ['ability-modules/selection.js', 'ability-modules/conversation.js'], integrationNote: '已接入聊天，独立保存版本、反馈和评测。候选准备、来源校验、容量限制和参考上下文格式由内核保护；运行失败回退至本模块基线。依赖目标提取的上一轮状态，不形成同轮循环调用。' },
  { id: 'session-persistence', stageId: 'state', name: '会话持久化与状态快照', description: '保存原始消息、执行记录和每轮状态快照，支持重新打开会话。', mode: 'builtin', protected: true,
    inputs: ['消息与工具记录', '状态快照'], outputs: ['会话存档', '不可覆盖的状态历史'], dependencies: [], implementation: ['local-ai-studio.js', 'integration-store.js'], integrationNote: '属于受保护的数据内核；自动生成代码不能改写存储与权限规则。' },

  { id: 'message-intent', stageId: 'routing', name: '消息意图识别', description: '识别新任务、补充、纠正、进度、继续、取消及普通问答。', mode: 'shared', protected: false, ownerModuleId: 'conversation-state',
    inputs: ['用户消息序列'], outputs: ['七类意图建议'], dependencies: ['conversation-state'], implementation: ['ability-modules/baseline.js'], integrationNote: '当前与目标提取共用一个可升级实现，版本和优化记录归属“目标与约束提取”，不重复创建版本库。' },
  { id: 'task-message-router', stageId: 'routing', name: '任务消息路由', description: '将进度查询、继续、取消和新任务分派到对应处理流程。', mode: 'managed', protected: false,
    inputs: ['当前用户消息与意图', '当前任务状态', '附件标记'], outputs: ['任务路由动作'], dependencies: ['message-intent', 'session-persistence'], implementation: ['ability-modules/routing.js', 'local-ai-studio.js'], integrationNote: '已接入普通聊天，独立管理版本和路由验收。进度读取已有记录，取消暂停本会话后续执行，新任务隔离旧任务上下文；来源、权限、任务状态写入由内核保护。正在生成时仍使用停止按钮，不取消独立工作流或外部后台进程。' },
  { id: 'clarification-policy', stageId: 'routing', name: '必要信息澄清策略', description: '在缺少无法推断的必要信息时提问，避免无依据地扩展任务。', mode: 'builtin', protected: false,
    inputs: ['用户目标与约束', '模型回答与执行结果'], outputs: ['澄清请求', '需要输入的状态'], dependencies: ['conversation-state'], implementation: ['agent/core/chat-runner.js'], integrationNote: '目前由聊天提示和完成检查共同约束，尚未抽出独立分类器。' },

  { id: 'task-planner', stageId: 'execution', name: '任务规划与步骤拆解', description: '生成能力调用计划，验证步骤和依赖关系。', mode: 'builtin', protected: false,
    inputs: ['任务目标', '可用能力', '历史经验'], outputs: ['执行步骤', '依赖关系'], dependencies: ['history-memory', 'tool-selection'], implementation: ['agent/core/agent-planner.js'], integrationNote: '已用于 Agent 计划任务；普通聊天使用聊天执行循环，尚未统一为独立规划模块。' },
  { id: 'step-executor', stageId: 'execution', name: '步骤执行与进度控制', description: '执行计划或逐轮工具调用，保留结果、审批与执行进度。', mode: 'builtin', protected: true,
    inputs: ['任务计划或工具调用', '执行权限'], outputs: ['逐步结果', '工具事件与进度'], dependencies: ['tool-selection', 'call-validation'], implementation: ['agent/core/agent-executor.js', 'agent/core/chat-runner.js'], integrationNote: '执行和权限边界属于稳定内核；不能让自动生成代码绕过审批或重复执行写入。' },
  { id: 'tool-selection', stageId: 'execution', name: '能力注册与工具筛选', description: '注册 Skill、MCP 和内置工具，按可用性与当前权限过滤。', mode: 'builtin', protected: true,
    inputs: ['能力注册表', '联网与文件权限'], outputs: ['本轮可用工具和参数模式'], dependencies: [], implementation: ['agent/core/capability-registry.js', 'agent/core/chat-runner.js'], integrationNote: '已有权限过滤；按任务语义动态检索少量工具尚未独立接入。' },

  { id: 'call-validation', stageId: 'recovery', name: '工具调用与参数校验', description: '检查工具名称、参数结构和执行权限，对无效调用返回修正信息。', mode: 'builtin', protected: true,
    inputs: ['模型工具调用', '能力参数模式'], outputs: ['可执行参数', '校验错误'], dependencies: [], implementation: ['agent/core/chat-runner.js', 'agent/registry.js'], integrationNote: '执行前校验属于受保护内核，不允许候选模块自行降低验收条件。' },
  { id: 'completion-review', stageId: 'recovery', name: '任务完成检查', description: '结合候选回答和工具证据判断完成、继续、受阻或需要输入。', mode: 'builtin', protected: false,
    inputs: ['用户目标', '候选回答', '执行证据'], outputs: ['完成状态', '原因与下一步'], dependencies: ['step-executor'], implementation: ['agent/core/completion-review.js', 'agent/core/chat-runner.js'], integrationNote: '已接入模型完成检查和严格格式解析；尚未覆盖所有任务类型的确定性结果验证。' },
  { id: 'response-continuation', stageId: 'recovery', name: '长响应续写与聚合', description: '纯文本最终回答达到输出上限时保留已生成正文并从断点继续；工具调用截断仍由内核整轮作废。', mode: 'builtin', protected: false,
    inputs: ['截断正文', '工具调用数量', '模型容量', '已续写段数'], outputs: ['续写或停止决策', '分段上限', '断点尾部窗口'], dependencies: ['completion-review', 'model-adapter'], implementation: ['agent/core/chat-runner.js', 'agent/model.js', 'local-ai-model-error.js'], integrationNote: '续写决策可独立优化；工具调用完整性、实际容量和最大分段数由宿主硬限制。' },
  { id: 'error-recovery', stageId: 'recovery', name: '失败恢复与停滞检测', description: '反馈工具错误、限制无进展重试，保留未完成结果。', mode: 'builtin', protected: false,
    inputs: ['失败结果', '进展签名', '轮次预算'], outputs: ['纠正提示', '继续或暂停结论'], dependencies: ['call-validation', 'completion-review'], implementation: ['agent/core/chat-runner.js'], integrationNote: '已有重试和停滞保护；完整的错误类型路由仍需进一步模块化。' },

  { id: 'context-compaction', stageId: 'context', name: '上下文预算与压缩恢复', description: '估算上下文、压缩历史，并在摘要失败时保留原始要求和执行记录。', mode: 'builtin', protected: false,
    inputs: ['历史消息', '容量与输出预算'], outputs: ['摘要检查点', '恢复上下文', '容量状态'], dependencies: ['state-context-selection'], implementation: ['local-ai-context.js', 'agent/context-policy.js'], integrationNote: '已接入聊天和任务处理，当前随应用发布更新。' },
  { id: 'model-adapter', stageId: 'context', name: '模型协议与容量适配', description: '适配模型协议、输出格式和服务返回的实际上下文容量。', mode: 'builtin', protected: true,
    inputs: ['连接配置', '模型与消息', '工具定义'], outputs: ['标准化模型响应', 'Token 用量', '容量反馈'], dependencies: ['context-compaction'], implementation: ['agent/model.js', 'agent/model-budget.js'], integrationNote: '涉及模型连接与鉴权，由应用内核维护；当前不具备自动模型能力分级。' },
  { id: 'history-memory', stageId: 'context', name: '任务历史与经验记忆', description: '保存和查询 Agent 任务历史，向规划提供相关经验。', mode: 'builtin', protected: false,
    inputs: ['任务历史', '查询条件'], outputs: ['历史摘要', '相似任务经验'], dependencies: ['session-persistence'], implementation: ['agent/core/agent-memory.js'], integrationNote: '已用于 Agent 规划；普通聊天的分层检索记忆尚未统一接入。' },

  { id: 'regression-evaluation', stageId: 'evaluation', name: '独立回归与对话回放', description: '运行固定验收案例、历史问题和对话副本，比较候选与当前版本。', mode: 'builtin', protected: true,
    inputs: ['候选代码', '独立评测集', '历史问题'], outputs: ['回归分数', '测试报告', '回放差异'], dependencies: ['sandbox-runtime'], implementation: ['ability-modules/evaluation.js', 'ability-modules/manager.js'], integrationNote: '已覆盖全部独立策略模块的专属验收与历史回放。可运行内核检查并保留报告，验收规则不由候选代码修改。' },
  { id: 'sandbox-runtime', stageId: 'evaluation', name: '代码隔离与资源限制', description: '隔离执行候选 JavaScript，限制时间、内存和宿主能力访问。', mode: 'builtin', protected: true,
    inputs: ['模块代码', '受限输入', '取消信号'], outputs: ['隔离执行结果', '资源或格式错误'], dependencies: [], implementation: ['ability-modules/sandbox.js', 'ability-modules/sandbox-worker.js'], integrationNote: '沙箱边界属于稳定内核，不能由被测试代码自行升级。' },
  { id: 'version-release', stageId: 'evaluation', name: '版本发布、评分与回退', description: '保留全部代码版本、评分和发布记录，按验收门槛切换或回退。', mode: 'builtin', protected: true,
    inputs: ['评测报告', '发布策略', '用户选择'], outputs: ['版本选择', '优化记录', '回退历史'], dependencies: ['regression-evaluation'], implementation: ['ability-modules/manager.js', 'integration-store.js'], integrationNote: '已用于可独立升级的模块；发布规则与评测门槛不由候选代码修改。' },
].map((module): AbilityDescriptor => {
  const policy = policyContracts.find(item => item.id === module.id)
  if (!policy) return {...module, implementation:[...module.implementation,'ability-modules/kernel-checks.js',...(module.id==='call-validation'||module.id==='step-executor'?['agent/core/execution-guards.js']:[])]} as AbilityDescriptor
  return {...module, stageId: module.stageId as AbilityDescriptor['stageId'], mode:'managed', ownerModuleId:undefined, description:policy.description, implementation:['ability-modules/policies.js',...module.implementation], integrationNote:policy.description + ' 已接入实际处理流程；版本、反馈、评测与回放独立保存。权限、来源、容量和发布硬限制仍由宿主验证。'}
})

export class AbilityCatalogService {
  private acceptanceRunning = false
  acceptanceHistory(): AbilityAcceptanceReport[] {
    if (!this.storage) return []
    const directory = path.join(this.storage.directory, 'acceptance')
    if (!fs.existsSync(directory)) return []
    return fs.readdirSync(directory).filter(name => /^[a-f0-9-]+\.json$/.test(name))
      .map(name => readIntegrationJson<AbilityAcceptanceReport>(path.join(directory, name), null!))
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt))
  }
  async runAcceptance(): Promise<AbilityAcceptanceReport> {
    if (!this.storage) throw new Error('尚未配置评测保存目录')
    if (this.acceptanceRunning) throw new Error('六阶段评测正在进行，请等待完成')
    this.acceptanceRunning = true
    const started = Date.now()
    const report: AbilityAcceptanceReport = { id:randomUUID(), createdAt:new Date().toISOString(), elapsedMs:0, catalogId:this.storage.snapshotId, kind:'local-regression', modules:[] }
    try {
      const versions = new Map([...this.managers].map(([id,manager]) => [id,manager.activeVersionId()]))
      for (const descriptor of abilityDefinitions) {
        const begin = Date.now(), version = versions.get(descriptor.id) || this.details(descriptor.id).implementationVersion || report.catalogId
        let tests: AbilityAcceptanceReport['modules'][number]['tests'], suiteHash = report.catalogId
        try {
          if (descriptor.mode === 'managed') {
            const result = await this.managed(descriptor.id).test(version)
            tests = result.tests; suiteHash = result.suiteHash
          } else {
            const result = await this.check(descriptor.id)
            tests = result.tests
          }
        } catch (error) { tests = [{name:'评测执行',passed:false,error:String(error).slice(0,1000)}] }
        report.modules.push({moduleId:descriptor.id,stageId:descriptor.stageId,version,suiteHash,tests,elapsedMs:Date.now()-begin})
      }
      report.elapsedMs = Date.now()-started
      writeIntegrationJson(path.join(this.storage.directory,'acceptance',`${report.id}.json`),report)
      return report
    } finally { this.acceptanceRunning = false }
  }
  private readonly descriptors = new Map(abilityDefinitions.map(module => [module.id, module]))
  private storage?: AbilityCatalog['storage']
  constructor(private readonly managers: ReadonlyMap<string, AbilityModuleManager>, private readonly mainDirectory = fileURLToPath(new URL('../', import.meta.url)), storageDirectory?: string) {
    if (storageDirectory) this.archiveCatalog(path.resolve(storageDirectory))
  }
  private archiveCatalog(directory: string): void {
    // Archive application manifests and full source independently of the install path.
    // Archives are records only: never load executable code or permissions from them.
    const sources: Record<string, string> = {}, missingSources: string[] = []
    for (const relative of new Set(abilityDefinitions.flatMap(module => module.implementation))) {
      const file = path.join(this.mainDirectory, relative)
      let code: string
      try { code = fs.readFileSync(file, 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; missingSources.push(relative); continue }
      const hash = createHash('sha256').update(code).digest('hex')
      const archive = path.join(directory, 'catalog', 'sources', `${hash}.json`)
      if (!fs.existsSync(archive)) writeIntegrationJson(archive, { hash, code })
      sources[relative] = hash
    }
    const manifest = { schemaVersion: 1, stages: abilityStages, modules: abilityDefinitions, sources, missingSources }
    const snapshotId = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
    const snapshot = path.join(directory, 'catalog', 'snapshots', `${snapshotId}.json`)
    if (!fs.existsSync(snapshot)) writeIntegrationJson(snapshot, { ...manifest, snapshotId, createdAt: new Date().toISOString() })
    // Only the current catalog pointer changes. Prior snapshots and module stores stay intact.
    writeIntegrationJson(path.join(directory, 'catalog', 'current.json'), { schemaVersion: 1, snapshotId })
    this.storage = { directory, snapshotId }
  }
  descriptor(id: unknown): AbilityDescriptor {
    if (typeof id !== 'string' || !this.descriptors.has(id)) throw new Error('能力模块不存在')
    return this.descriptors.get(id)!
  }
  managed(id: unknown = 'conversation-state'): AbilityModuleManager {
    const descriptor = this.descriptor(id)
    if (descriptor.mode !== 'managed') throw new Error(descriptor.mode === 'shared' ? '此能力共用实现，请到所属模块管理版本' : '此模块尚未接入独立版本管理，不能修改或自动优化')
    const manager = this.managers.get(descriptor.id)
    if (!manager) throw new Error('此模块的运行管理器尚未注册')
    return manager
  }
  private item(descriptor: AbilityDescriptor): AbilityCatalogItem {
    if (descriptor.mode === 'shared' && descriptor.ownerModuleId) {
      const snapshot = this.managed(descriptor.ownerModuleId).snapshot()
      return { ...structuredClone(descriptor), activeVersion: snapshot.activeId }
    }
    if (descriptor.mode !== 'managed') return structuredClone(descriptor)
    const snapshot = this.managed(descriptor.id).snapshot()
    return { ...structuredClone(descriptor), activeVersion: snapshot.activeId, versionCount: snapshot.versions.length, problemCount: snapshot.problems.length, runningJob: snapshot.jobs.some(job => ['queued', 'analyzing', 'testing'].includes(job.phase)) }
  }
  list(): AbilityCatalog { return { stages: abilityStages, modules: abilityDefinitions.map(descriptor => this.item(descriptor)), storage: this.storage ? { ...this.storage } : undefined } }
  details(id: unknown): AbilityModuleDetails {
    const descriptor = this.descriptor(id), sources: AbilityModuleDetails['sources'] = [], missingSources: string[] = []
    if (descriptor.mode === 'shared' && descriptor.ownerModuleId) {
      const owner = this.managed(descriptor.ownerModuleId), version = owner.version(owner.snapshot().activeId)
      return { module: this.item(descriptor), implementationVersion: version.id, sources: [{ path: `ability-modules/${descriptor.ownerModuleId}/versions/${version.id}.json · code`, code: version.code, hash: version.hash, truncated: false }], missingSources }
    }
    for (const relative of descriptor.implementation) {
      // Paths are from the application-owned manifest, never from IPC payloads.
      const file = path.join(this.mainDirectory, relative)
      if (!fs.existsSync(file)) { missingSources.push(relative); continue }
      const code = fs.readFileSync(file, 'utf8')
      sources.push({ path: `electron/main/${relative}`, code: code.slice(0, 40000), hash: createHash('sha256').update(code).digest('hex'), truncated: code.length > 40000 })
    }
    const fingerprint = sources.length ? 'app-' + createHash('sha256').update(JSON.stringify(sources.map(source => [source.path, source.hash]))).digest('hex').slice(0, 12) : undefined
    return { module: this.item(descriptor), implementationVersion: missingSources.length ? undefined : fingerprint, sources, missingSources,
      ...(this.storage && kernelIds.has(descriptor.id) ? {kernelReports:this.kernelReports(descriptor.id), archives:this.archives()} : {}) }
  }
  private archives(): Array<{snapshotId:string;createdAt:string}> {
    if (!this.storage) return []
    const directory=path.join(this.storage.directory,'catalog','snapshots')
    return fs.readdirSync(directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(name=>{
      const value=readIntegrationJson<{createdAt:string}>(path.join(directory,name),{createdAt:''})
      return {snapshotId:name.slice(0,-5),createdAt:value.createdAt}
    }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  }
  private kernelReports(id:string):KernelReport[] {
    const directory=path.join(this.storage!.directory,'kernel-checks',id)
    if(!fs.existsSync(directory))return []
    return fs.readdirSync(directory).filter(name=>/^[a-f0-9-]+\.json$/.test(name)).map(name=>readIntegrationJson<KernelReport>(path.join(directory,name),null!)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  }
  async check(id:unknown):Promise<KernelReport> {
    const descriptor=this.descriptor(id)
    if(!this.storage)throw new Error('内核检查需要持久化目录')
    return checkKernel(descriptor.id,this.storage.directory,this.managers,this.details(id).implementationVersion)
  }
  archive(id:unknown,snapshotId:unknown):AbilityModuleDetails {
    const descriptor=this.descriptor(id)
    if(!this.storage||!kernelIds.has(descriptor.id)||typeof snapshotId!=='string'||!/^[a-f0-9]{64}$/.test(snapshotId))throw new Error('内核存档标识无效')
    const manifest=readIntegrationJson<{modules:AbilityDescriptor[];sources:Record<string,string>}|null>(path.join(this.storage.directory,'catalog','snapshots',`${snapshotId}.json`),null)
    const archived=manifest?.modules.find(module=>module.id===id)
    if(!manifest||!archived)throw new Error('存档中没有此模块')
    const sources:AbilityModuleDetails['sources']=[],missingSources:string[]=[]
    for(const relative of archived.implementation){
      const hash=manifest.sources[relative]
      if(!hash){missingSources.push(relative);continue}
      if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('存档哈希无效')
      const value=readIntegrationJson<{code:string}|null>(path.join(this.storage.directory,'catalog','sources',`${hash}.json`),null)
      if(!value||typeof value.code!=='string'||createHash('sha256').update(value.code).digest('hex')!==hash)throw new Error('存档内容校验失败')
      sources.push({path:relative,hash,code:value.code.slice(0,40000),truncated:value.code.length>40000})
    }
    return {module:archived,implementationVersion:snapshotId,sources,missingSources}
  }
}
