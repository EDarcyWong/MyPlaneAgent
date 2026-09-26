import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { conversationIntents, type StateModuleInput, type StateModuleOutput } from '../../shared/ability-modules.js'

export type SandboxResult = { output?: unknown; error?: string; elapsedMs: number }
export function validateInput(input: StateModuleInput): void {
  if (!input || !Array.isArray(input.messages) || input.messages.length > 80 || JSON.stringify(input).length > 64000)
    throw new Error('模块输入最多 80 条消息、64 KB')
  const ids = new Set<string>()
  for (const message of input.messages) {
    if (!message || typeof message.id !== 'string' || !message.id || message.id.length > 150 || ids.has(message.id) || typeof message.text !== 'string')
      throw new Error('模块输入消息格式无效')
    ids.add(message.id)
  }
}
export function validateOutput(value: unknown, input: StateModuleInput): StateModuleOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模块必须返回状态对象')
  const output = value as StateModuleOutput
  if (Object.keys(output).sort().join(',') !== 'amendmentMessageIds,constraintMessageIds,goalMessageId,intent') throw new Error('模块输出字段不符合 API v1')
  if (!conversationIntents.includes(output.intent)) throw new Error('模块返回未知意图')
  const ids = new Set(input.messages.map(message => message.id))
  if (output.goalMessageId !== null && !ids.has(output.goalMessageId)) throw new Error('目标引用不存在的用户消息')
  for (const key of ['constraintMessageIds', 'amendmentMessageIds'] as const) {
    if (!Array.isArray(output[key]) || output[key].length > input.messages.length || new Set(output[key]).size !== output[key].length || output[key].some(id => !ids.has(id)))
      throw new Error('状态引用必须来自用户原始消息且不可重复')
  }
  return output
}
export function runSandbox(code: string, inputs: StateModuleInput[], signal?: AbortSignal): Promise<SandboxResult[]> {
  return runModuleSandbox(code, inputs, validateInput, signal)
}
export function runModuleSandbox<T>(code: string, inputs: T[], validate: (input: T) => void, signal?: AbortSignal): Promise<SandboxResult[]> {
  if (typeof code !== 'string' || !code.trim() || code.length > 32000) throw new Error('模块代码必须为 1–32000 个字符')
  if (!inputs.length || inputs.length > 100) throw new Error('单次评测最多 100 个案例')
  inputs.forEach(validate)
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    // A packaged Node worker and its WASM dependencies live outside app.asar.
    const workerFile = fileURLToPath(new URL('./sandbox-worker.js', import.meta.url)).replace(/\.asar([\\/])/, '.asar.unpacked$1')
    const worker = new Worker(workerFile, {
      workerData: { code, inputs }, resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 2 },
    })
    let settled = false
    const finish = (error?: Error, result?: SandboxResult[]) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(error); else resolve(result!)
    }
    const abort = () => finish(new Error('模块运行已取消'))
    const timer = setTimeout(() => finish(new Error('模块沙箱运行超时')), 15000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', result => finish(undefined, result))
    worker.once('error', error => finish(error instanceof Error ? error : new Error(String(error))))
    worker.once('exit', code => { if (!settled) finish(new Error(`模块沙箱意外退出：${code}`)) })
  })
}
