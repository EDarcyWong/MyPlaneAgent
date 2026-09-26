import { parentPort, workerData } from 'node:worker_threads'
import { getQuickJS } from 'quickjs-emscripten'

// No host functions, module loader, files, fetch, process or timers enter this VM.
const engine = await getQuickJS()
const results = []
for (const input of workerData.inputs as unknown[]) {
  const started = Date.now()
  const runtime = engine.newRuntime()
  runtime.setMemoryLimit(8 * 1024 * 1024)
  runtime.setMaxStackSize(256 * 1024)
  runtime.setInterruptHandler(() => Date.now() - started > 100)
  const context = runtime.newContext()
  try {
    const source = `"use strict";\n${workerData.code}\n;JSON.stringify(process(${JSON.stringify(input)}));`
    const result = context.evalCode(source, 'ability-module.js')
    if (result.error) {
      const error = context.dump(result.error)
      result.error.dispose()
      throw new Error(typeof error?.message === 'string' ? error.message : '模块运行失败')
    }
    let output: string
    try { output = context.getString(result.value) } finally { result.value.dispose() }
    if (output.length > 64000) throw new Error('模块输出超过 64 KB')
    results.push({ output: JSON.parse(output), elapsedMs: Date.now() - started })
  } catch (error) {
    results.push({ error: String(error).slice(0, 1000), elapsedMs: Date.now() - started })
  } finally {
    context.dispose()
    runtime.dispose()
  }
}
parentPort?.postMessage(results)
