import type { StateModuleInput, StateModuleOutput } from '../../shared/ability-modules.js'
export type EvaluationCase = { name: string; input: StateModuleInput; expected: Partial<StateModuleOutput> }
const input = (...texts: string[]): StateModuleInput => ({ messages: texts.map((text, index) => ({ id: `m${index + 1}`, text })) })
// Independent acceptance cases: never included in the code-generation prompt.
// Generated code cannot edit the suite or the host-side comparison.
export const acceptanceCases: EvaluationCase[] = [
  { name: '空对话', input: input(), expected: { intent: 'new_task', goalMessageId: null, constraintMessageIds: [], amendmentMessageIds: [] } },
  { name: '建立目标', input: input('整理销售数据'), expected: { intent: 'new_task', goalMessageId: 'm1' } },
  { name: '保留约束', input: input('整理销售数据，不修改原文件', '继续'), expected: { intent: 'continue', goalMessageId: 'm1', constraintMessageIds: ['m1'] } },
  { name: '日期纠正', input: input('查询今天的数据', '改成昨天'), expected: { intent: 'correction', goalMessageId: 'm1', amendmentMessageIds: ['m2'] } },
  { name: '补充要求', input: input('生成报告', '还要图表'), expected: { intent: 'supplement', goalMessageId: 'm1', amendmentMessageIds: ['m2'] } },
  { name: '进度查询保留目标', input: input('分析代码', '做到哪了？'), expected: { intent: 'progress', goalMessageId: 'm1' } },
  { name: '取消任务', input: input('生成报告', '取消'), expected: { intent: 'cancel', goalMessageId: 'm1' } },
  { name: '取消后继续', input: input('生成报告', '停止', '继续吧'), expected: { intent: 'continue', goalMessageId: 'm1' } },
  { name: '明确新任务隔离旧约束', input: input('整理数据，不修改原文件', '新任务：写一首诗'), expected: { intent: 'new_task', goalMessageId: 'm2', constraintMessageIds: [], amendmentMessageIds: [] } },
  { name: '只读补充', input: input('检查项目', '不要修改任何文件'), expected: { intent: 'supplement', goalMessageId: 'm1', constraintMessageIds: ['m2'] } },
  { name: '英文继续', input: input('Review the project', 'continue!'), expected: { intent: 'continue', goalMessageId: 'm1' } },
  { name: '英文纠正', input: input('Create a report', 'Actually use September'), expected: { intent: 'correction', goalMessageId: 'm1' } },
  { name: '普通提问', input: input('什么是上下文？'), expected: { intent: 'question', goalMessageId: 'm1' } },
  { name: '提及停止不是取消指令', input: input('解释停止任务按钮的作用'), expected: { intent: 'new_task', goalMessageId: 'm1' } },
  { name: '单独继续不编造目标', input: input('继续'), expected: { intent: 'continue', goalMessageId: null } },
  { name: '多次纠正保持来源', input: input('整理数据', '改成六月', '换成七月', '继续'), expected: { intent: 'continue', goalMessageId: 'm1', amendmentMessageIds: ['m2', 'm3'] } },
]
export function matchesExpected(output: StateModuleOutput, expected: Partial<StateModuleOutput>): boolean {
  return Object.entries(expected).every(([key, value]) => JSON.stringify(output[key as keyof StateModuleOutput]) === JSON.stringify(value))
}
