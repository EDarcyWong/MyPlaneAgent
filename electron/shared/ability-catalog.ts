export const abilityStages = [
  { id: 'state', order: 1, name: '对话状态管理', description: '保存目标、约束和消息来源，让任务状态跨轮次保留。' },
  { id: 'routing', order: 2, name: '消息理解与路由', description: '识别新任务、补充、纠正、进度查询和继续，决定消息如何影响当前任务。' },
  { id: 'execution', order: 3, name: '分步执行与工具筛选', description: '把目标拆成步骤，选择可用工具并按依赖执行。' },
  { id: 'recovery', order: 4, name: '验证与错误恢复', description: '校验调用和完成证据，处理失败、停滞与恢复。' },
  { id: 'context', order: 5, name: '长对话与模型适配', description: '管理历史、上下文预算与不同模型的调用协议。' },
  { id: 'evaluation', order: 6, name: '全链路评测与加固', description: '通过回归、隔离和发布检查，验证模块变更并保留可恢复版本。' },
] as const
export type AbilityStageId = typeof abilityStages[number]['id']
export type AbilityModuleMode = 'managed' | 'builtin' | 'shared' | 'planned'
export const abilityModeLabels: Record<AbilityModuleMode, string> = {
  managed: '可独立升级', builtin: '应用内置', shared: '共用实现', planned: '待实现',
}
export type AbilityDescriptor = {
  id: string; stageId: AbilityStageId; name: string; description: string
  mode: AbilityModuleMode; protected: boolean; ownerModuleId?: string
  inputs: string[]; outputs: string[]; dependencies: string[]
  implementation: string[]; integrationNote: string
}
export type AbilityCatalogItem = AbilityDescriptor & { activeVersion?: string; versionCount?: number; problemCount?: number; runningJob?: boolean }
export type AbilityCatalog = { stages: typeof abilityStages; modules: AbilityCatalogItem[]; storage?: { directory: string; snapshotId: string } }
export type AbilityModuleDetails = {
  module: AbilityCatalogItem
  implementationVersion?: string
  sources: Array<{ path: string; code: string; hash: string; truncated: boolean }>
  missingSources: string[]
  kernelReports?: KernelReport[]
  archives?: Array<{snapshotId:string;createdAt:string}>
}
export type KernelReport = {id:string;moduleId:string;createdAt:string;implementationVersion?:string;passed:boolean;tests:Array<{name:string;passed:boolean;error?:string}>}
export type AbilityAcceptanceReport = {
  id: string; createdAt: string; elapsedMs: number; catalogId: string; kind: 'local-regression'
  modules: Array<{ moduleId: string; stageId: AbilityStageId; version: string; suiteHash: string; elapsedMs: number; tests: Array<{name:string;passed:boolean;error?:string}> }>
}
export type AbilityCatalogCommands = import('./ability-model-evaluation.js').ModelEvaluationCommands & {
  abilityAcceptanceRun: {input:undefined;output:AbilityAcceptanceReport}
  abilityAcceptanceHistory: {input:undefined;output:AbilityAcceptanceReport[]}
  abilityCatalog: { input: undefined; output: AbilityCatalog }
  abilityModuleDetails: { input: { moduleId: string }; output: AbilityModuleDetails }
  abilityKernelCheck: {input:{moduleId:string};output:KernelReport}
  abilityKernelArchive: {input:{moduleId:string;snapshotId:string};output:AbilityModuleDetails}
}
