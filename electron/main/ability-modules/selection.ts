import type { AbilityInput, ConversationState, SelectionInput, SelectionOutput, StateModuleInput } from '../../shared/ability-modules.js'
import type { StudioMessage } from '../../shared/local-ai-studio.js'
import type { ModuleContract } from './contract.js'

const cost = (message: StateModuleInput['messages'][number]) => JSON.stringify(message).length + 1
export function validateSelectionInput(value: AbilityInput): asserts value is SelectionInput {
  const input = value as SelectionInput
  if (!input || !Array.isArray(input.messages) || input.messages.length > 200 || JSON.stringify(input).length > 260000 ||
      !Number.isInteger(input.maxMessages) || input.maxMessages < 1 || input.maxMessages > 80 ||
      !Number.isInteger(input.maxCharacters) || input.maxCharacters < 100 || input.maxCharacters > 60000 || !Array.isArray(input.requiredIds)) throw new Error('上下文选择输入或容量无效')
  const ids = new Set<string>()
  for (const message of input.messages) {
    if (!message || typeof message.id !== 'string' || !message.id || message.id.length > 150 || ids.has(message.id) || typeof message.text !== 'string') throw new Error('上下文消息来源无效')
    ids.add(message.id)
  }
  if (new Set(input.requiredIds).size !== input.requiredIds.length || input.requiredIds.some(id => !ids.has(id))) throw new Error('必保留引用无效')
  const required = input.messages.filter(message => input.requiredIds.includes(message.id))
  if (required.length > input.maxMessages || 32 + required.reduce((sum, message) => sum + cost(message), 0) > input.maxCharacters) throw new Error('必保留消息超过容量')
  if (input.messages.length && !input.requiredIds.includes(input.messages.at(-1)!.id)) throw new Error('必须保留最新用户消息')
}
export function validateSelectionOutput(value: unknown, candidate: AbilityInput): SelectionOutput {
  validateSelectionInput(candidate)
  if (!value || typeof value !== 'object' || Object.keys(value).join(',') !== 'selectedMessageIds') throw new Error('上下文选择只能返回 selectedMessageIds')
  const output = value as SelectionOutput, ids = output.selectedMessageIds
  if (!Array.isArray(ids) || ids.length > candidate.maxMessages || new Set(ids).size !== ids.length) throw new Error('选择数量超限或引用重复')
  const positions = new Map(candidate.messages.map((message, index) => [message.id, index]))
  if (ids.some((id, index) => !positions.has(id) || (index > 0 && positions.get(id)! <= positions.get(ids[index - 1])!))) throw new Error('引用必须来自原始消息并按时间排序')
  if (candidate.requiredIds.some(id => !ids.includes(id))) throw new Error('遗漏最新消息或必须保留的目标与约束')
  const selected = candidate.messages.filter(message => ids.includes(message.id))
  if (32 + selected.reduce((sum, message) => sum + cost(message), 0) > candidate.maxCharacters) throw new Error('选择内容超过容量')
  return { selectedMessageIds: [...ids] }
}

export const selectionBaseline = `function process(input) {
  const selected = new Set(); let size = 32;
  const required = new Set(input.requiredIds);
  const priority = [...input.messages.filter(m => required.has(m.id)), input.messages[0], ...input.messages.slice().reverse()];
  for (const m of priority) {
    if (!m || selected.has(m.id)) continue;
    const cost = JSON.stringify(m).length + 1;
    if (selected.size >= input.maxMessages || size + cost > input.maxCharacters) continue;
    selected.add(m.id); size += cost;
  }
  return {selectedMessageIds:input.messages.filter(m => selected.has(m.id)).map(m => m.id)};
}`

// Host preserves original text, protects required references and bounds candidate size.
// The replaceable policy only chooses IDs; it cannot alter messages or budgets.
export function selectionInput(messages: StudioMessage[], previous?: ConversationState): { input: SelectionInput; total: number } {
  const users = messages.filter(message => message.role === 'user').map(message => ({ id: message.id, text: message.content }))
  const pinned = new Set([previous?.proposal.goalMessageId, ...(previous?.proposal.constraintMessageIds || []), ...(previous?.proposal.amendmentMessageIds || [])])
  const priority = [users.at(-1), ...users.filter(message => pinned.has(message.id)), users[0], ...users.slice().reverse()]
  const candidates = new Set<string>(), required = new Set<string>()
  let candidateSize = 32, requiredSize = 32
  for (const message of priority) {
    if (!message || candidates.has(message.id)) continue
    const length = cost(message)
    if (candidates.size >= 200 || candidateSize + length > 240000) continue
    candidates.add(message.id); candidateSize += length
    if ((message === users.at(-1) || pinned.has(message.id)) && required.size < 80 && requiredSize + length <= 60000) {
      required.add(message.id); requiredSize += length
    }
  }
  if (users.length && !required.has(users.at(-1)!.id)) throw new Error('最新消息超出模块输入容量，本轮沿用原始对话处理')
  const input = { messages: users.filter(message => candidates.has(message.id)), requiredIds: [...required], maxMessages: 80, maxCharacters: 60000 }
  validateSelectionInput(input)
  return { input, total: users.length }
}
const sample = (count: number, requiredIds: string[], maxMessages = 80): SelectionInput => ({ messages: Array.from({ length: count }, (_, index) => ({ id: `m${index + 1}`, text: `用户内容 ${index + 1}` })), requiredIds, maxMessages, maxCharacters: 60000 })
export const selectionContract: ModuleContract = {
  id: 'state-context-selection', name: '状态来源与上下文选择', description: '在容量内选择原始用户消息，优先保留最新消息、目标与约束，再补充近期上下文。',
  baseline: selectionBaseline, validateInput: validateSelectionInput, validateOutput: validateSelectionOutput,
  instructions: '编写同步 process(input)。输入 {messages:[{id,text}],requiredIds:string[],maxMessages:number,maxCharacters:number}，最多200条候选。只返回 {selectedMessageIds:string[]}，引用真实消息且按原始时间顺序、不重复；必须保留 requiredIds（包含最新消息），不得改写文本。数量不超过 maxMessages；32+所有选中消息的(JSON.stringify(message).length+1)总和不超过 maxCharacters。优先保留必需引用，再考虑首条目标与近期消息。容量与来源校验由宿主执行，不能修改。',
  cases: [
    { name: '空对话', input: sample(0, []), expected: { selectedMessageIds: [] } },
    { name: '单条用户消息', input: sample(1, ['m1']), expected: { selectedMessageIds: ['m1'] } },
    { name: '容量充足保留全部', input: sample(4, ['m4']), expected: { selectedMessageIds: ['m1', 'm2', 'm3', 'm4'] } },
    { name: '容量不足优先目标与最新消息', input: sample(6, ['m1', 'm6'], 3), expected: { selectedMessageIds: ['m1', 'm5', 'm6'] } },
    { name: '保留历史约束和纠正', input: sample(9, ['m2', 'm4', 'm9'], 4), expected: { selectedMessageIds: ['m1', 'm2', 'm4', 'm9'] } },
    { name: '长对话数量边界', input: sample(120, ['m1', 'm120']), expected: { selectedMessageIds: ['m1', ...Array.from({ length: 79 }, (_, i) => `m${i + 42}`)] } },
    { name: '字符预算跳过过大历史消息', input: { messages: [{ id: 'old', text: '旧'.repeat(100) }, { id: 'latest', text: '继续' }], requiredIds: ['latest'], maxMessages: 80, maxCharacters: 100 }, expected: { selectedMessageIds: ['latest'] } },
  ],
}
