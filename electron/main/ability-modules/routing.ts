import { conversationIntents, routeActions, type AbilityInput, type RouterInput, type RouterOutput } from '../../shared/ability-modules.js'
import type { StudioSession } from '../../shared/local-ai-studio.js'
import type { ModuleContract } from './contract.js'

const clean = (text: string) => text.trim().replace(/[。！!？?\s]+$/g, '').toLowerCase()
export const explicitNewTask = (text: string) => /^(新任务|换个任务|另外一个任务|new task)[:：\s]/i.test(text.trim())
const cancelCommand = (text: string) => /^(取消|停止|暂停|不用做了|停止任务|取消任务|暂停任务|cancel|stop|pause)$/.test(clean(text))
const progressCommand = (text: string) => /^(做到哪了|进度如何|现在进度|进度|查看进度|任务进度|status|progress)$/.test(clean(text))
const continueCommand = (text: string) => /^(继续|继续吧|继续修改|继续执行|接着做|接着完成(?:剩余|未完)部分|continue|resume)$/.test(clean(text))
export function validateRouterInput(input: AbilityInput): asserts input is RouterInput {
  const value = input as RouterInput
  if (!value || !Array.isArray(value.messages) || value.messages.length !== 1 || !value.messages[0] || typeof value.messages[0].id !== 'string' || !value.messages[0].id || value.messages[0].id.length > 150 || typeof value.messages[0].text !== 'string' || value.messages[0].text.length > 100000 || JSON.stringify(value).length > 620000 || !conversationIntents.includes(value.intent) || !['none', 'ready', 'paused', 'complete', 'blocked', 'needs_input'].includes(value.taskStatus) || typeof value.hasAttachments !== 'boolean') throw new Error('路由输入必须包含当前用户消息、意图和任务状态')
}
export function validateRouterOutput(value: unknown, input: AbilityInput): RouterOutput {
  validateRouterInput(input)
  if (!value || typeof value !== 'object' || Object.keys(value).join(',') !== 'action' || !routeActions.includes((value as RouterOutput).action)) throw new Error('路由只能返回有效 action')
  const action = (value as RouterOutput).action, text = input.messages[0].text
  // High-impact boundaries use host checks, never just an upgradable intent guess.
  if (!input.hasAttachments) {
    if (cancelCommand(text) && action !== 'cancel') throw new Error('明确取消不得继续执行')
    if (progressCommand(text) && action !== 'progress') throw new Error('明确进度查询不得执行任务')
    if (continueCommand(text) && action !== (input.taskStatus === 'none' ? 'clarify' : 'continue')) throw new Error('继续请求必须保留任务或询问缺失目标')
  }
  if (explicitNewTask(text) && action !== 'new_task') throw new Error('明确新任务必须隔离旧任务上下文')
  if (action === 'cancel' && (input.hasAttachments || !cancelCommand(text))) throw new Error('取消必须来自明确的当前用户命令')
  if (action === 'progress' && (input.hasAttachments || !(progressCommand(text) || input.intent === 'progress'))) throw new Error('进度路由必须来自当前查询')
  if (action === 'new_task' && input.taskStatus !== 'none' && !explicitNewTask(text)) throw new Error('不能静默丢弃已有任务')
  if ((action === 'continue' || action === 'amend') && input.taskStatus === 'none') throw new Error('没有可继续或补充的任务')
  if (action === 'continue' && !continueCommand(text) && input.intent !== 'continue') throw new Error('继续必须有当前用户请求')
  return { action }
}
export const routerBaseline = `function process(input) {
  const text = input.messages[0].text.trim();
  const clean = text.replace(/[。！!？?\\s]+$/g, '').toLowerCase();
  if (/^(新任务|换个任务|另外一个任务|new task)[:：\\s]/i.test(text)) return {action:'new_task'};
  if (!input.hasAttachments) {
    if (/^(取消|停止|暂停|不用做了|停止任务|取消任务|暂停任务|cancel|stop|pause)$/.test(clean)) return {action:'cancel'};
    if (/^(做到哪了|进度如何|现在进度|进度|查看进度|任务进度|status|progress)$/.test(clean) || input.intent==='progress') return {action:'progress'};
    if (/^(继续|继续吧|继续修改|继续执行|接着做|接着完成(?:剩余|未完)部分|continue|resume)$/.test(clean) || input.intent==='continue') return {action:input.taskStatus==='none'?'clarify':'continue'};
  }
  if (input.intent==='question') return {action:'respond'};
  if (input.taskStatus==='none') return {action:'new_task'};
  if (input.intent==='supplement'||input.intent==='correction') return {action:'amend'};
  return {action:'respond'};
}`
const sample = (text: string, intent: RouterInput['intent'], taskStatus: RouterInput['taskStatus'] = 'ready', hasAttachments = false): RouterInput => ({ messages: [{ id: 'current', text }], intent, taskStatus, hasAttachments })
export const routerContract: ModuleContract = {
  id: 'task-message-router', name: '任务消息路由', description: '将当前消息分派为新任务、继续、补充、进度、取消、澄清或普通回答，保留任务来源与边界。', baseline: routerBaseline,
  validateInput: validateRouterInput, validateOutput: validateRouterOutput,
  instructions: '同步 process(input)，输入 {messages:[{id,text}],intent,taskStatus,hasAttachments}，只含当前一条用户消息。taskStatus 为 none|ready|paused|complete|blocked|needs_input。只返回 {action}，action 为 new_task|continue|amend|progress|cancel|clarify|respond。没有任务时继续须 clarify；已有任务的补充和纠正为 amend；普通提问 respond。明确进度查询 progress，明确取消 cancel，明确新任务 new_task。带附件避免按纯文本控制词直接进度/取消。宿主校验取消、进度与新任务边界；不得调用工具、改变权限、伪造状态或恢复不存在的目标。',
  cases: [
    { name: '首次建立任务', input: sample('整理数据', 'new_task', 'none'), expected: { action: 'new_task' } },
    { name: '首次问答不虚构任务', input: sample('什么是上下文？', 'question', 'none'), expected: { action: 'respond' } },
    { name: '进度查询不执行', input: sample('做到哪了？', 'progress'), expected: { action: 'progress' } },
    { name: '意图误判仍保护进度查询', input: sample('查看进度', 'new_task'), expected: { action: 'progress' } },
    { name: '空任务查询进度', input: sample('进度', 'progress', 'none'), expected: { action: 'progress' } },
    { name: '明确取消优先于错误意图', input: sample('停止', 'new_task'), expected: { action: 'cancel' } },
    { name: '解释取消按钮不是取消', input: sample('解释取消按钮的作用', 'question'), expected: { action: 'respond' } },
    { name: '没有目标时澄清', input: sample('继续', 'continue', 'none'), expected: { action: 'clarify' } },
    { name: '暂停后继续', input: sample('继续修改', 'supplement', 'paused'), expected: { action: 'continue' } },
    { name: '已完成后的显式继续', input: sample('continue', 'continue', 'complete'), expected: { action: 'continue' } },
    { name: '纠正保留原任务', input: sample('改成昨天', 'correction'), expected: { action: 'amend' } },
    { name: '补充保留原任务', input: sample('还要图表', 'supplement'), expected: { action: 'amend' } },
    { name: '新任务隔离旧约束', input: sample('新任务：写一首诗', 'supplement'), expected: { action: 'new_task' } },
    { name: '附图不按取消命令丢弃', input: sample('取消', 'cancel', 'ready', true), expected: { action: 'respond' } },
  ],
}

export function taskMessages(session: StudioSession) {
  const start = session.abilityTask ? session.messages.findIndex(message => message.id === session.abilityTask!.startMessageId) : -1
  return start < 0 ? session.messages : session.messages.slice(start)
}
export function taskProgress(session: StudioSession): string {
  const task = session.abilityTask
  if (!task) return '当前没有可查询的任务。请先说明要完成的目标。'
  const goal = session.messages.find(message => message.id === task.goalMessageId)?.content || '目标原文不可用'
  const previous = task.lastExecutionMessageId ? session.messages.find(message => message.id === task.lastExecutionMessageId) : undefined
  const labels = { ready: '待继续', paused: '已暂停后续执行', complete: '上轮报告已完成', blocked: '上轮受阻', needs_input: '等待补充信息' }
  const activities = previous?.toolActivity || []
  return `当前目标：${goal.slice(0, 500)}\n任务状态：${labels[task.status]}\n` +
    (previous ? `最近执行记录：${previous.content.slice(0, 1200) || previous.error || '未生成正文'}\n工具记录：${activities.length} 项，其中 ${activities.filter(item => item.status === 'error').length} 项失败。` : '尚无该任务的执行记录。') +
    '\n本次只查询已保存记录，没有重新执行任务。'
}
