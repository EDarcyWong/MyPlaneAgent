export const conversationIntents = ['new_task', 'supplement', 'correction', 'progress', 'continue', 'cancel', 'question'] as const
export type ConversationIntent = typeof conversationIntents[number]
export type StateModuleInput = { messages: Array<{ id: string; text: string }> }
export type SelectionInput = StateModuleInput & { requiredIds: string[]; maxMessages: number; maxCharacters: number }
export type SelectionOutput = { selectedMessageIds: string[] }
export const routeActions = ['new_task', 'continue', 'amend', 'progress', 'cancel', 'clarify', 'respond'] as const
export type RouteAction = typeof routeActions[number]
export type TaskStatus = 'ready' | 'paused' | 'complete' | 'blocked' | 'needs_input'
export type RouterInput = StateModuleInput & { intent: ConversationIntent; taskStatus: TaskStatus | 'none'; hasAttachments: boolean }
export type RouterOutput = { action: RouteAction }
export type AbilityTask = { id: string; startMessageId: string; goalMessageId: string; status: TaskStatus; updatedAt: string; lastExecutionMessageId?: string }
export type AbilityRoute = { versionId: string; action: RouteAction; taskId?: string; createdAt: string }
export type PolicyInput = StateModuleInput & { data: Record<string, unknown> }
export type PolicyOutput = { result: Record<string, unknown> }
export type AbilityInput = StateModuleInput | SelectionInput | RouterInput | PolicyInput
export type AbilityOutput = StateModuleOutput | SelectionOutput | RouterOutput | PolicyOutput
export type StateModuleOutput = {
  intent: ConversationIntent
  goalMessageId: string | null
  constraintMessageIds: string[]
  amendmentMessageIds: string[]
}
export type ConversationState = {
  versionId: string; inputHash: string; updatedAt: string; proposal: StateModuleOutput
  sources: StateModuleInput['messages']; omittedMessages: number
  selectionVersionId?: string
}
export type ModulePolicy = {
  autoOptimize: boolean; autoPromote: boolean; failureThreshold: number
  maxAttemptsPerDay: number; maxOutputTokens: number; timeoutSeconds: number
}
export type ModuleTestResult = { name: string; passed: boolean; error?: string; elapsedMs: number }
export type ModuleReport = {
  id: string; versionId: string; sourceHash: string; suiteHash: string; createdAt: string
  score: number; passed: boolean; tests: ModuleTestResult[]; elapsedMs: number
}
export type ModuleVersion = {
  moduleId?: string
  id: string; parentId?: string; createdAt: string; reason: string; code: string; hash: string; apiVersion: 1
}
export type ModuleProblem = {
  id: string; versionId: string; createdAt: string; kind: 'runtime' | 'feedback'
  description: string; input: AbilityInput; expected?: Partial<AbilityOutput>
}
export type ModuleJob = {
  id: string; createdAt: string; updatedAt: string; parentId: string; problemIds: string[]
  phase: 'queued' | 'analyzing' | 'testing' | 'complete' | 'failed' | 'cancelled'
  model?: string; diagnosis?: string; candidateId?: string; message: string
  shadow?: { samples: number; changed: number; failed: number }
}
export type ModuleRating = { id: string; versionId: string; score: number; note: string; createdAt: string }
export type ModuleSwitch = { id: string; from: string; to: string; reason: string; createdAt: string }
export type ModuleSnapshot = {
  feedbackExample?: { input: AbilityInput; expected: Partial<AbilityOutput> }
  moduleId: string; name: string; description: string; contract: string; activeId: string; policy: ModulePolicy
  versions: Array<Omit<ModuleVersion, 'code'> & { report?: ModuleReport; ratings: ModuleRating[]; quarantined: boolean }>
  problems: ModuleProblem[]; jobs: ModuleJob[]; switches: ModuleSwitch[]
}
type SingleAbilityModuleCommands = {
  abilityModules: { input: undefined; output: ModuleSnapshot }
  abilityModuleVersion: { input: { id: string }; output: ModuleVersion }
  abilityModuleReports: { input: { id: string }; output: ModuleReport[] }
  abilityModuleSave: { input: { parentId: string; code: string; reason: string }; output: ModuleVersion }
  abilityModuleTest: { input: { id: string }; output: ModuleReport }
  abilityModuleActivate: { input: { id: string }; output: void }
  abilityModuleRate: { input: { id: string; score: number; note: string }; output: void }
  abilityModulePolicy: { input: ModulePolicy; output: void }
  abilityModuleProblem: { input: { description: string; messages: string[]; expectedIntent: ConversationIntent }; output: ModuleProblem }
  abilityModuleSelectionProblem: { input: { description: string; input: SelectionInput; expected: SelectionOutput }; output: ModuleProblem }
  abilityModuleRouterProblem: { input: { description: string; input: RouterInput; expected: RouterOutput }; output: ModuleProblem }
  abilityModuleFeedback: { input: { description: string; input: AbilityInput; expected: AbilityOutput }; output: ModuleProblem }
  abilityModuleOptimize: { input: undefined; output: ModuleJob }
  abilityModuleCancel: { input: undefined; output: void }
}
// Preserve callers predating the catalog while explicitly scoping all new UI calls.
export type AbilityModuleCommands = {
  [K in keyof SingleAbilityModuleCommands]: {
    input: SingleAbilityModuleCommands[K]['input'] extends undefined
      ? { moduleId?: string } | undefined
      : SingleAbilityModuleCommands[K]['input'] & { moduleId?: string }
    output: SingleAbilityModuleCommands[K]['output']
  }
}
