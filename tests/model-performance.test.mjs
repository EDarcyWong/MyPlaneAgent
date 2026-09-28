import test from 'node:test'
import assert from 'node:assert/strict'
import { ModelPerformanceTracker } from '../dist-electron/main/model-performance.js'
import { LocalAiRuntime } from '../dist-electron/main/local-ai-runtime.js'

const send = (tracker, line, time = 1000, pipe = 'stderr') => tracker.feed(pipe, Buffer.from(line + '\n'), time)
const prefix = 'I slot print_timing: id  0 | task 50 | '

test('chart history keeps measured values only, merges a timestamp, bounds storage and resets per request', () => {
  const tracker = new ModelPerformanceTracker()
  send(tracker, prefix + 'prompt processing, n_tokens = 100, progress = 1.00, t = 2 s / 50 tokens per second', 1000)
  send(tracker, prefix + 'n_gen = 1, tg = 3.00 t/s', 1000)
  assert.deepEqual(tracker.snapshot()[0].history, [{ at: 1000, inputRate: 50, outputRate: 3 }])
  send(tracker, prefix + 'n_gen = 2, tg = 4.00 t/s', 2000)
  assert.equal(tracker.snapshot()[0].history[1].inputRate, undefined)
  const copy = tracker.snapshot(); copy[0].history[0].outputRate = 999
  assert.equal(tracker.snapshot()[0].history[0].outputRate, 3)
  for (let index = 0; index < 150; index++) send(tracker, prefix + `n_gen = ${index + 3}, tg = 4.00 t/s`, 3000 + index * 250)
  assert.equal(tracker.snapshot()[0].history.length, 120)
  send(tracker, prefix + 'n_gen = 200, tg = 4.00 t/s', 200000)
  assert.equal(tracker.snapshot()[0].history.length, 1)
  send(tracker, 'id 0 | task 51 | processing task', 200001)
  assert.equal(tracker.snapshot()[0].history, undefined)
})

test('reports server prompt, generation, rolling speed and final averages', () => {
  const tracker = new ModelPerformanceTracker()
  send(tracker, prefix + 'processing task, is_child = 0')
  assert.equal(tracker.snapshot()[0].outputRate, undefined)
  send(tracker, prefix + 'prompt processing, n_tokens = 5875, progress = 1.00, t = 28.72 s / 204.57 tokens per second')
  assert.equal(tracker.snapshot()[0].inputRate, 204.57)
  send(tracker, prefix + 'n_gen = 100, tg = 3.05 t/s, tg_3s = 3.08 t/s', 2000)
  assert.equal(tracker.snapshot()[0].recentOutputRate, 3.08)
  assert.equal(tracker.snapshot()[0].phase, 'generating')
  send(tracker, prefix + 'prompt eval time = 29203.69 ms / 5879 tokens ( 4.97 ms per token, 201.31 tokens per second)')
  send(tracker, prefix + '       eval time = 122153.47 ms / 370 tokens ( 331.04 ms per token, 3.02 tokens per second)')
  const final = tracker.snapshot()[0]
  assert.equal(final.inputRate, 201.31)
  assert.equal(final.inputTokens, 5879)
  assert.equal(final.outputRate, 3.02)
  assert.equal(final.outputMs, 122153.47)
  assert.equal(final.recentOutputRate, undefined)
  assert.equal(final.phase, 'finished')
})

test('buffers arbitrary byte boundaries and independent stdout/stderr lines', () => {
  const tracker = new ModelPerformanceTracker()
  const bytes = Buffer.from('中文日志 ' + prefix + 'n_gen = 123, tg = 3.02 t/s, tg_3s = 2.99 t/s\r\n')
  for (const byte of bytes) tracker.feed('stderr', Buffer.from([byte]))
  assert.equal(tracker.snapshot()[0].outputRate, 3.02)
  tracker.feed('stdout', Buffer.from('incomplete unrelated message'))
  send(tracker, prefix + 'n_gen = 130, tg = 0.00 t/s')
  assert.equal(tracker.snapshot()[0].outputRate, 0)
  assert.equal(tracker.snapshot()[0].recentOutputRate, undefined)
})

test('isolates concurrent slots and resets old counters for new requests and models', () => {
  const tracker = new ModelPerformanceTracker()
  send(tracker, prefix + 'n_gen = 100, tg = 3.00 t/s', 1000)
  send(tracker, 'id 1 | task 51 | n_gen = 30, tg = 5.00 t/s', 2000)
  assert.deepEqual(tracker.snapshot().map(sample => sample.outputRate), [5, 3])
  send(tracker, 'id 0 | task 52 | processing task', 3000)
  assert.equal(tracker.snapshot()[0].outputRate, undefined)
  assert.equal(tracker.snapshot()[0].task, 52)
  send(tracker, 'id 0 | task 52 | stop processing: n_tokens = 10', 4000)
  assert.equal(tracker.snapshot()[0].phase, 'finished')
  const copy = tracker.snapshot(); copy[0].outputRate = 999
  assert.equal(tracker.snapshot()[0].outputRate, undefined)
  tracker.reset()
  assert.deepEqual(tracker.snapshot(), [])
})

test('unsupported logs stay unavailable and stopped runtime does not expose old speed', () => {
  const tracker = new ModelPerformanceTracker()
  send(tracker, 'id 0 | task -1 | selected slot by LRU')
  send(tracker, 'other log format without measured token timings')
  assert.deepEqual(tracker.snapshot(), [])
  const runtime = new LocalAiRuntime()
  assert.deepEqual(runtime.snapshot().performance, [])
})
