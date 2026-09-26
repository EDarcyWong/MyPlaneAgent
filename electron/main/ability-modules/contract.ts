import type { AbilityInput, AbilityOutput } from '../../shared/ability-modules.js'
import { baselineCode } from './baseline.js'
import { acceptanceCases } from './evaluation.js'
import { validateInput, validateOutput } from './sandbox.js'

export type ModuleCase = { name: string; input: AbilityInput; expected: Partial<AbilityOutput> }
export type ModuleContract = {
  id: string; name: string; description: string; instructions: string; baseline: string
  cases: ModuleCase[]
  validateInput(input: AbilityInput): void
  validateOutput(output: unknown, input: AbilityInput): AbilityOutput
}
export const stateContract: ModuleContract = {
  id: 'conversation-state', name: '目标与约束提取', description: '从用户消息中提取目标、约束与纠正，供聊天处理参考。',
  baseline: baselineCode, cases: acceptanceCases, validateInput, validateOutput,
  instructions: '输入为 {messages:[{id:string,text:string}]}，按时间顺序排列，最多80条。编写同步函数 process(input)，返回且仅返回 {intent,goalMessageId,constraintMessageIds,amendmentMessageIds}。intent 必须是 new_task|supplement|correction|progress|continue|cancel|question；goalMessageId 是用户消息ID或null，两个数组只包含真实用户消息ID且不重复。保留原始目标、约束和纠正；明确新任务时重置旧任务状态。进度和继续消息不是新目标。不要用助手声称完成作为证据。',
}
