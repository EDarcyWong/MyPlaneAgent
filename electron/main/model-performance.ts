import { StringDecoder } from 'node:string_decoder'
import type { ModelTokenSample } from '../shared/model-performance.js'

/** Each pipe has its own UTF-8 decoder and line buffer: data events are not lines. */
export class ModelPerformanceTracker {
  private samples = new Map<number, ModelTokenSample>()
  private pipes = new Map<string, { decoder: StringDecoder; pending: string }>()

  reset() { this.samples.clear(); this.pipes.clear() }
  snapshot() { return [...this.samples.values()].map(sample => ({ ...sample, history: sample.history?.map(point => ({ ...point })) })).sort((a, b) => b.updatedAt - a.updatedAt) }

  feed(pipe: string, chunk: Buffer, now = Date.now()) {
    let state = this.pipes.get(pipe)
    if (!state) { state = { decoder: new StringDecoder('utf8'), pending: '' }; this.pipes.set(pipe, state) }
    const lines = (state.pending + state.decoder.write(chunk)).split(/[\r\n]/)
    state.pending = lines.pop()!.slice(-16384)
    for (const line of lines) this.line(line, now)
  }

  private line(raw: string, now: number) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '')
    const identity = /\bid\s+(\d+)\s*\|\s*task\s+(\d+)\s*\|/.exec(line)
    if (!identity) return
    const slot = Number(identity[1]), task = Number(identity[2])
    if (!Number.isSafeInteger(slot) || !Number.isSafeInteger(task) || slot > 1024) return
    const launch = /processing task/.test(line)
    const inputFinal = /prompt eval time\s*=\s*([\d.]+) ms\s*\/\s*(\d+) tokens.*?([\d.]+) tokens per second/.exec(line)
    const outputFinal = /\|\s*eval time\s*=\s*([\d.]+) ms\s*\/\s*(\d+) tokens.*?([\d.]+) tokens per second/.exec(line)
    const input = /prompt processing,\s*n_tokens\s*=\s*(\d+).*?\/\s*([\d.]+) tokens per second/.exec(line)
    const output = /n_gen\s*=\s*(\d+),\s*tg\s*=\s*([\d.]+) t\/s(?:,\s*tg_3s\s*=\s*([\d.]+) t\/s)?/.exec(line)
    const finished = /stop processing:|total time\s*=/.test(line)
    if (!launch && !inputFinal && !outputFinal && !input && !output && !finished) return
    const previous = this.samples.get(slot)
    const sample: ModelTokenSample = !previous || previous.task !== task || launch
      ? { slot, task, phase: 'processing', updatedAt: now } : { ...previous, updatedAt: now }
    const number = (value: string) => { const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : undefined }
    if (input) { sample.phase = 'processing'; sample.inputTokens = number(input[1]); sample.inputRate = number(input[2]) }
    if (output) {
      sample.phase = 'generating'; sample.outputTokens = number(output[1]); sample.outputRate = number(output[2])
      sample.recentOutputRate = output[3] === undefined ? undefined : number(output[3])
    }
    if (inputFinal) { sample.inputMs = number(inputFinal[1]); sample.inputTokens = number(inputFinal[2]); sample.inputRate = number(inputFinal[3]) }
    if (outputFinal) {
      sample.outputMs = number(outputFinal[1]); sample.outputTokens = number(outputFinal[2]); sample.outputRate = number(outputFinal[3])
      sample.recentOutputRate = undefined
      sample.phase = 'finished'
    }
    if (finished) { sample.phase = 'finished'; sample.recentOutputRate = undefined }
    if (input || inputFinal || output || outputFinal) {
      const point = { at: now, ...(input || inputFinal ? { inputRate: sample.inputRate } : {}), ...(output || outputFinal ? { outputRate: sample.outputRate } : {}) }
      const history = (sample.history || []).filter(item => item.at >= now - 60000)
      // Multiple timing lines in one pipe chunk share a timestamp.
      if (history.at(-1)?.at === now) history[history.length - 1] = { ...history.at(-1)!, ...point }
      else history.push(point)
      sample.history = history.slice(-120)
    }
    this.samples.set(slot, sample)
    // Bounded even if an unfamiliar runtime emits arbitrary slot identifiers.
    if (this.samples.size > 16) this.samples.delete(this.samples.keys().next().value!)
  }
}
